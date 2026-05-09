import { AgentDockConnectionSchema, type AgentDockConnection } from './connection.js';
import {
  ObservationBatchSchema,
  type ObservationBatch,
  type RunnerErrorObservation,
  type ScheduledTaskRunObservation,
  type SessionObservation,
  type TurnObservation,
  type UsageRecordObservation,
} from './observation.js';

export interface AgentDockFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AgentDockJsonResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type AgentDockFetch = (
  url: string,
  init?: AgentDockFetchInit,
) => Promise<AgentDockJsonResponse>;

export interface HttpAgentDockSourceOptions {
  connectionId?: string;
  baseUrl: string;
  authHeader?: string;
  now?: () => Date;
  fetchImpl?: AgentDockFetch;
  maxSessions?: number;
  maxMessagesPerSession?: number;
  maxTurnsPerSession?: number;
}

export interface CollectAgentDockObservationOptions {
  since?: string;
  limit?: number;
  signal?: AbortSignal;
}

export class AgentDockHttpSourceError extends Error {
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, options: { status?: number; url?: string } = {}) {
    super(message);
    this.name = 'AgentDockHttpSourceError';
    this.status = options.status;
    this.url = options.url;
  }
}

interface FetchJsonResult {
  url: string;
  value: unknown;
}

type JsonRecord = Record<string, unknown>;

type ObservationCounters = {
  sessionRecords: number;
  statusSessionRecords: number;
  taskRecords: number;
  messageRecords: number;
  turnRecords: number;
};

const DEFAULT_MAX_SESSIONS = 20;
const DEFAULT_MAX_MESSAGES_PER_SESSION = 20;
const DEFAULT_MAX_TURNS_PER_SESSION = 20;

export class HttpAgentDockSource {
  readonly connection: AgentDockConnection;

  private readonly baseUrl: string;
  private readonly authHeader?: string;
  private readonly fetchImpl: AgentDockFetch;
  private readonly now: () => Date;
  private readonly maxSessions: number;
  private readonly maxMessagesPerSession: number;
  private readonly maxTurnsPerSession: number;

