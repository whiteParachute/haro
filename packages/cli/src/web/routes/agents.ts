import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { AgentConfig, RunAgentInput } from '@haro/core';
import type { ApiKeyAuthEnv } from '../types.js';
import { getRunner, type WebRuntime } from '../runtime.js';
import type { WebSocketManager } from '../websocket/manager.js';
import { streamAgentRun } from '../websocket/streamer.js';

export interface AgentSummaryReadModel {
  id: string;
  name: string;
  summary: string;
  defaultProvider?: string;
  defaultModel?: string;
}

export interface AgentDetailReadModel extends AgentSummaryReadModel {
  systemPrompt: string;
  tools?: readonly string[];
}

type StrictRecord = Record<string, unknown>;
type RouteContext = Context<ApiKeyAuthEnv>;

const RUN_KEYS = new Set(['task', 'provider', 'model', 'noMemory']);
const CHAT_KEYS = new Set(['sessionId', 'content', 'provider', 'model', 'noMemory']);

export function deriveAgentSummary(agent: Pick<AgentConfig, 'name' | 'systemPrompt'>): string {
  const firstParagraph = agent.systemPrompt
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  const normalized = firstParagraph?.replace(/\s+/g, ' ').trim() ?? '';
  if (normalized.length === 0) return agent.name;
  return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}

export function toAgentSummary(agent: AgentConfig): AgentSummaryReadModel {
  const summary: AgentSummaryReadModel = {
    id: agent.id,
    name: agent.name,
    summary: deriveAgentSummary(agent),
  };
  if (agent.defaultProvider) summary.defaultProvider = agent.defaultProvider;
  if (agent.defaultModel) summary.defaultModel = agent.defaultModel;
  return summary;
}

export function toAgentDetail(agent: AgentConfig): AgentDetailReadModel {
  const detail: AgentDetailReadModel = {
    ...toAgentSummary(agent),
    systemPrompt: agent.systemPrompt,
  };
  if (agent.tools) detail.tools = agent.tools;
  return detail;
}

export function createAgentsRoute(runtime: WebRuntime, manager?: WebSocketManager): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', (c) => c.json({ success: true, data: runtime.agentRegistry.list().map(toAgentSummary) }));

  route.get('/:id', (c) => {
    const agent = runtime.agentRegistry.tryGet(c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ success: true, data: toAgentDetail(agent) });
  });

  route.post('/:id/run', async (c) => {
    const agent = runtime.agentRegistry.tryGet(c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const parsed = await parseStrictJson(c, RUN_KEYS, validateRunBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const sessionId = startBackgroundRun(runtime, manager, {
      task: parsed.value.task,
      agentId: agent.id,
      ...(parsed.value.provider ? { provider: parsed.value.provider } : {}),
      ...(parsed.value.model ? { model: parsed.value.model } : {}),
      ...(parsed.value.noMemory ? { noMemory: true } : {}),
      continueLatestSession: false,
    });
    return c.json({ success: true, data: { sessionId } });
  });

  route.post('/:id/chat', async (c) => {
    const agent = runtime.agentRegistry.tryGet(c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    const parsed = await parseStrictJson(c, CHAT_KEYS, validateChatBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const sessionId = startBackgroundRun(runtime, manager, {
      task: parsed.value.content,
      agentId: agent.id,
      ...(parsed.value.provider ? { provider: parsed.value.provider } : {}),
      ...(parsed.value.model ? { model: parsed.value.model } : {}),
      ...(parsed.value.noMemory ? { noMemory: true } : {}),
      continueLatestSession: true,
    }, parsed.value.sessionId);
    return c.json({ success: true, data: { sessionId } });
  });

  return route;
}

function startBackgroundRun(
  runtime: WebRuntime,
  manager: WebSocketManager | undefined,
  input: RunAgentInput,
  preferredSessionId: string = randomUUID(),
): string {
  manager?.publishSessionUpdate(preferredSessionId, 'running');
  void streamAgentRun({
    runner: getRunner(runtime, () => preferredSessionId),
    manager,
    logger: runtime.logger,
    input,
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    manager?.publishError(preferredSessionId, message);
    manager?.publishSessionUpdate(preferredSessionId, 'failed');
    runtime.logger.error?.({ sessionId: preferredSessionId, err: message }, 'web agent run failed');
  });
  return preferredSessionId;
}

async function parseStrictJson<T>(
  c: RouteContext,
  keys: Set<string>,
  validate: (value: StrictRecord) => { ok: true; value: T } | { ok: false; error: string },
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  if (!isRecord(body)) return { ok: false, error: 'Request body must be a JSON object' };
  const unknownKey = Object.keys(body).find((key) => !keys.has(key));
  if (unknownKey) return { ok: false, error: `Unknown field '${unknownKey}'` };
  return validate(body);
}

function validateRunBody(body: StrictRecord) {
  if (typeof body.task !== 'string' || body.task.trim().length === 0) {
    return { ok: false as const, error: "Field 'task' must be a non-empty string" };
  }
  const common = validateOptionalRouting(body);
  if (!common.ok) return common;
  return { ok: true as const, value: { task: body.task, ...common.value } };
}

function validateChatBody(body: StrictRecord) {
  if (typeof body.sessionId !== 'string' || body.sessionId.trim().length === 0) {
    return { ok: false as const, error: "Field 'sessionId' must be a non-empty string" };
  }
  if (typeof body.content !== 'string' || body.content.trim().length === 0) {
    return { ok: false as const, error: "Field 'content' must be a non-empty string" };
  }
  const common = validateOptionalRouting(body);
  if (!common.ok) return common;
  return { ok: true as const, value: { sessionId: body.sessionId, content: body.content, ...common.value } };
}

function validateOptionalRouting(body: StrictRecord) {
  const value: { provider?: string; model?: string; noMemory?: boolean } = {};
  if (body.provider !== undefined) {
    if (typeof body.provider !== 'string' || body.provider.trim().length === 0) {
      return { ok: false as const, error: "Field 'provider' must be a non-empty string" };
    }
    value.provider = body.provider;
  }
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.trim().length === 0) {
      return { ok: false as const, error: "Field 'model' must be a non-empty string" };
    }
    value.model = body.model;
  }
  if (body.noMemory !== undefined) {
    if (typeof body.noMemory !== 'boolean') {
      return { ok: false as const, error: "Field 'noMemory' must be a boolean" };
    }
    value.noMemory = body.noMemory;
  }
  return { ok: true as const, value };
}

function isRecord(value: unknown): value is StrictRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
