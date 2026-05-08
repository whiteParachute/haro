/**
 * AgentDock sidecar MCP tools (FEAT-044).
 *
 * This is the AgentDock-facing registry used by `haro mcp`. It deliberately
 * exposes only read-only / dry-run tools and uses @haro/agentdock-contract
 * schemas for payload validation.
 */

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AssetEvent,
  AssetEventType,
  AssetKind,
  AssetStatus,
  EvolutionProposal,
  ObservationBatch,
  Ref,
  ValidationReport,
} from '@haro/agentdock-contract';
import {
  AssetEventSchema,
  AssetKindSchema,
  AssetStatusSchema,
  EvolutionProposalSchema,
  ObservationBatchSchema,
  RefSchema,
  ValidationReportSchema,
  createFakeAgentDockSource,
  createHttpAgentDockSource,
  AgentDockHttpSourceError,
} from '@haro/agentdock-contract';
import type {
  EvolutionAsset,
  EvolutionAssetKind,
  EvolutionAssetStatus,
} from '@haro/core/evolution';
import { McpToolError } from './error.js';
import type { PermissionEvaluator } from './permission.js';
import { ToolRegistry, type RegistryOptions } from './registry.js';
import type { PermissionDecisionOutput, ToolDefinition, ToolErrorCode } from './types.js';

const SIDECAR_TOOL_NAMES = [
  'haro_observe',
  'haro_propose',
  'haro_validate',
  'haro_asset_query',
] as const;

const SIDECAR_TOOL_NAME_SET = new Set<string>(SIDECAR_TOOL_NAMES);

export const HaroObserveInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type HaroObserveInput = z.infer<typeof HaroObserveInputSchema>;

export const haroObserveTool: ToolDefinition<typeof HaroObserveInputSchema, ObservationBatch> = {
  name: 'haro_observe',
  description:
    'Read AgentDock observation signals through the configured sidecar source. Returns an ObservationBatch contract payload. Read-only.',
  inputSchema: HaroObserveInputSchema,
  timeoutMs: 5_000,
  async execute(params, ctx): Promise<ObservationBatch> {
    try {
      const batch = await collectAgentDockObservationBatch(params, ctx);
      return ObservationBatchSchema.parse(limitObservationBatch(batch, params.limit));
    } catch (err) {
      if (err instanceof AgentDockHttpSourceError) {
        throw new McpToolError(
          agentDockSourceErrorCode(err),
          `Unable to collect AgentDock observations: ${err.message}`,
          remediationForAgentDockSourceError(err),
        );
      }
      throw err;
    }
  },
};

