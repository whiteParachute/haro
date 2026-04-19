import { z, ZodError } from 'zod';
import type { AgentConfig } from './types.js';

/**
 * FEAT-004 R1 + R2 — Zod schema for AgentConfig.
 *
 * Hard rules (see spec §1):
 *   • `.strict()` — every unknown field is rejected. We do NOT maintain a
 *     "deferred fields" allowlist, because owning a list of "fields that
 *     might come back later" is itself the persona-shaped thinking the
 *     spec rejects. The error message is fixed and points readers at the
 *     spec rather than enumerating individual fields.
 *   • Error format: `Unknown field '<name>' in agent '<id>'. Agent 的行为
 *     由 tools 决定，不由字段描述（见 FEAT-004 §1）`
 *
 * `id` constraint mirrors §5: kebab-case, ≤ 64 chars.
 */
export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
export const AGENT_ID_MAX_LENGTH = 64;

export const agentConfigSchema = z
  .object({
    id: z
      .string()
      .min(1, 'Agent id is required')
      .max(AGENT_ID_MAX_LENGTH, `Agent id must be ≤ ${AGENT_ID_MAX_LENGTH} chars`)
      .regex(
        AGENT_ID_PATTERN,
        "Agent id must be kebab-case: ^[a-z0-9][a-z0-9-]*[a-z0-9]$",
      ),
    name: z.string().min(1, 'Agent name is required'),
    systemPrompt: z.string().min(1, 'Agent systemPrompt is required'),
    tools: z.array(z.string().min(1)).readonly().optional(),
    defaultProvider: z.string().min(1).optional(),
    defaultModel: z.string().min(1).optional(),
  })
  .strict();

/**
 * The fixed unknown-field message format from R2. Exported so tests can
 * assert exact wording without duplicating the literal.
 */
export function buildUnknownFieldMessage(field: string, agentId: string): string {
  return `Unknown field '${field}' in agent '${agentId}'. Agent 的行为由 tools 决定，不由字段描述（见 FEAT-004 §1）`;
}

export interface AgentSchemaValidationOk {
  ok: true;
  config: AgentConfig;
}

export interface AgentSchemaValidationErr {
  ok: false;
  error: AgentSchemaValidationError;
}

export type AgentSchemaValidationResult =
  | AgentSchemaValidationOk
  | AgentSchemaValidationErr;

export class AgentSchemaValidationError extends Error {
  readonly issues: readonly { path: string; message: string }[];

  constructor(message: string, issues: readonly { path: string; message: string }[]) {
    super(message);
    this.name = 'AgentSchemaValidationError';
    this.issues = issues;
  }
}

/**
 * Parse + validate raw YAML data into AgentConfig.
 *
 * Returns an `ok=false` result instead of throwing so the loader can keep
 * processing the rest of the directory after a single bad file (R5).
 *
 * The "agent id" surfaced in unknown-field errors is the id present in the
 * YAML (if any), falling back to the literal string `<missing-id>`. We
 * deliberately resolve that BEFORE handing data to Zod so the error message
 * matches R2 even when the unknown field appears alongside a missing id.
 */
export function parseAgentConfig(data: unknown): AgentSchemaValidationResult {
  const idForMessage =
    data && typeof data === 'object' && 'id' in data && typeof (data as Record<string, unknown>).id === 'string'
      ? ((data as Record<string, unknown>).id as string)
      : '<missing-id>';
  const result = agentConfigSchema.safeParse(data);
  if (result.success) {
    return { ok: true, config: result.data as AgentConfig };
  }
  const issues = collectIssues(result.error, idForMessage);
  const summary = issues.map((i) => i.message).join('; ');
  return {
    ok: false,
    error: new AgentSchemaValidationError(
      `Agent '${idForMessage}' failed schema validation: ${summary}`,
      issues,
    ),
  };
}

function collectIssues(
  err: ZodError,
  agentId: string,
): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  for (const issue of err.issues) {
    if (issue.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: string[] }).keys ?? [];
      for (const key of keys) {
        out.push({
          path: key,
          message: buildUnknownFieldMessage(key, agentId),
        });
      }
      continue;
    }
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    out.push({ path, message: issue.message });
  }
  return out;
}
