import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { AgentRegistry } from '../agent/registry.js';
import { loadHaroConfig, type LoadedConfig } from '../config/loader.js';
import { initHaroDatabase } from '../db/init.js';
import { createLogger, type HaroLogger } from '../logger/index.js';
import { createMemoryFabric, type MemoryFabric } from '../memory/index.js';
import { buildHaroPaths } from '../paths.js';
import type {
  AgentErrorEvent,
  AgentEvent,
  AgentProvider,
  AgentResultEvent,
  ProviderRegistry,
} from '../provider/index.js';
import { resolveSelection } from './selection.js';
import type { RunAgentInput, RunAgentResult, ResolvedSelectionCandidate } from './types.js';

const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;
const FALLBACK_TRIGGERS = new Set([
  'provider_unavailable',
  'rate_limit',
  'timeout',
  'auth_error',
  'model_not_found',
  'context_too_long',
]);

interface MemoryWrapupHook {
  (input: { sessionId: string; agentId: string; task: string; result: string }): Promise<void>;
}

type MemoryRuntime = Pick<MemoryFabric, 'contextFor' | 'wrapupSession'>;

export interface AgentRunnerOptions {
  agentRegistry: AgentRegistry;
  providerRegistry: ProviderRegistry;
  root?: string;
  projectRoot?: string;
  dbFile?: string;
  logger?: Pick<HaroLogger, 'debug' | 'info' | 'warn' | 'error'>;
  now?: () => Date;
  createSessionId?: () => string;
  loadConfig?: () => LoadedConfig;
  taskTimeoutMs?: number;
  memoryWrapupHook?: MemoryWrapupHook;
  memoryFabric?: MemoryRuntime;
}

interface SessionStateRecord {
  taskContext: {
    lastTaskPreview: string;
    lastSessionId: string;
    updatedAt: string;
    provider: string;
    model: string;
  };
  executionHistory: Array<{
    sessionId: string;
    timestamp: string;
    taskPreview: string;
    outcome: 'completed' | 'failed';
  }>;
  keyDecisions: Array<{
    timestamp: string;
    ruleId: string;
    provider: string;
    model: string;
  }>;
  pendingWork: string[];
}

interface QueryAttemptOutcome {
  events: AgentEvent[];
  terminal: AgentResultEvent | AgentErrorEvent;
}

export class AgentRunner {
  private readonly options: AgentRunnerOptions;
  private readonly now: () => Date;
  private readonly createSessionId: () => string;
  private readonly logger: Pick<HaroLogger, 'debug' | 'info' | 'warn' | 'error'>;
  private memoryFabric: MemoryRuntime | null | undefined;
  private memoryFabricKey?: string;

  constructor(options: AgentRunnerOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.createSessionId = options.createSessionId ?? randomUUID;
    this.logger =
      options.logger ??
      createLogger({
        root: options.root,
        name: 'runtime.runner',
      });
  }

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    const agent = this.options.agentRegistry.get(input.agentId);
    const config = this.loadConfig();
    const selection = await resolveSelection({
      task: input.task,
      agent,
      providerRegistry: this.options.providerRegistry,
      root: this.options.root,
      projectRoot: this.options.projectRoot,
      config: config.config,
    });

    const paths = buildHaroPaths(this.options.root);
    const opened = initHaroDatabase({
      root: this.options.root,
      dbFile: this.options.dbFile,
      keepOpen: true,
    });
    const db = opened.database!;
    const sessionId = this.createSessionId();
    const timeoutMs = this.resolveTimeoutMs(config);
    const candidates = [
      applyInputOverrides(selection.primary, input),
      ...selection.fallbacks,
    ];
    let finalProvider = candidates[0]!.provider;
    let finalModel = candidates[0]!.model;
    let finalEvent: AgentResultEvent | AgentErrorEvent | null = null;
    const events: AgentEvent[] = [];
    const startedAt = this.timestamp();

