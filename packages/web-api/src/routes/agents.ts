import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import {
  DEFAULT_AGENT_ID,
  HaroError,
  loadAgentsFromDir,
  services,
  type RunAgentInput,
} from '@haro/core';
import { requireWebPermission } from '../auth.js';
import { getRunner, type WebRuntime } from '../runtime.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebSocketManager } from '../websocket/manager.js';
import { streamAgentRun } from '../websocket/streamer.js';

export type AgentSummaryReadModel = services.agents.AgentSummary;
export type AgentDetailReadModel = services.agents.AgentDetail;
export type AgentYamlResponse = services.agents.AgentYamlResponse;
export type AgentValidationIssue = services.agents.AgentValidationIssue;
export type AgentValidationResponse = services.agents.AgentValidationResponse;

export const deriveAgentSummary = services.agents.deriveAgentSummary;
export const toAgentSummary = services.agents.toAgentSummary;
export const toAgentDetail = services.agents.toAgentDetail;

type StrictRecord = Record<string, unknown>;
type RouteContext = Context<ApiKeyAuthEnv>;

const RUN_KEYS = new Set(['task', 'provider', 'model', 'noMemory']);
const CHAT_KEYS = new Set(['sessionId', 'content', 'provider', 'model', 'noMemory']);
const YAML_KEYS = new Set(['yaml']);

export function createAgentsRoute(runtime: WebRuntime, manager?: WebSocketManager): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();
  const ctx = (): services.ServiceContext => ({
    ...(runtime.root ? { root: runtime.root } : {}),
    ...(runtime.dbFile ? { dbFile: runtime.dbFile } : {}),
    logger: runtime.logger,
  });

  route.get('/', (c) => c.json({ success: true, data: services.agents.listAgents(runtime.agentRegistry) }));

  route.post('/', requireWebPermission('config-write'), async (c) => {
    const parsed = await parseStrictJson(c, YAML_KEYS, validateYamlEnvelope);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const result = await services.agents.createAgentFromYaml(ctx(), parsed.value.yaml);
      await reloadAgentRegistry(runtime);
      return c.json({ success: true, data: result.yaml }, 201);
    } catch (error) {
      const handled = handleAgentError(c, error);
      if (handled) return handled;
      throw error;
    }
  });

  route.get('/:id/yaml', async (c) => {
    const id = c.req.param('id');
    try {
      const yaml = await services.agents.readAgentYaml(ctx(), id);
      return c.json({ success: true, data: yaml });
    } catch (error) {
      const handled = handleAgentError(c, error);
      if (handled) return handled;
      throw error;
    }
  });

  route.put('/:id/yaml', requireWebPermission('config-write'), async (c) => {
    const id = c.req.param('id');
    const parsed = await parseStrictJson(c, YAML_KEYS, validateYamlEnvelope);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const yaml = await services.agents.updateAgentYaml(ctx(), id, parsed.value.yaml);
      await reloadAgentRegistry(runtime);
      return c.json({ success: true, data: yaml });
    } catch (error) {
      const handled = handleAgentError(c, error);
      if (handled) return handled;
      throw error;
    }
  });

  route.post('/:id/validate', async (c) => {
    const id = c.req.param('id');
    const idError = services.agents.validateAgentId(id);
    if (idError) return c.json({ error: idError }, 400);
    const parsed = await parseStrictJson(c, YAML_KEYS, validateYamlEnvelope);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json({ success: true, data: services.agents.validateAgentYaml(parsed.value.yaml, id) });
  });

  route.delete('/:id', requireWebPermission('config-write'), async (c) => {
    const id = c.req.param('id');
    try {
      const defaultAgentId = runtime.loaded?.config.defaultAgent ?? DEFAULT_AGENT_ID;
      const result = await services.agents.deleteAgent(ctx(), id, defaultAgentId);
      await reloadAgentRegistry(runtime);
      return c.json({ success: true, data: result });
    } catch (error) {
      const handled = handleAgentError(c, error);
      if (handled) return handled;
      throw error;
    }
  });

  route.get('/:id', (c) => {
    try {
      const detail = services.agents.getAgent(runtime.agentRegistry, c.req.param('id'));
      return c.json({ success: true, data: detail });
    } catch (error) {
      if (error instanceof HaroError && error.code === 'AGENT_NOT_FOUND') {
        return c.json({ error: 'Agent not found' }, 404);
      }
      throw error;
    }
  });

  route.post('/:id/run', requireWebPermission('local-write'), async (c) => {
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

  route.post('/:id/chat', requireWebPermission('local-write'), async (c) => {
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

async function reloadAgentRegistry(runtime: WebRuntime): Promise<void> {
  if (runtime.reloadAgentRegistry) {
    runtime.agentRegistry = await runtime.reloadAgentRegistry();
    return;
  }
  const report = await loadAgentsFromDir({
    agentsDir: services.agents.getAgentsDir({
      ...(runtime.root ? { root: runtime.root } : {}),
    }),
    ...(runtime.providerRegistry ? { providerRegistry: runtime.providerRegistry } : {}),
    bootstrap: false,
  });
  runtime.agentRegistry = report.registry;
}

function handleAgentError(c: RouteContext, error: unknown): Response | null {
  if (!(error instanceof HaroError)) return null;
  switch (error.code) {
    case 'AGENT_ID_INVALID':
      return c.json({ error: error.message }, 400);
    case 'AGENT_NOT_FOUND':
      return c.json({ error: 'Agent YAML not found' }, 404);
    case 'AGENT_ALREADY_EXISTS': {
      const issues = (error.details?.issues as services.agents.AgentValidationIssue[] | undefined) ?? [
        { path: 'id', message: error.message, code: 'conflict' as const },
      ];
      return c.json({ error: error.message, issues }, 409);
    }
    case 'AGENT_VALIDATION_FAILED': {
      const issues = (error.details?.issues as services.agents.AgentValidationIssue[] | undefined) ?? [];
      return c.json({ error: 'Agent YAML validation failed', issues }, 400);
    }
    case 'AGENT_DEFAULT_PROTECTED':
      return c.json({
        error: error.message,
        issues: [{ path: 'id', message: error.message, code: 'conflict' as const }],
      }, 400);
    default:
      return null;
  }
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

function validateYamlEnvelope(body: StrictRecord) {
  if (typeof body.yaml !== 'string' || body.yaml.trim().length === 0) {
    return { ok: false as const, error: "Field 'yaml' must be a non-empty string" };
  }
  return { ok: true as const, value: { yaml: body.yaml } };
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
