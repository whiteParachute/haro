import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  AGENT_ID_MAX_LENGTH,
  AGENT_ID_PATTERN,
  AgentRegistry,
  loadAgentsFromDir,
  parseAgentConfig,
  type AgentConfig,
} from '../agent/index.js';
import { buildHaroPaths } from '../paths.js';
import { ProviderRegistry } from '../provider/index.js';
import { HaroError } from '../errors/index.js';
import type { ServiceContext } from './types.js';

export interface AgentSummary {
  id: string;
  name: string;
  summary: string;
  defaultProvider?: string;
  defaultModel?: string;
}

export interface AgentDetail extends AgentSummary {
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

export interface AgentsServiceContext extends ServiceContext {
  providerRegistry?: ProviderRegistry;
}

export function deriveAgentSummary(agent: Pick<AgentConfig, 'name' | 'systemPrompt'>): string {
  const firstParagraph = agent.systemPrompt
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  const normalized = firstParagraph?.replace(/\s+/g, ' ').trim() ?? '';
  if (normalized.length === 0) return agent.name;
  return normalized.length > 160 ? normalized.slice(0, 160) : normalized;
}

export function toAgentSummary(agent: AgentConfig): AgentSummary {
  const summary: AgentSummary = {
    id: agent.id,
    name: agent.name,
    summary: deriveAgentSummary(agent),
  };
  if (agent.defaultProvider) summary.defaultProvider = agent.defaultProvider;
  if (agent.defaultModel) summary.defaultModel = agent.defaultModel;
  return summary;
}

export function toAgentDetail(agent: AgentConfig): AgentDetail {
  const detail: AgentDetail = { ...toAgentSummary(agent), systemPrompt: agent.systemPrompt };
  if (agent.tools) detail.tools = agent.tools;
  return detail;
}

export function listAgents(registry: AgentRegistry): AgentSummary[] {
  return registry.list().map(toAgentSummary);
}

export function getAgent(registry: AgentRegistry, id: string): AgentDetail {
  const agent = registry.tryGet(id);
  if (!agent) {
    throw new HaroError('AGENT_NOT_FOUND', `Agent '${id}' not found`, {
      remediation: 'Run `haro agent list` to see available agents',
    });
  }
  return toAgentDetail(agent);
}

export function validateAgentId(id: string): string | null {
  if (id.length === 0) return 'Agent id is required';
  if (id.length > AGENT_ID_MAX_LENGTH) return `Agent id must be ≤ ${AGENT_ID_MAX_LENGTH} chars`;
  if (!AGENT_ID_PATTERN.test(id)) return "Agent id must be kebab-case: ^[a-z0-9][a-z0-9-]*[a-z0-9]$";
  return null;
}

export function assertAgentId(id: string): void {
  const error = validateAgentId(id);
  if (error) {
    throw new HaroError('AGENT_ID_INVALID', error, {
      remediation: 'Use a kebab-case id matching ^[a-z0-9][a-z0-9-]*[a-z0-9]$',
    });
  }
}

export function validateAgentYaml(yaml: string, expectedId?: string): AgentValidationResponse {
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
      issues: [
        createIssue('id', `YAML id '${parsed.config.id}' must match route id '${expectedId}'`, 'id-mismatch'),
      ],
    };
  }

  return { ok: true, id: parsed.config.id, issues: [] };
}

export function getAgentsDir(ctx: ServiceContext): string {
  return buildHaroPaths(ctx.root).dirs.agents;
}

export function getAgentYamlFile(ctx: ServiceContext, id: string): string {
  return join(getAgentsDir(ctx), `${id}.yaml`);
}

export async function readAgentYaml(ctx: ServiceContext, id: string): Promise<AgentYamlResponse> {
  assertAgentId(id);
  const file = getAgentYamlFile(ctx, id);
  if (!existsSync(file)) {
    throw new HaroError('AGENT_NOT_FOUND', `Agent YAML for '${id}' not found`, {
      remediation: `Create it via \`haro agent create ${id} --from-template default\``,
    });
  }
  const [yaml, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  return { id, yaml, updatedAt: info.mtime.toISOString() };
}

export interface CreateAgentResult {
  ok: boolean;
  id?: string;
  yaml?: AgentYamlResponse;
  validation?: AgentValidationResponse;
}

export async function createAgentFromYaml(
  ctx: ServiceContext,
  yaml: string,
): Promise<{ id: string; yaml: AgentYamlResponse }> {
  const validation = validateAgentYaml(yaml);
  if (!validation.ok) {
    throw new HaroError('AGENT_VALIDATION_FAILED', 'Agent YAML validation failed', {
      details: { issues: validation.issues },
      remediation: 'Fix the listed issues and re-run',
    });
  }
  const file = getAgentYamlFile(ctx, validation.id);
  if (existsSync(file)) {
    throw new HaroError('AGENT_ALREADY_EXISTS', `Agent '${validation.id}' already exists`, {
      remediation: `Edit the existing agent via \`haro agent edit ${validation.id}\``,
    });
  }
  await persistAgentYaml(ctx, validation.id, yaml);
  return { id: validation.id, yaml: await readAgentYaml(ctx, validation.id) };
}

export async function updateAgentYaml(
  ctx: ServiceContext,
  id: string,
  yaml: string,
): Promise<AgentYamlResponse> {
  assertAgentId(id);
  const validation = validateAgentYaml(yaml, id);
  if (!validation.ok) {
    throw new HaroError('AGENT_VALIDATION_FAILED', 'Agent YAML validation failed', {
      details: { issues: validation.issues },
      remediation: 'Fix the listed issues and re-run',
    });
  }
  await persistAgentYaml(ctx, id, yaml);
  return readAgentYaml(ctx, id);
}

export async function deleteAgent(
  ctx: ServiceContext,
  id: string,
  defaultAgentId: string,
): Promise<{ id: string; deleted: true }> {
  assertAgentId(id);
  if (id === defaultAgentId) {
    throw new HaroError('AGENT_DEFAULT_PROTECTED', `Cannot delete defaultAgent '${id}'`, {
      remediation: 'Change `defaultAgent` in config first, then delete',
    });
  }
  const file = getAgentYamlFile(ctx, id);
  if (!existsSync(file)) {
    throw new HaroError('AGENT_NOT_FOUND', `Agent YAML for '${id}' not found`, {
      remediation: 'Run `haro agent list` to see available agents',
    });
  }
  await rm(file);
  return { id, deleted: true };
}

export async function persistAgentYaml(ctx: ServiceContext, id: string, yaml: string): Promise<void> {
  const agentsDir = getAgentsDir(ctx);
  await mkdir(agentsDir, { recursive: true });
  await writeFile(getAgentYamlFile(ctx, id), yaml.endsWith('\n') ? yaml : `${yaml}\n`, 'utf8');
}

export async function reloadAgentsFromDisk(
  ctx: AgentsServiceContext,
): Promise<AgentRegistry> {
  const report = await loadAgentsFromDir({
    agentsDir: getAgentsDir(ctx),
    ...(ctx.providerRegistry ? { providerRegistry: ctx.providerRegistry } : {}),
    bootstrap: false,
  });
  return report.registry;
}

function createIssue(
  path: string,
  message: string,
  code: NonNullable<AgentValidationIssue['code']>,
): AgentValidationIssue {
  return { path, message, code };
}