    try {
      this.insertSession(db, {
        id: sessionId,
        agentId: agent.id,
        provider: finalProvider,
        model: finalModel,
        startedAt,
      });

      if (input.retryOfSessionId) {
        this.insertSyntheticRetryEvent(db, sessionId, input.retryOfSessionId);
      }

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
        finalProvider = candidate.provider;
        finalModel = candidate.model;
        this.updateSessionRoute(db, sessionId, candidate);

        const provider = this.options.providerRegistry.get(candidate.provider);
        const healthy = await provider.healthCheck();
        if (!healthy) {
          const unavailable: AgentErrorEvent = {
            type: 'error',
            code: 'provider_unavailable',
            message: `Provider '${candidate.provider}' healthCheck() returned false`,
            retryable: true,
          };
          this.insertEvent(db, sessionId, unavailable);
          events.push(unavailable);
          finalEvent = unavailable;
        } else {
          let sessionContext = this.loadContinuationContext(
            db,
            agent.id,
            candidate.provider,
            sessionId,
            input.continueLatestSession !== false,
          );
          let contextResetRetried = false;
          let attemptActive = true;

          while (attemptActive) {
            const outcome = await this.runAttempt({
              provider,
              sessionId,
              task: input.task,
              systemPrompt: this.buildSystemPrompt({
                agentId: agent.id,
                basePrompt: agent.systemPrompt,
                task: input.task,
                noMemory: input.noMemory === true,
                config,
              }),
              model: candidate.model,
              tools: agent.tools,
              sessionContext,
              timeoutMs,
              db,
              onEvent: input.onEvent,
            });
            events.push(...outcome.events);
            finalEvent = outcome.terminal;

            if (
              !contextResetRetried &&
              finalEvent.type === 'error' &&
              finalEvent.code === 'context_too_long' &&
              finalEvent.hint === 'save-and-clear'
            ) {
              contextResetRetried = true;
              await this.handleSaveAndClear({
                config,
                sessionId,
                agentId: agent.id,
                task: input.task,
                model: candidate.model,
                provider: candidate.provider,
                events: outcome.events,
                noMemory: input.noMemory === true,
              });
              sessionContext = { sessionId };
              continue;
            }

            attemptActive = false;
          }
        }

        if (!finalEvent) {
          finalEvent = {
            type: 'error',
            code: 'runtime_error',
            message: `Provider '${candidate.provider}' finished without a terminal event`,
            retryable: false,
          };
          this.insertEvent(db, sessionId, finalEvent);
          events.push(finalEvent);
        }

        if (finalEvent.type === 'result') {
          this.completeSession(db, sessionId, 'completed');
          this.updateAgentState(paths.root, agent.id, {
            sessionId,
            task: input.task,
            outcome: 'completed',
            provider: finalProvider,
            model: finalModel,
            ruleId: selection.ruleId,
          });
          await this.maybeWrapupMemory(input, {
            sessionId,
            agentId: agent.id,
            task: input.task,
            result: finalEvent.content,
          });
          return {
            sessionId,
            ruleId: selection.ruleId,
            provider: finalProvider,
            model: finalModel,
            events,
            finalEvent,
          };
        }

        const nextCandidate = candidates[index + 1];
        if (!nextCandidate || !shouldFallback(finalEvent)) {
          break;
        }
        this.insertFallback(
          db,
          sessionId,
          candidate,
          nextCandidate,
          finalEvent.code,
          selection.ruleId,
        );
      }

      if (!finalEvent) {
        finalEvent = {
          type: 'error',
          code: 'runtime_error',
          message: 'Runner finished without a terminal event',
          retryable: false,
        };
        this.insertEvent(db, sessionId, finalEvent);
        events.push(finalEvent);
      }