async function collectAgentDockObservationBatch(
  params: HaroObserveInput,
  ctx: { now: () => Date; signal: AbortSignal },
): Promise<ObservationBatch> {
  const baseUrl = normalizeEnvString(process.env.HARO_AGENTDOCK_BASE_URL);
  if (baseUrl && !shouldForceFakeAgentDockSource()) {
    const source = createHttpAgentDockSource({
      baseUrl,
      connectionId:
        params.connectionId ??
        normalizeEnvString(process.env.HARO_AGENTDOCK_CONNECTION_ID) ??
        'agentdock-local',
      authHeader: normalizeEnvString(process.env.HARO_AGENTDOCK_AUTH_HEADER),
      now: ctx.now,
    });
    return source.collectObservationBatch({
      ...(params.since ? { since: params.since } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
      signal: ctx.signal,
    });
  }

  const source = createFakeAgentDockSource({
    ...(params.connectionId ? { connectionId: params.connectionId } : {}),
    now: ctx.now().toISOString(),
  });
  const batch = source.collectObservationBatch();
  return ObservationBatchSchema.parse({
    ...batch,
    window: {
      ...batch.window,
      ...(params.since ? { since: params.since } : {}),
    },
  });
}

function agentDockSourceErrorCode(err: AgentDockHttpSourceError): ToolErrorCode {
  if (
    /^Invalid AgentDock base URL:|must not include username or password|must use http or https scheme/.test(
      err.message,
    )
  ) {
    return 'INVALID_PARAMS';
  }
  if (err.status === 401 || err.status === 403) return 'PERMISSION_DENIED';
  if (err.status === 404) return 'TARGET_NOT_FOUND';
  return 'INTERNAL_ERROR';
}

function remediationForAgentDockSourceError(err: AgentDockHttpSourceError): string {
  if (err.status === 401 || err.status === 403) {
    return 'Verify HARO_AGENTDOCK_AUTH_HEADER or AgentDock API credentials, then retry.';
  }
  if (err.status === 404) {
    return 'Verify HARO_AGENTDOCK_BASE_URL points at the AgentDock web/API endpoint, or set HARO_AGENTDOCK_SOURCE=fake for fixture mode.';
  }
  if (/must not include username or password/.test(err.message)) {
    return 'Move credentials from HARO_AGENTDOCK_BASE_URL into HARO_AGENTDOCK_AUTH_HEADER.';
  }
  if (/must use http or https scheme/.test(err.message)) {
    return 'Set HARO_AGENTDOCK_BASE_URL to an absolute http(s) AgentDock base URL.';
  }
  if (/^Invalid AgentDock base URL:/.test(err.message)) {
    return 'Set HARO_AGENTDOCK_BASE_URL to an absolute http(s) AgentDock base URL.';
  }
  return 'Verify AgentDock is reachable and returning valid JSON, then retry; set HARO_AGENTDOCK_SOURCE=fake only for offline fixture mode.';
}

function shouldForceFakeAgentDockSource(): boolean {
  const mode = normalizeEnvString(process.env.HARO_AGENTDOCK_SOURCE)?.toLowerCase();
  return mode === 'fake' || mode === 'fixture';
}

function normalizeEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const HaroProposeInputSchema = z.object({
  observationRefs: z.array(RefSchema).min(1).optional(),
  mode: z.literal('dry-run'),
});

export type HaroProposeInput = z.infer<typeof HaroProposeInputSchema>;

export const haroProposeTool: ToolDefinition<typeof HaroProposeInputSchema, EvolutionProposal> = {
  name: 'haro_propose',
  description:
    'Generate a dry-run EvolutionProposal from AgentDock observation refs. It never applies changes. Read-only.',
  inputSchema: HaroProposeInputSchema,
  timeoutMs: 5_000,
  async execute(params, ctx): Promise<EvolutionProposal> {
    const now = ctx.now().toISOString();
    const sourceObservationRefs = params.observationRefs ?? [defaultObservationRef()];
    const proposalId = `proposal_${randomUUID()}`;
    const targetRef: Ref = {
      id: 'agentdock:haro-sidecar-registration',
      kind: 'mcp-tool-config',
      uri: 'agentdock://mcp-servers/haro',
    };
    const contentRef = `haro-sidecar://proposals/${proposalId}/dry-run`;
    const contentHash = sha256(JSON.stringify({ sourceObservationRefs, contentRef }));
    return EvolutionProposalSchema.parse({
      id: proposalId,
      title: 'Dry-run AgentDock sidecar improvement proposal',
      status: 'dry-run',
      level: 'L0',
      targetKind: 'mcp-tool-config',
      riskLevel: 'low',
      sourceObservationRefs,
      changeSet: [
        {
          op: 'update',
          targetRef,
          contentRef,
          contentHash,
          summary:
            'Review AgentDock observation signals and prepare a dry-run MCP sidecar registration/config improvement proposal.',
        },
      ],
      testPlan: {
        requiredCommands: ['pnpm -F @haro/agentdock-contract test', 'pnpm -F @haro/mcp-tools test'],
        manualChecks: [
          'Register `haro mcp` as an external AgentDock MCP server and verify tools/list shows read-only tools only.',
        ],
        regressionRisks: [
          'AgentDock MCP registration shape may differ from local fake-source assumptions.',
        ],
      },
      rollbackPlan: {
        strategy:
          'No runtime write is performed by haro_propose; discard the dry-run proposal or remove the external MCP server registration if manually tested.',
        snapshotRequired: false,
        rollbackRefs: [],
      },
      createdAt: now,
      updatedAt: now,
    });
  },
};

export const HaroValidateInputSchema = z.object({
  proposalId: z.string().min(1),
});

export type HaroValidateInput = z.infer<typeof HaroValidateInputSchema>;

export const haroValidateTool: ToolDefinition<typeof HaroValidateInputSchema, ValidationReport> = {
  name: 'haro_validate',
  description:
    'Validate a dry-run proposal id and return a ValidationReport contract payload. It does not mutate proposals. Read-only.',
  inputSchema: HaroValidateInputSchema,
  timeoutMs: 5_000,
  async execute(params, ctx): Promise<ValidationReport> {
    return ValidationReportSchema.parse({
      id: `validation_${randomUUID()}`,
      proposalId: params.proposalId,
      riskVerdict: 'low',
      requiredTests: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/mcp-tools test',
        'Manual AgentDock external MCP tools/list smoke test',
      ],
      rollbackReady: true,
      applyEligible: false,
      blockingReasons: [
        'FEAT-044 is read-only; validation reports are advisory and cannot make a proposal apply-eligible.',
      ],
      evidenceRefs: [
        {
          id: params.proposalId,
          kind: 'evolution-proposal',
          uri: `haro-sidecar://proposals/${params.proposalId}`,
        },
      ],
      createdAt: ctx.now().toISOString(),
    });
  },
};