  constructor(options: HttpAgentDockSourceOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authHeader = normalizeOptionalString(options.authHeader);
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.now = options.now ?? (() => new Date());
    this.maxSessions = normalizePositiveInt(options.maxSessions, DEFAULT_MAX_SESSIONS);
    this.maxMessagesPerSession = normalizePositiveInt(
      options.maxMessagesPerSession,
      DEFAULT_MAX_MESSAGES_PER_SESSION,
    );
    this.maxTurnsPerSession = normalizePositiveInt(
      options.maxTurnsPerSession,
      DEFAULT_MAX_TURNS_PER_SESSION,
    );

    const createdAt = this.now().toISOString();
    this.connection = AgentDockConnectionSchema.parse({
      id: options.connectionId ?? 'agentdock-http',
      baseUrl: this.baseUrl,
      capabilityVersion: 'agentdock-http-v1',
      observationSources: [
        {
          kind: 'api',
          ref: this.apiUrl('/api'),
          readOnly: true,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    });
  }

  async collectObservationBatch(
    options: CollectAgentDockObservationOptions = {},
  ): Promise<ObservationBatch> {
    const until = this.now().toISOString();
    const effectiveLimit = normalizeOptionalPositiveInt(options.limit);
    const perSessionLimit = effectiveLimit ?? this.maxMessagesPerSession;
    const maxSessions = Math.min(this.maxSessions, effectiveLimit ?? this.maxSessions);
    const maxMessagesPerSession = Math.min(this.maxMessagesPerSession, perSessionLimit);
    const maxTurnsPerSession = Math.min(this.maxTurnsPerSession, perSessionLimit);
    const rawRefs: string[] = [];
    const runnerErrors: RunnerErrorObservation[] = [];
    const counters: ObservationCounters = {
      sessionRecords: 0,
      statusSessionRecords: 0,
      taskRecords: 0,
      messageRecords: 0,
      turnRecords: 0,
    };

    const healthResult = await this.fetchJson('/api/health', options.signal);
    rawRefs.push(healthResult.url);
    const health = asRecord(healthResult.value);

    const statusResult = await this.fetchJson('/api/status', options.signal);
    rawRefs.push(statusResult.url);
    const status = asRecord(statusResult.value) ?? {};

    const sessionsResult = await this.fetchJson('/api/sessions', options.signal);
    rawRefs.push(sessionsResult.url);
    const sessionRecords = extractSessionRecords(sessionsResult.value);
    counters.sessionRecords = sessionRecords.length;

    const statusSessionRecords = extractStatusSessionRecords(status);
    counters.statusSessionRecords = statusSessionRecords.length;

    const mergedSessionRecords = mergeSessionRecords(sessionRecords, statusSessionRecords).slice(
      0,
      maxSessions,
    );
    const observedSessions = mergedSessionRecords.map(mapSessionObservation).filter(isDefined);
    const sessions = observedSessions.filter((session) =>
      isSessionObservationOnOrAfter(session, options.since),
    );

    const turns: TurnObservation[] = [];
    const usageRecords: UsageRecordObservation[] = [];
    for (const session of observedSessions) {
      const messageResult = await this.fetchSessionScopedJson(
        session.id,
        `messages?limit=${maxMessagesPerSession}`,
        options.signal,
        runnerErrors,
      );
      if (messageResult) {
        rawRefs.push(messageResult.url);
        const messages = extractNamedArray(messageResult.value, 'messages');
        counters.messageRecords += messages.length;
        for (const [index, message] of messages.entries()) {
          const turn = mapMessageObservation(message, session.id, index, options.since, until);
          if (turn) turns.push(turn);
          const usage = mapUsageRecord(
            message,
            session.id,
            session.model,
            index,
            options.since,
            until,
          );
          if (usage) usageRecords.push(usage);
        }
      }

      const turnResult = await this.fetchSessionScopedJson(
        session.id,
        `turns?limit=${maxTurnsPerSession}`,
        options.signal,
        runnerErrors,
      );
      if (turnResult) {
        rawRefs.push(turnResult.url);
        const turnRecords = extractNamedArray(turnResult.value, 'turns');
        counters.turnRecords += turnRecords.length;
        runnerErrors.push(
          ...turnRecords
            .map((turn, index) =>
              mapFailedRuntimeTurn(turn, session.id, index, options.since, until),
            )
            .filter(isDefined),
        );
      }
    }

    const tasksResult = await this.fetchJson('/api/tasks', options.signal);
    rawRefs.push(tasksResult.url);
    const taskRecords = extractNamedArray(tasksResult.value, 'tasks');
    counters.taskRecords = taskRecords.length;
    const scheduledTaskRuns = taskRecords
      .map((task, index) => mapScheduledTaskRun(task, index, options.since, until))
      .filter(isDefined);

    const limitedSessions = filterByObservationLimit(sessions, effectiveLimit);
    const limitedTurns = filterByObservationLimit(turns, effectiveLimit);
    const limitedScheduledTaskRuns = filterByObservationLimit(scheduledTaskRuns, effectiveLimit);
    const limitedRunnerErrors = filterByObservationLimit(runnerErrors, effectiveLimit);
    const limitedUsageRecords = filterByObservationLimit(usageRecords, effectiveLimit);
    const limitedRawRefs = filterByObservationLimit(dedupe(rawRefs), effectiveLimit);
    const cursor = latestIso([
      ...limitedSessions.flatMap((session) => [session.startedAt, session.endedAt]),
      ...limitedTurns.map((turn) => turn.createdAt),
      ...limitedScheduledTaskRuns.flatMap((run) => [run.startedAt, run.endedAt]),
      ...limitedRunnerErrors.map((error) => error.occurredAt),
      ...limitedUsageRecords.map((usage) => usage.recordedAt),
    ]);

    return ObservationBatchSchema.parse({
      id: `obs-${compactId(this.connection.id)}-${compactId(until)}`,
      connectionId: this.connection.id,
      source: 'agentdock-http',
      collectedAt: until,
      window: {
        ...(options.since ? { since: options.since } : {}),
        until,
        ...(cursor ? { cursor } : {}),
      },
      sessions: limitedSessions,
      turns: limitedTurns,
      toolCalls: [],
      scheduledTaskRuns: limitedScheduledTaskRuns,
      memoryMaintenanceLogs: [],
      runnerErrors: limitedRunnerErrors,
      usageRecords: limitedUsageRecords,
      rawRefs: limitedRawRefs,
      metadata: buildMetadata({
        baseUrl: this.baseUrl,
        health,
        status,
        counters,
        sessionCount: limitedSessions.length,
        turnCount: limitedTurns.length,
        scheduledTaskRunCount: limitedScheduledTaskRuns.length,
        runnerErrorCount: limitedRunnerErrors.length,
        usageRecordCount: limitedUsageRecords.length,
      }),
    });
  }

  private async fetchSessionScopedJson(
    sessionId: string,
    suffix: string,
    signal: AbortSignal | undefined,
    runnerErrors: RunnerErrorObservation[],
  ): Promise<FetchJsonResult | null> {
    try {
      return await this.fetchJson(
        `/api/sessions/${encodeURIComponent(sessionId)}/${suffix}`,
        signal,
      );
    } catch (err) {
      runnerErrors.push({
        id: `agentdock-http-${compactId(sessionId)}-${compactId(suffix)}-fetch-error`,
        sessionId,
        code: 'AGENTDOCK_SESSION_FETCH_FAILED',
        message: errorMessage(err),
        recoverable: true,
        occurredAt: this.now().toISOString(),
        ...(err instanceof AgentDockHttpSourceError && err.url ? { detailsRef: err.url } : {}),
      });
      return null;
    }
  }

  private async fetchJson(path: string, signal?: AbortSignal): Promise<FetchJsonResult> {
    const url = this.apiUrl(path);
    let response: AgentDockJsonResponse;
    try {
      response = await this.fetchImpl(url, {
        headers: this.headers(),
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      throw new AgentDockHttpSourceError(
        `AgentDock API request failed for ${path}: ${errorMessage(err)}`,
        { url },
      );
    }
    if (!response.ok) {
      throw new AgentDockHttpSourceError(
        `AgentDock API request failed for ${path}: HTTP ${response.status} ${response.statusText}`,
        { status: response.status, url },
      );
    }
    try {
      return { url, value: await response.json() };
    } catch (err) {
      throw new AgentDockHttpSourceError(
        `AgentDock API response for ${path} was not valid JSON: ${errorMessage(err)}`,
        { status: response.status, url },
      );
    }
  }

  private apiUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (this.baseUrl.endsWith('/api') && normalizedPath.startsWith('/api/')) {
      return `${this.baseUrl}${normalizedPath.slice('/api'.length)}`;
    }
    if (this.baseUrl.endsWith('/api') && normalizedPath === '/api') {
      return this.baseUrl;
    }
    return `${this.baseUrl}${normalizedPath}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.authHeader) headers.authorization = this.authHeader;
    return headers;
  }
}

export function createHttpAgentDockSource(
  options: HttpAgentDockSourceOptions,
): HttpAgentDockSource {
  return new HttpAgentDockSource(options);
}

async function defaultFetch(
  url: string,
  init?: AgentDockFetchInit,
): Promise<AgentDockJsonResponse> {
  return globalThis.fetch(url, init);
}

function normalizeBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AgentDockHttpSourceError('AgentDock base URL must use http or https scheme.');
    }
    if (url.username || url.password) {
      throw new AgentDockHttpSourceError(
        'AgentDock base URL must not include username or password; use HARO_AGENTDOCK_AUTH_HEADER for credentials.',
      );
    }
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch (err) {
    throw new AgentDockHttpSourceError(`Invalid AgentDock base URL: ${errorMessage(err)}`);
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (Number.isInteger(value) && value !== undefined && value > 0) return value;
  return fallback;
}

function normalizeOptionalPositiveInt(value: number | undefined): number | undefined {
  if (Number.isInteger(value) && value !== undefined && value > 0) return value;
  return undefined;
}

function extractSessionRecords(value: unknown): JsonRecord[] {
  const root = asRecord(value);
  const sessions = root ? root.sessions : undefined;
  if (Array.isArray(sessions)) return sessions.filter(isRecord);
  if (isRecord(sessions)) {
    return Object.entries(sessions).flatMap(([id, session]) => {
      const record = asRecord(session);
      return record ? [{ id, ...record }] : [];
    });
  }
  return [];
}

function extractStatusSessionRecords(status: JsonRecord): JsonRecord[] {
  const sessions = status.sessions;
  return Array.isArray(sessions) ? sessions.filter(isRecord) : [];
}

function mergeSessionRecords(primary: JsonRecord[], secondary: JsonRecord[]): JsonRecord[] {
  const merged = new Map<string, JsonRecord>();
  for (const record of [...primary, ...secondary]) {
    const id = sessionIdFromRecord(record);
    if (!id) continue;
    const previous = merged.get(id) ?? {};
    merged.set(id, { ...record, ...previous, id });
  }
  return [...merged.values()];
}

function sessionIdFromRecord(record: JsonRecord): string | undefined {
  return firstString(record.id, record.session_id, record.sessionId, record.runtime_key);
}

function mapSessionObservation(record: JsonRecord): SessionObservation | null {
  const id = sessionIdFromRecord(record);
  if (!id) return null;
  const startedAt = firstIso(
    record.created_at,
    record.createdAt,
    record.started_at,
    record.startedAt,
  );
  const endedAt = firstIso(
    record.ended_at,
    record.endedAt,
    record.completed_at,
    record.completedAt,
  );
  return {
    id,
    ...optional(
      'channel',
      firstString(record.backing_jid, record.chat_jid, record.channel, record.channelId),
    ),
    ...optional('runnerId', firstString(record.runner_id, record.runnerId)),
    ...optional('model', firstString(record.model)),
    ...optional('profile', firstString(record.runner_profile_id, record.profile, record.profileId)),
    ...optional('startedAt', startedAt),
    ...optional('endedAt', endedAt),
  };
}

function mapMessageObservation(
  record: JsonRecord,
  sessionId: string,
  index: number,
  since: string | undefined,
  fallbackIso: string,
): TurnObservation | null {
  const createdAt =
    firstIso(record.timestamp, record.created_at, record.createdAt, record.startedAt) ??
    fallbackIso;
  if (!isOnOrAfter(createdAt, since)) return null;
  const rawId = firstString(record.id, record.message_id, record.messageId) ?? `message-${index}`;
  const excerpt = excerptFrom(record.content);
  return {
    id: `agentdock-message-${compactId(sessionId)}-${compactId(rawId)}`,
    sessionId,
    role: booleanFrom(record.is_from_me) ? 'assistant' : 'user',
    ...optional(
      'contentRef',
      `agentdock://sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(rawId)}`,
    ),
    ...optional('contentExcerpt', excerpt),
    createdAt,
  };
}

function mapUsageRecord(
  record: JsonRecord,
  sessionId: string,
  model: string | undefined,
  index: number,
  since: string | undefined,
  fallbackIso: string,
): UsageRecordObservation | null {
  const usage = asRecord(record.token_usage) ?? asRecord(record.tokenUsage);
  if (!usage) return null;
  const inputTokens =
    intFrom(usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokens) ?? 0;
  const outputTokens =
    intFrom(
      usage.output_tokens,
      usage.outputTokens,
      usage.completion_tokens,
      usage.completionTokens,
    ) ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return null;
  const recordedAt = firstIso(record.timestamp, record.created_at, record.createdAt) ?? fallbackIso;
  if (!isOnOrAfter(recordedAt, since)) return null;
  const rawId = firstString(record.id, record.message_id, record.messageId) ?? `usage-${index}`;
  return {
    id: `agentdock-usage-${compactId(sessionId)}-${compactId(rawId)}`,
    sessionId,
    ...optional('model', model),
    inputTokens,
    outputTokens,
    recordedAt,
  };
}

function mapFailedRuntimeTurn(
  record: JsonRecord,
  sessionId: string,
  index: number,
  since: string | undefined,
  fallbackIso: string,
): RunnerErrorObservation | null {
  const status = stringFrom(record.status)?.toLowerCase();
  if (status !== 'failed' && status !== 'error' && status !== 'timeout') return null;
  const occurredAt =
    firstIso(record.completedAt, record.completed_at, record.startedAt, record.started_at) ??
    fallbackIso;
  if (!isOnOrAfter(occurredAt, since)) return null;
  const rawId = firstString(record.id, record.turn_id, record.turnId) ?? `turn-${index}`;
  const code = status === 'timeout' ? 'AGENTDOCK_TURN_TIMEOUT' : 'AGENTDOCK_TURN_FAILED';
  return {
    id: `agentdock-runner-error-${compactId(sessionId)}-${compactId(rawId)}`,
    sessionId,
    code,
    message: excerptFrom(record.summary) ?? `AgentDock turn ${rawId} ended with status ${status}`,
    recoverable: status === 'timeout',
    occurredAt,
    detailsRef: `agentdock://sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(rawId)}`,
  };
}

function mapScheduledTaskRun(
  record: JsonRecord,
  index: number,
  since: string | undefined,
  fallbackIso: string,
): ScheduledTaskRunObservation | null {
  const taskId = firstString(record.id, record.task_id, record.taskId) ?? `task-${index}`;
  const startedAt = firstIso(record.last_run, record.lastRun, record.started_at, record.startedAt);
  const createdAt = firstIso(record.created_at, record.createdAt) ?? fallbackIso;
  const effectiveStartedAt = startedAt ?? createdAt;
  if (!isOnOrAfter(effectiveStartedAt, since)) return null;
  if (!startedAt && !isRunningTask(record) && !isSkippedTask(record)) return null;
  return {
    id: `agentdock-task-run-${compactId(taskId)}-${compactId(effectiveStartedAt)}`,
    taskId,
    executionType: stringFrom(record.execution_type) === 'script' ? 'script' : 'agent',
    status: mapTaskRunStatus(record, Boolean(startedAt)),
    startedAt: effectiveStartedAt,
    ...optional(
      'endedAt',
      firstIso(record.ended_at, record.endedAt, record.completed_at, record.completedAt),
    ),
    ...optional('resultRef', resultRefForTask(record, taskId)),
  };
}

function mapTaskRunStatus(
  record: JsonRecord,
  hasLastRun: boolean,
): ScheduledTaskRunObservation['status'] {
  const status = stringFrom(record.status)?.toLowerCase() ?? '';
  const lastResult = stringFrom(record.last_result, record.lastResult)?.toLowerCase() ?? '';
  if (
    status.includes('error') ||
    status.includes('fail') ||
    lastResult.includes('error') ||
    lastResult.includes('fail')
  ) {
    return 'error';
  }
  if (!hasLastRun && isSkippedTask(record)) return 'skipped';
  if (!hasLastRun && isRunningTask(record)) return 'running';
  return 'success';
}

function isRunningTask(record: JsonRecord): boolean {
  const status = stringFrom(record.status)?.toLowerCase();
  return status === 'running' || status === 'pending';
}

function isSkippedTask(record: JsonRecord): boolean {
  const status = stringFrom(record.status)?.toLowerCase();
  return (
    status === 'paused' || status === 'disabled' || status === 'skipped' || status === 'cancelled'
  );
}

function resultRefForTask(record: JsonRecord, taskId: string): string | undefined {
  const lastResult = stringFrom(record.last_result, record.lastResult);
  return lastResult ? `agentdock://tasks/${encodeURIComponent(taskId)}/last-result` : undefined;
}

function extractNamedArray(value: unknown, key: string): JsonRecord[] {
  const root = asRecord(value);
  const nested = root ? root[key] : undefined;
  return Array.isArray(nested) ? nested.filter(isRecord) : [];
}

function buildMetadata(input: {
  baseUrl: string;
  health: JsonRecord | null;
  status: JsonRecord;
  counters: ObservationCounters;
  sessionCount: number;
  turnCount: number;
  scheduledTaskRunCount: number;
  runnerErrorCount: number;
  usageRecordCount: number;
}): Record<string, string | number | boolean | null> {
  const healthStatus = stringFrom(input.health?.status);
  return {
    source: 'agentdock-http',
    baseUrl: input.baseUrl,
    healthStatus: healthStatus ?? null,
    activeRuntimes: numberFrom(input.status.activeRuntimes) ?? 0,
    queueLength: numberFrom(input.status.queueLength) ?? 0,
    fetchedSessionRecords: input.counters.sessionRecords,
    fetchedStatusSessionRecords: input.counters.statusSessionRecords,
    fetchedTaskRecords: input.counters.taskRecords,
    fetchedMessageRecords: input.counters.messageRecords,
    fetchedTurnRecords: input.counters.turnRecords,
    sessions: input.sessionCount,
    turns: input.turnCount,
    scheduledTaskRuns: input.scheduledTaskRunCount,
    runnerErrors: input.runnerErrorCount,
    usageRecords: input.usageRecordCount,
  };
}

function filterByObservationLimit<T>(items: T[], limit: number | undefined): T[] {
  return limit ? items.slice(0, limit) : items;
}

function isSessionObservationOnOrAfter(
  session: SessionObservation,
  since: string | undefined,
): boolean {
  if (!since) return true;
  return [session.startedAt, session.endedAt].some(
    (iso) => iso !== undefined && isOnOrAfter(iso, since),
  );
}

function isOnOrAfter(iso: string, since: string | undefined): boolean {
  if (!since) return true;
  return new Date(iso).getTime() >= new Date(since).getTime();
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const str = stringFrom(value);
    if (str) return str;
  }
  return undefined;
}

function stringFrom(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function firstIso(...values: unknown[]): string | undefined {
  for (const value of values) {
    const iso = isoFrom(value);
    if (iso) return iso;
  }
  return undefined;
}

function isoFrom(value: unknown): string | undefined {
  const str = stringFrom(value);
  if (!str) return undefined;
  const timestamp = Date.parse(str);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

function intFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    const num = numberFrom(value);
    if (num !== undefined && Number.isInteger(num) && num >= 0) return num;
  }
  return undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function booleanFrom(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function excerptFrom(value: unknown): string | undefined {
  const str = typeof value === 'string' ? value : stringifyJson(value);
  const trimmed = str.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
}

function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function optional<TValue>(key: string, value: TValue | undefined): Record<string, TValue> {
  return value === undefined ? {} : { [key]: value };
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function latestIso(values: Array<string | undefined>): string | undefined {
  const timestamps = values.flatMap((value) => {
    if (!value) return [];
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? [] : [{ value, timestamp }];
  });
  if (timestamps.length === 0) return undefined;
  return timestamps.reduce((latest, current) =>
    current.timestamp > latest.timestamp ? current : latest,
  ).value;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function compactId(value: string): string {
  const compacted = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return compacted.slice(0, 80) || 'id';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