      this.completeSession(db, sessionId, 'failed');
      this.updateAgentState(paths.root, agent.id, {
        sessionId,
        task: input.task,
        outcome: 'failed',
        provider: finalProvider,
        model: finalModel,
        ruleId: selection.ruleId,
      });
      return {
        sessionId,
        ruleId: selection.ruleId,
        provider: finalProvider,
        model: finalModel,
        events,
        finalEvent,
      };
    } finally {
      db.close();
    }
  }

  private async runAttempt(input: {
    provider: AgentProvider;
    sessionId: string;
    task: string;
    systemPrompt: string;
    model: string;
    tools: readonly string[] | undefined;
    sessionContext: { sessionId: string; previousResponseId?: string };
    timeoutMs: number;
    db: Database.Database;
    onEvent?: (event: AgentEvent, sessionId: string) => void;
  }): Promise<QueryAttemptOutcome> {
    const attemptStartedAt = Date.now();
    const iterator = input.provider.query({
      prompt: input.task,
      systemPrompt: input.systemPrompt,
      model: input.model,
      tools: input.tools,
      sessionContext: input.sessionContext,
    });
    const events: AgentEvent[] = [];
    let timedOut = false;
    let timeoutEvent: AgentErrorEvent | null = null;
    let terminalCommitted = false;
    const appendEvent = (event: AgentEvent): boolean => {
      if (terminalCommitted) return false;
      this.insertEvent(input.db, input.sessionId, event);
      events.push(event);
      input.onEvent?.(event, input.sessionId);
      if (event.type === 'result') {
        terminalCommitted = true;
        this.updateContextRef(input.db, input.sessionId, event.responseId);
      } else if (event.type === 'error') {
        terminalCommitted = true;
      }
      return true;
    };
    const consume = (async (): Promise<QueryAttemptOutcome> => {
      let terminal: AgentResultEvent | AgentErrorEvent | null = null;
      for await (const rawEvent of iterator) {
        const event = rawEvent.type === 'result' || rawEvent.type === 'error'
          ? this.withProviderTelemetry(rawEvent, input.provider.id, input.model, attemptStartedAt)
          : rawEvent;
        if (!appendEvent(event)) continue;
        if (event.type === 'result') {
          terminal = event;
        } else if (event.type === 'error') {
          terminal = event;
        }
      }
      if (!terminal) {
        if (timedOut && timeoutEvent) {
          terminal = timeoutEvent;
        } else {
          terminal = this.withProviderTelemetry({
            type: 'error',
            code: 'missing_terminal_event',
            message: `Provider '${input.provider.id}' completed without a terminal result/error event`,
            retryable: false,
          }, input.provider.id, input.model, attemptStartedAt);
          appendEvent(terminal);
        }
      }
      return { events, terminal };
    })();

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        consume,
        new Promise<QueryAttemptOutcome>((resolve) => {
          timer = setTimeout(() => {
            timeoutEvent = this.withProviderTelemetry({
              type: 'error',
              code: 'timeout',
              message: `Task timed out after ${input.timeoutMs}ms`,
              retryable: true,
            }, input.provider.id, input.model, attemptStartedAt);
            timedOut = true;
            appendEvent(timeoutEvent);
            void iterator.return?.(undefined).catch(() => {
              // Best effort — some generators won't implement return().
            });
            resolve({ events: [...events], terminal: timeoutEvent });
          }, input.timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private loadContinuationContext(
    db: Database.Database,
    agentId: string,
    provider: string,
    currentSessionId: string,
    continueLatestSession: boolean,
  ): { sessionId: string; previousResponseId?: string } {
    if (!continueLatestSession) {
      return { sessionId: currentSessionId };
    }
    const prior = db
      .prepare(
        `SELECT id, context_ref
           FROM sessions
          WHERE agent_id = ? AND provider = ? AND status = 'completed'
       ORDER BY started_at DESC
          LIMIT 1`,
      )
      .get(agentId, provider) as { id: string; context_ref: string | null } | undefined;
    const contextRef = parseContextRef(prior?.context_ref);
    if (contextRef.previousResponseId) {
      return { sessionId: prior?.id ?? randomUUID(), previousResponseId: contextRef.previousResponseId };
    }

    const row = db
      .prepare(
        `SELECT event_data
           FROM session_events
          WHERE session_id = ?
            AND event_type = 'result'
       ORDER BY id DESC
          LIMIT 1`,
      )
      .get(prior?.id ?? '') as { event_data: string } | undefined;
    if (!row) {
      return { sessionId: prior?.id ?? randomUUID() };
    }
    const payload = JSON.parse(row.event_data) as { responseId?: string };
    return {
      sessionId: prior?.id ?? randomUUID(),
      ...(payload.responseId ? { previousResponseId: payload.responseId } : {}),
    };
  }

  private insertSession(
    db: Database.Database,
    row: { id: string; agentId: string; provider: string; model: string; startedAt: string },
  ): void {
    db.prepare(
      `INSERT INTO sessions (id, agent_id, provider, model, started_at, status, context_ref)
       VALUES (?, ?, ?, ?, ?, 'running', NULL)`,
    ).run(row.id, row.agentId, row.provider, row.model, row.startedAt);
  }

  private updateSessionRoute(
    db: Database.Database,
    sessionId: string,
    candidate: ResolvedSelectionCandidate,
  ): void {
    db.prepare(`UPDATE sessions SET provider = ?, model = ? WHERE id = ?`).run(
      candidate.provider,
      candidate.model,
      sessionId,
    );
  }

  private completeSession(
    db: Database.Database,
    sessionId: string,
    status: 'completed' | 'failed',
  ): void {
    db.prepare(`UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?`).run(
      status,
      this.timestamp(),
      sessionId,
    );
  }

  private insertEvent(db: Database.Database, sessionId: string, event: AgentEvent): void {
    db.prepare(
      `INSERT INTO session_events (session_id, event_type, event_data, created_at, latency_ms)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(sessionId, event.type, JSON.stringify(event), this.timestamp(), eventLatencyMs(event));
  }

  private withProviderTelemetry<T extends AgentResultEvent | AgentErrorEvent>(
    event: T,
    provider: string,
    model: string,
    startedAtMs: number,
  ): T {
    const elapsed = Math.max(0, Date.now() - startedAtMs);
    return {
      ...event,
      provider: event.provider ?? provider,
      model: event.model ?? model,
      latencyMs: event.latencyMs ?? elapsed,
    };
  }

  private insertSyntheticRetryEvent(
    db: Database.Database,
    sessionId: string,
    priorSessionId: string,
  ): void {
    db.prepare(
      `INSERT INTO session_events (session_id, event_type, event_data, created_at)
       VALUES (?, 'session_retry', ?, ?)`,
    ).run(
      sessionId,
      JSON.stringify({ priorSessionId }),
      this.timestamp(),
    );
  }

  private updateContextRef(
    db: Database.Database,
    sessionId: string,
    responseId?: string,
  ): void {
    if (!responseId) return;
    db.prepare(`UPDATE sessions SET context_ref = ? WHERE id = ?`).run(
      JSON.stringify({ previousResponseId: responseId }),
      sessionId,
    );
  }

  private insertFallback(
    db: Database.Database,
    sessionId: string,
    original: ResolvedSelectionCandidate,
    fallback: ResolvedSelectionCandidate,
    trigger: string,
    ruleId: string,
  ): void {
    db.prepare(
      `INSERT INTO provider_fallback_log (
         session_id,
         original_provider,
         original_model,
         fallback_provider,
         fallback_model,
         trigger,
         rule_id,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      original.provider,
      original.model,
      fallback.provider,
      fallback.model,
      trigger,
      ruleId,
      this.timestamp(),
    );
  }

  private updateAgentState(
    root: string,
    agentId: string,
    input: {
      sessionId: string;
      task: string;
      outcome: 'completed' | 'failed';
      provider: string;
      model: string;
      ruleId: string;
    },
  ): void {
    const dir = join(root, 'agents', agentId);
    const file = join(dir, 'state.json');
    mkdirSync(dir, { recursive: true });
    const existing = readJson<SessionStateRecord>(file) ?? {
      taskContext: {
        lastTaskPreview: '',
        lastSessionId: '',
        updatedAt: '',
        provider: '',
        model: '',
      },
      executionHistory: [],
      keyDecisions: [],
      pendingWork: [],
    };
    const timestamp = this.timestamp();
    const taskPreview = previewTask(input.task);
    existing.taskContext = {
      lastTaskPreview: taskPreview,
      lastSessionId: input.sessionId,
      updatedAt: timestamp,
      provider: input.provider,
      model: input.model,
    };
    existing.executionHistory = [
      ...existing.executionHistory,
      {
        sessionId: input.sessionId,
        timestamp,
        taskPreview,
        outcome: input.outcome,
      },
    ];
    if (input.outcome === 'completed') {
      existing.keyDecisions = [
        ...existing.keyDecisions,
        {
          timestamp,
          ruleId: input.ruleId,
          provider: input.provider,
          model: input.model,
        },
      ];
      existing.pendingWork = existing.pendingWork.filter(
        (item) => item !== taskPreview,
      );
    } else if (!existing.pendingWork.includes(taskPreview)) {
      existing.pendingWork.push(taskPreview);
    }
    writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  }

  private async maybeWrapupMemory(
    input: RunAgentInput,
    wrapup: { sessionId: string; agentId: string; task: string; result: string },
  ): Promise<void> {
    if (input.noMemory) {
      this.logger.debug?.({ sessionId: wrapup.sessionId }, 'memory-wrapup hook skipped (no-memory override)');
      return;
    }
    if (!this.options.memoryWrapupHook) {
      this.logger.debug?.({ sessionId: wrapup.sessionId }, 'memory-wrapup hook skipped');
      return;
    }
    await this.options.memoryWrapupHook(wrapup);
  }

  private buildSystemPrompt(input: {
    agentId: string;
    basePrompt: string;
    task: string;
    noMemory: boolean;
    config: LoadedConfig;
  }): string {
    if (input.noMemory) return input.basePrompt;
    const memoryFabric = this.resolveMemoryFabric(input.config);
    if (!memoryFabric) return input.basePrompt;

    const context = memoryFabric.contextFor({
      agentId: input.agentId,
      query: input.task,
    });
    if (context.items.length === 0) return input.basePrompt;

    const memorySection = [
      '<memory-context>',
      ...context.items.map((item) => {
        const datePrefix = item.date ? `[${item.date}] ` : '';
        const status = item.verificationStatus ? ` status=${item.verificationStatus}` : '';
        const uncertainty = item.uncertainty ? `；${item.uncertainty}` : '';
        return `- ${datePrefix}${item.summary} (source=${item.source}${status}${uncertainty}) → ${item.sourceFile}`;
      }),
      '</memory-context>',
    ].join('\n');

    return input.basePrompt.length > 0
      ? `${input.basePrompt}\n\n${memorySection}`
      : memorySection;
  }

  private async handleSaveAndClear(input: {
    config: LoadedConfig;
    sessionId: string;
    agentId: string;
    task: string;
    provider: string;
    model: string;
    events: readonly AgentEvent[];
    noMemory: boolean;
  }): Promise<void> {
    if (input.noMemory) {
      this.logger.warn?.(
        { sessionId: input.sessionId, provider: input.provider, model: input.model },
        'context_too_long received under --no-memory; retrying with cleared continuation only',
      );
      return;
    }

    const memoryFabric = this.resolveMemoryFabric(input.config);
    if (!memoryFabric) {
      this.logger.warn?.(
        { sessionId: input.sessionId, provider: input.provider, model: input.model },
        'context_too_long received but MemoryFabric is unavailable; retrying with cleared continuation only',
      );
      return;
    }

    await memoryFabric.wrapupSession({
      scope: 'agent',
      agentId: input.agentId,
      wrapupId: input.sessionId,
      topic: `context-too-long-${slugPreview(input.task)}`,
      summary: `Continuation recovery for ${previewTask(input.task)}`,
      transcript: renderAttemptTranscript(input),
      source: 'runtime-save-and-clear',
    });
  }

  private resolveMemoryFabric(config: LoadedConfig): MemoryRuntime | null {
    if (this.options.memoryFabric) return this.options.memoryFabric;
    if (this.memoryFabric !== undefined) return this.memoryFabric;

    const paths = buildHaroPaths(this.options.root);
    const primaryRoot =
      config.config.memory?.primary?.path ??
      config.config.memory?.path ??
      paths.dirs.memory;
    const backupRoot = config.config.memory?.backup?.path;
    const key = `${primaryRoot}::${backupRoot ?? ''}`;

    if (this.memoryFabric && this.memoryFabricKey === key) return this.memoryFabric;
    this.memoryFabricKey = key;
    this.memoryFabric = createMemoryFabric({
      root: primaryRoot,
      ...(backupRoot ? { backupRoot } : {}),
    });
    return this.memoryFabric;
  }

  private resolveTimeoutMs(config: LoadedConfig): number {
    if (this.options.taskTimeoutMs !== undefined) return this.options.taskTimeoutMs;
    const env = process.env.HARO_TASK_TIMEOUT_MS;
    if (env && Number.isFinite(Number(env)) && Number(env) > 0) {
      return Number(env);
    }
    return config.config.runtime?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  }

  private loadConfig(): LoadedConfig {
    if (this.options.loadConfig) return this.options.loadConfig();
    return loadHaroConfig({
      globalRoot: this.options.root,
      projectRoot: this.options.projectRoot,
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function parseContextRef(
  raw: string | null | undefined,
): { previousResponseId?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { previousResponseId?: unknown };
    if (typeof parsed.previousResponseId === 'string' && parsed.previousResponseId.length > 0) {
      return { previousResponseId: parsed.previousResponseId };
    }
  } catch {
    // Ignore broken legacy state; Runner can fall back to result events.
  }
  return {};
}

function previewTask(task: string): string {
  return task.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function slugPreview(task: string): string {
  const normalized = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 48) : 'task';
}

function renderAttemptTranscript(input: {
  task: string;
  provider: string;
  model: string;
  events: readonly AgentEvent[];
}): string {
  const sections = [
    `Task: ${input.task}`,
    `Provider: ${input.provider}`,
    `Model: ${input.model}`,
    'Events:',
    ...input.events.map((event) => {
      switch (event.type) {
        case 'text':
          return `- text: ${event.content}`;
        case 'result':
          return `- result: ${event.content}`;
        case 'error':
          return `- error(${event.code}${event.hint ? `, hint=${event.hint}` : ''}): ${event.message}`;
        case 'tool_call':
          return `- tool_call(${event.toolName}): ${JSON.stringify(event.toolInput)}`;
        case 'tool_result':
          return `- tool_result(${event.callId}${event.isError ? ', error' : ''}): ${JSON.stringify(event.result)}`;
      }
    }),
  ];
  return sections.join('\n');
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function applyInputOverrides(
  candidate: ResolvedSelectionCandidate,
  input: RunAgentInput,
): ResolvedSelectionCandidate {
  if (!input.provider && !input.model) return candidate;
  return {
    provider: input.provider ?? candidate.provider,
    model: input.model ?? candidate.model,
    source: {
      provider: input.provider ?? candidate.source.provider,
      model: input.model ?? candidate.source.model,
      modelSelection: candidate.source.modelSelection,
    },
  };
}

function shouldFallback(event: AgentErrorEvent): boolean {
  return FALLBACK_TRIGGERS.has(event.code);
}

function eventLatencyMs(event: AgentEvent): number | null {
  const latencyMs = (event.type === 'result' || event.type === 'error') ? event.latencyMs : undefined;
  return typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0
    ? Math.round(latencyMs)
    : null;
}