export const HaroAssetQueryInputSchema = z.object({
  kind: AssetKindSchema.optional(),
  status: AssetStatusSchema.optional(),
  query: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const HaroAssetQueryOutputSchema = z.object({
  assets: z.array(AssetEventSchema),
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  query: z.object({
    kind: AssetKindSchema.optional(),
    status: AssetStatusSchema.optional(),
    text: z.string().min(1).optional(),
  }),
});

export type HaroAssetQueryInput = z.infer<typeof HaroAssetQueryInputSchema>;
export type HaroAssetQueryOutput = z.infer<typeof HaroAssetQueryOutputSchema>;

export const haroAssetQueryTool: ToolDefinition<
  typeof HaroAssetQueryInputSchema,
  HaroAssetQueryOutput
> = {
  name: 'haro_asset_query',
  description:
    'Query Haro sidecar asset registry and return AssetEvent contract summaries. Read-only.',
  inputSchema: HaroAssetQueryInputSchema,
  timeoutMs: 5_000,
  async execute(params, ctx): Promise<HaroAssetQueryOutput> {
    const evolution = ctx.deps.evolution;
    if (!evolution) {
      throw new McpToolError(
        'TARGET_NOT_FOUND',
        'EvolutionAssetRegistry is unavailable for haro_asset_query',
      );
    }

    const limit = params.limit ?? 100;
    const coreKind = params.kind ? contractKindToCore(params.kind) : undefined;
    const coreStatus = params.status ? contractStatusToCore(params.status) : undefined;
    const unsupportedFilter = (params.kind && !coreKind) || (params.status && !coreStatus);
    const assets = unsupportedFilter
      ? []
      : evolution.listAssets({
          ...(coreKind ? { kind: coreKind } : {}),
          ...(coreStatus ? { status: coreStatus } : {}),
          includeArchived: true,
          limit: Math.max(limit * 2, limit),
        });
    const filtered = filterAssets(assets, params.query).slice(0, limit);
    const contractAssets = filtered.map(assetToContractEvent);
    return HaroAssetQueryOutputSchema.parse({
      assets: contractAssets,
      count: contractAssets.length,
      limit,
      query: {
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.query ? { text: params.query } : {}),
      },
    });
  },
};

export const allowSidecarReadOnlyTools: PermissionEvaluator = (input): PermissionDecisionOutput => {
  if (SIDECAR_TOOL_NAME_SET.has(input.toolName)) {
    return { decision: 'allowed' };
  }
  return {
    decision: 'denied',
    reason: `tool '${input.toolName}' is not part of the FEAT-044 read-only sidecar surface`,
  };
};

export function createSidecarRegistry(options: RegistryOptions): ToolRegistry {
  const registry = new ToolRegistry({
    ...options,
    permissionEvaluator: options.permissionEvaluator ?? allowSidecarReadOnlyTools,
  });
  registry.register(haroObserveTool);
  registry.register(haroProposeTool);
  registry.register(haroValidateTool);
  registry.register(haroAssetQueryTool);
  return registry;
}

function limitObservationBatch(batch: ObservationBatch, limit?: number): ObservationBatch {
  if (!limit) return batch;
  return {
    ...batch,
    sessions: batch.sessions.slice(0, limit),
    turns: batch.turns.slice(0, limit),
    toolCalls: batch.toolCalls.slice(0, limit),
    scheduledTaskRuns: batch.scheduledTaskRuns.slice(0, limit),
    memoryMaintenanceLogs: batch.memoryMaintenanceLogs.slice(0, limit),
    runnerErrors: batch.runnerErrors.slice(0, limit),
    usageRecords: batch.usageRecords.slice(0, limit),
    rawRefs: batch.rawRefs.slice(0, limit),
  };
}

function defaultObservationRef(): Ref {
  return {
    id: 'obs-fake-agentdock-001',
    kind: 'observation-batch',
    uri: 'fake://agentdock/observation/obs-fake-agentdock-001',
  };
}

function contractKindToCore(kind: AssetKind): EvolutionAssetKind | null {
  switch (kind) {
    case 'skill':
    case 'prompt':
    case 'routing-rule':
    case 'archive':
      return kind;
    case 'mcp-tool-config':
      return 'mcp';
    case 'runner-profile':
    case 'schedule-config':
      return null;
  }
}

function coreKindToContract(kind: EvolutionAssetKind): AssetKind {
  switch (kind) {
    case 'skill':
    case 'prompt':
    case 'routing-rule':
    case 'archive':
      return kind;
    case 'mcp':
      return 'mcp-tool-config';
  }
}

function contractStatusToCore(status: AssetStatus): EvolutionAssetStatus | null {
  switch (status) {
    case 'proposed':
      return 'proposed';
    case 'applied':
      return 'active';
    case 'archived':
      return 'archived';
    case 'rejected':
      return 'rejected';
    case 'superseded':
      return 'superseded';
    case 'validated':
    case 'rolled-back':
      return null;
  }
}

function coreStatusToContract(status: EvolutionAssetStatus): AssetStatus {
  switch (status) {
    case 'proposed':
      return 'proposed';
    case 'active':
      return 'applied';
    case 'archived':
      return 'archived';
    case 'rejected':
      return 'rejected';
    case 'superseded':
      return 'superseded';
  }
}

function eventTypeForStatus(status: AssetStatus): AssetEventType {
  switch (status) {
    case 'proposed':
    case 'validated':
    case 'applied':
    case 'rolled-back':
    case 'archived':
    case 'rejected':
    case 'superseded':
      return status;
  }
}

function filterAssets(assets: readonly EvolutionAsset[], query?: string): EvolutionAsset[] {
  if (!query) return [...assets];
  const needle = query.toLowerCase();
  return assets.filter((asset) =>
    [asset.id, asset.name, asset.sourceRef, asset.contentRef, asset.contentHash]
      .join('\n')
      .toLowerCase()
      .includes(needle),
  );
}

function assetToContractEvent(asset: EvolutionAsset): AssetEvent {
  const status = coreStatusToContract(asset.status);
  return AssetEventSchema.parse({
    id: `asset_event_summary_${sha256(`${asset.id}:${asset.version}:${asset.updatedAt}`).slice(0, 24)}`,
    assetId: asset.id,
    kind: coreKindToContract(asset.kind),
    version: String(asset.version),
    sourceRef: stringToRef(asset.sourceRef, 'haro-source-ref'),
    contentRef: stringToRef(asset.contentRef, 'haro-content-ref'),
    contentHash: asset.contentHash,
    status,
    eventType: eventTypeForStatus(status),
    actor: 'haro',
    createdAt: asset.updatedAt,
  });
}

function stringToRef(value: string, kind: string): Ref {
  const ref: Ref = {
    id: value,
    kind,
  };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    ref.uri = value;
  }
  return ref;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
