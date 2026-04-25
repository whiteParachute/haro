import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { AGENT_ID_MAX_LENGTH, AGENT_ID_PATTERN, buildHaroPaths, DEFAULT_AGENT_ID, loadAgentsFromDir, parseAgentConfig, type AgentConfig, type RunAgentInput } from '@haro/core';
import { parse as parseYaml } from 'yaml';
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

export interface AgentYamlResponse {
  id: string;
  yaml: string;
  updatedAt?: string;
}

export interface AgentValidationIssue {
  path: string;
  message: string;
  code?: 'schema' | 'unknown-field' | 'id-mismatch' | 'yaml-parse' | 'conflict';
}

export type AgentValidationResponse =
  | { ok: true; id: string; issues: [] }
  | { ok: false; id?: string; issues: AgentValidationIssue[] };

type StrictRecord = Record<string, unknown>;
type RouteContext = Context<ApiKeyAuthEnv>;

const RUN_KEYS = new Set(['task', 'provider', 'model', 'noMemory']);
const CHAT_KEYS = new Set(['sessionId', 'content', 'provider', 'model', 'noMemory']);
const YAML_KEYS = new Set(['yaml']);

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

  route.post('/', async (c) => {
    const parsed = await parseStrictJson(c, YAML_KEYS, validateYamlEnvelope);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const validation = validateAgentYaml(parsed.value.yaml);
    if (!validation.ok) {
      return c.json({ error: 'Agent YAML validation failed', issues: validation.issues }, 400);
    }

    const file = getAgentYamlFile(runtime, validation.id);
    if (existsSync(file)) {
      return c.json({
        error: `Agent '${validation.id}' already exists`,
        issues: [createIssue('id', `Agent '${validation.id}' already exists`, 'conflict')],
      }, 409);
    }

    await persistAgentYaml(runtime, validation.id, parsed.value.yaml);
    await reloadAgentRegistry(runtime);
    return c.json({ success: true, data: await readAgentYamlResponse(runtime, validation.id) }, 201);
  });

  route.get('/:id/yaml', async (c) => {
    const id = c.req.param('id');
    const idError = validateRouteAgentId(id);
    if (idError) return c.json({ error: idError }, 400);

    const file = getAgentYamlFile(runtime, id);
    if (!existsSync(file)) return c.json({ error: 'Agent YAML not found' }, 404);
    return c.json({ success: true, data: await readAgentYamlResponse(runtime, id) });
  });

  route.put('/:id/yaml', async (c) => {
    const id = c.req.param('id');
    const idError = validateRouteAgentId(id);
    if (idError) return c.json({ error: idError }, 400);
    const parsed = await parseStrictJson(c, YAML_KEYS, validateYamlEnvelope);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const validation = validateAgentYaml(parsed.value.yaml, id);
    if (!validation.ok) {
      return c.json({ error: 'Agent YAML validation failed', issues: validation.issues }, 400);
    }

    await persistAgentYaml(runtime, id, parsed.value.yaml);
    await reloadAgentRegistry(runtime);
    return c.json({ success: true, data: await readAgentYamlResponse(runtime, id) });
  });

  route.post('/:id/validate', async (c) => {
    const id = c.req.param('id');
    const idError = validateRouteAgentId(id);
    if (idError) return c.json({ error: idError }, 400);
    const parsed = await parseStrictJson(c, YAML_KEYS, validateYamlEnvelope);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json({ success: true, data: validateAgentYaml(parsed.value.yaml, id) });
  });

  route.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const idError = validateRouteAgentId(id);
    if (idError) return c.json({ error: idError }, 400);
    const defaultAgent = runtime.loaded?.config.defaultAgent ?? DEFAULT_AGENT_ID;
    if (id === defaultAgent) {
      return c.json({
        error: `Cannot delete defaultAgent '${id}'`,
        issues: [createIssue('id', `Cannot delete defaultAgent '${id}'`, 'conflict')],
      }, 400);
    }

    const file = getAgentYamlFile(runtime, id);
    if (!existsSync(file)) return c.json({ error: 'Agent YAML not found' }, 404);
    await rm(file);
    await reloadAgentRegistry(runtime);
    return c.json({ success: true, data: { id, deleted: true } });
  });

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

function validateRouteAgentId(id: string): string | undefined {
  if (id.length === 0) return 'Agent id is required';
  if (id.length > AGENT_ID_MAX_LENGTH) return `Agent id must be ≤ ${AGENT_ID_MAX_LENGTH} chars`;
  if (!AGENT_ID_PATTERN.test(id)) return "Agent id must be kebab-case: ^[a-z0-9][a-z0-9-]*[a-z0-9]$";
  return undefined;
}

function validateAgentYaml(yaml: string, expectedId?: string): AgentValidationResponse {
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch (error) {
    return {
      ok: false,
      issues: [createIssue('<root>', error instanceof Error ? error.message : String(error), 'yaml-parse')],
    };
  }

  const parsed = parseAgentConfig(data);
  if (!parsed.ok) {
    const issues = parsed.error.issues.map((issue) =>
      createIssue(
        issue.path,
        issue.message,
        issue.message.startsWith('Unknown field ') ? 'unknown-field' : 'schema',
      ),
    );
    return { ok: false, issues };
  }

  if (expectedId && parsed.config.id !== expectedId) {
    return {
      ok: false,
      id: parsed.config.id,
      issues: [createIssue('id', `YAML id '${parsed.config.id}' must match route id '${expectedId}'`, 'id-mismatch')],
    };
  }

  return { ok: true, id: parsed.config.id, issues: [] };
}

function createIssue(path: string, message: string, code: NonNullable<AgentValidationIssue['code']>): AgentValidationIssue {
  return { path, message, code };
}

function getAgentsDir(runtime: WebRuntime): string {
  return buildHaroPaths(runtime.root).dirs.agents;
}

function getAgentYamlFile(runtime: WebRuntime, id: string): string {
  return join(getAgentsDir(runtime), `${id}.yaml`);
}

async function readAgentYamlResponse(runtime: WebRuntime, id: string): Promise<AgentYamlResponse> {
  const file = getAgentYamlFile(runtime, id);
  const [yaml, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  return {
    id,
    yaml,
    updatedAt: info.mtime.toISOString(),
  };
}

async function persistAgentYaml(runtime: WebRuntime, id: string, yaml: string): Promise<void> {
  const agentsDir = getAgentsDir(runtime);
  await mkdir(agentsDir, { recursive: true });
  await writeFile(getAgentYamlFile(runtime, id), yaml.endsWith('\n') ? yaml : `${yaml}\n`, 'utf8');
}

async function reloadAgentRegistry(runtime: WebRuntime): Promise<void> {
  if (runtime.reloadAgentRegistry) {
    runtime.agentRegistry = await runtime.reloadAgentRegistry();
    return;
  }
  const report = await loadAgentsFromDir({
    agentsDir: getAgentsDir(runtime),
    ...(runtime.providerRegistry ? { providerRegistry: runtime.providerRegistry } : {}),
    logger: runtime.logger,
    bootstrap: false,
  });
  runtime.agentRegistry = report.registry;
}
