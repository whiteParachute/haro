import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  ApplicationRecordSchema,
  ApprovalDecisionRecordSchema,
  ApprovalRequestRecordSchema,
  AssetSnapshotRecordSchema,
  AssetKindSchema,
  AssetEventSchema,
  EvolutionProposalSchema,
  FrontierSignalSchema,
  ObservationBatchSchema,
  PatchBranchPlanRecordSchema,
  RollbackRecordSchema,
  ValidationReportSchema,
  createFakeAgentDockSource,
  createHttpAgentDockSource,
  type ApplicationRecord,
  type ApprovalDecisionRecord,
  type ApprovalRequestRecord,
  type ApplyGateCode,
  type AssetSnapshotRecord,
  type AssetEvent,
  type AssetKind,
  type ChangeOperation,
  type EvolutionProposal,
  type FrontierSignal,
  type ObservationBatch,
  type PatchBranchPlanRecord,
  type Ref,
  type RollbackAction,
  type RollbackRecord,
  type SnapshotSource,
  type ValidationReport,
} from '@haro/agentdock-contract';
import { createSidecarAssetRegistry, type HaroRunDailyWorkflowInput } from '@haro/mcp-tools';
import { CommanderExit, type AppContext } from '../index.js';
import { renderError, renderJson, resolveOutputMode } from '../output/index.js';

interface OutputFlags {
  json?: boolean;
  human?: boolean;
}

interface AgentDockConnectionRecord extends Record<string, unknown> {
  id: string;
  baseUrl: string;
  authRef?: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentDockConnectionsFile {
  defaultConnectionId?: string;
  connections: Record<string, AgentDockConnectionRecord>;
}

interface ObservationCursorRecord {
  connectionId: string;
  cursor: string;
  updatedAt: string;
  lastObservationId?: string;
  lastObservationPath?: string;
}

interface ObserveOptions extends OutputFlags {
  connection?: string;
  agentdockUrl?: string;
  baseUrl?: string;
  authRef?: string;
  source?: string;
  since?: string;
  limit?: string;
}

interface ProposeOptions extends OutputFlags {
  autoDryRun?: boolean;
  includeFrontier?: boolean;
  limit?: string;
}

interface ValidateOptions extends OutputFlags {
  pending?: boolean;
  limit?: string;
}

interface ApprovalRequestOptions extends OutputFlags {
  pending?: boolean;
  rewriteDescriptions?: boolean;
  limit?: string;
}

interface SnapshotOptions extends OutputFlags {
  proposalId: string;
}

interface ApplyOptions extends OutputFlags {
  proposalId: string;
}

interface RollbackOptions extends OutputFlags {
  applicationId: string;
}

interface PatchBranchOptions extends OutputFlags {
  proposalId: string;
  baseBranch?: string;
}

interface IntakeFrontierOptions extends OutputFlags {
  sourceConfig: string;
  since?: string;
  limit?: string;
}

interface ObserveResult {
  command: 'observe';
  connectionId: string;
  source: string;
  since?: string;
  cursor?: string;
  observationCount: number;
  wroteObservation: boolean;
  duplicate: boolean;
  observationPath?: string;
  cursorPath?: string;
  batch: ObservationBatch;
}

interface ProposeResult {
  command: 'propose';
  mode: 'dry-run';
  includeFrontier: boolean;
  proposalCount: number;
  consumedObservationCount: number;
  pendingObservationCount: number;
  includedFrontierSignalCount: number;
  availableFrontierSignalCount: number;
  skippedCorruptObservationCount: number;
  skippedCorruptProposalCount: number;
  skippedCorruptFrontierSignalCount: number;
  wroteProposal: boolean;
  assetEventCount: number;
  assetEventIds: string[];
  proposal?: EvolutionProposal;
  proposalPath?: string;
}

interface GeneratedProposalContentFile {
  path: string;
  content: Buffer;
}

interface GeneratedProposal {
  proposal: EvolutionProposal;
  contentFiles: GeneratedProposalContentFile[];
}

interface ValidateResult {
  command: 'validate';
  mode: 'pending';
  validationCount: number;
  validatedProposalCount: number;
  pendingProposalCount: number;
  skippedCorruptProposalCount: number;
  skippedCorruptValidationCount: number;
  wroteValidations: boolean;
  assetEventCount: number;
  assetEventIds: string[];
  validations: ValidationReport[];
  validationPaths: string[];
}

interface ApprovalRequestResult {
  command: 'approval-request';
  mode: 'pending' | 'rewrite-descriptions';
  approvalRequestCount: number;
  requestedProposalCount: number;
  pendingProposalCount: number;
  descriptionRewriteCount: number;
  descriptionRewrittenRequestIds: string[];
  skippedDuplicatePendingApprovalRequestCount: number;
  skippedNotActionableApprovalRequestCount: number;
  skippedCorruptProposalCount: number;
  skippedCorruptValidationCount: number;
  skippedCorruptApprovalRequestCount: number;
  skippedCorruptApprovalDecisionCount: number;
  wroteApprovalRequests: boolean;
  approvalRequests: ApprovalRequestRecord[];
  approvalRequestPaths: string[];
}

interface SnapshotResult {
  command: 'snapshot';
  proposalId: string;
  snapshotId: string;
  rollbackId: string;
  snapshotPath: string;
  rollbackPath: string;
  snapshotRef: Ref;
  rollbackRef: Ref;
  snapshot: AssetSnapshotRecord;
  rollback: RollbackRecord;
}

interface SnapshotContentFile {
  path: string;
  content: Buffer;
}

interface SnapshotArtifacts {
  snapshot: AssetSnapshotRecord;
  rollback: RollbackRecord;
  contentFiles: SnapshotContentFile[];
}

interface CurrentAssetContent {
  sourceContentRef: Ref;
  content: Buffer;
  contentHash: string;
  extension: string;
}

interface SnapshotEntryDraft {
  changeIndex: number;
  targetRef: Ref;
  assetId: string;
  existed: boolean;
  snapshotSource: SnapshotSource;
  latestEventRef?: Ref;
  sourceContentRef?: Ref;
  contentRef?: Ref;
  contentHash?: string;
  version?: string;
  status?: string;
  content?: Buffer;
  contentExtension?: string;
}

interface ProposedAssetContent {
  changeIndex: number;
  targetRef: Ref;
  assetId: string;
  kind: AssetKind;
  sourceContentRef: Ref;
  targetContentRef: Ref;
  targetPath: string;
  alternateTargetPaths: string[];
  content: Buffer;
  contentHash: string;
  extension: string;
}

interface PreparedApply {
  ok: true;
  changes: ProposedAssetContent[];
}

interface BlockedApply {
  ok: false;
  gateCode: Exclude<ApplyGateCode, 'READY'>;
  blockingReasons: string[];
}

interface PreparedRollback {
  ok: true;
  changes: RollbackAssetContent[];
}

interface BlockedRollback {
  ok: false;
  gateCode: Exclude<RollbackGateCode, 'READY'>;
  blockingReasons: string[];
}

interface RollbackAssetContent {
  changeIndex: number;
  targetRef: Ref;
  assetId: string;
  kind: AssetKind;
  action: RollbackAction;
  sourceContentRef: Ref;
  targetContentRef: Ref;
  contentHash: string;
  version: string;
  restorePath?: string;
  content?: Buffer;
  removePaths: string[];
}

interface ApplyResult {
  command: 'apply';
  proposalId: string;
  gateStatus: 'applied' | 'blocked';
  gateCode: ApplyGateCode;
  gatePassed: boolean;
  applied: boolean;
  applicationRecordCount: number;
  assetEventCount: number;
  assetEventIds: string[];
  blockingReasons: string[];
  validationId?: string;
  snapshotId?: string;
  rollbackId?: string;
  snapshotPath?: string;
  rollbackPath?: string;
  generatedSnapshot?: boolean;
  appliedContentRefs?: Ref[];
  applicationRecord?: ApplicationRecord;
  applicationRecordPath?: string;
}

type RollbackGateCode =
  | 'READY'
  | 'APPLICATION_NOT_FOUND'
  | 'APPLICATION_NOT_APPLIED'
  | 'SNAPSHOT_FAILED'
  | 'ROLLBACK_REF_REQUIRED'
  | 'ROLLBACK_NOT_REVERSIBLE'
  | 'UNSUPPORTED_ROLLBACK_EXECUTOR'
  | 'ROLLBACK_CONTENT_REQUIRED'
  | 'ROLLBACK_CONTENT_HASH_MISMATCH'
  | 'ROLLBACK_EXECUTION_FAILED';

interface RollbackResult {
  command: 'rollback';
  applicationId: string;
  proposalId?: string;
  gateStatus: 'rolled-back' | 'blocked';
  gateCode: RollbackGateCode;
  gatePassed: boolean;
  rolledBack: boolean;
  applicationRecordCount: number;
  assetEventCount: number;
  assetEventIds: string[];
  blockingReasons: string[];
  validationId?: string;
  snapshotId?: string;
  rollbackId?: string;
  rolledBackContentRefs?: Ref[];
  applicationRecord?: ApplicationRecord;
  applicationRecordPath?: string;
}

type PatchBranchGateCode =
  | 'READY'
  | 'PROPOSAL_NOT_FOUND'
  | 'VALIDATION_REQUIRED'
  | 'PATCH_BRANCH_NOT_REQUIRED';

interface PatchBranchResult {
  command: 'patch-branch';
  proposalId: string;
  gateStatus: 'planned' | 'blocked';
  gateCode: PatchBranchGateCode;
  gatePassed: boolean;
  planCount: number;
  blockingReasons: string[];
  validationId?: string;
  branchName?: string;
  planPath?: string;
  plan?: PatchBranchPlanRecord;
}

interface IntakeFrontierResult {
  command: 'intake frontier';
  sourceConfigPath: string;
  since?: string;
  cursor?: string;
  signalCount: number;
  wroteSignalCount: number;
  duplicateSignalCount: number;
  skippedBySinceCount: number;
  pendingSignalCount: number;
  skippedCorruptSignalCount: number;
  signalIds: string[];
  signalPaths: string[];
}

export interface AgentDockDailyWorkflowResult {
  command: 'agentdock-daily-workflow';
  mode: 'agentdock-workspace-agent';
  generatedAt: string;
  sidecarOnly: true;
  steps: {
    observe: Omit<ObserveResult, 'batch'> & { batchId: string };
    frontierIntake?: IntakeFrontierResult;
    propose: Omit<ProposeResult, 'proposal'> & { proposalId?: string };
    validate: Omit<ValidateResult, 'validations'> & { validationIds: string[] };
    approvalRequest: Omit<ApprovalRequestResult, 'approvalRequests'> & {
      approvalRequestIds: string[];
      approvalRequests: ApprovalRequestRecord[];
    };
  };
  summary: {
    observationCount: number;
    proposalCount: number;
    validationCount: number;
    approvalRequestCount: number;
    approvalRequestIds: string[];
    wroteSidecarArtifacts: boolean;
  };
  nextActions: string[];
}

interface SidecarStatusResult {
  command: 'status';
  root: string;
  connection: {
    path: string;
    configured: boolean;
    valid: boolean;
    connectionCount: number;
    defaultConnectionId?: string;
    error?: string;
    connections: Array<{
      id: string;
      baseUrl: string;
      hasAuthRef: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  cursors: {
    path: string;
    count: number;
    corruptCount: number;
  };
  observations: {
    path: string;
    batchCount: number;
    corruptCount: number;
    semanticObservationCount: number;
  };
  proposals: {
    path: string;
    count: number;
    corruptCount: number;
    pendingCount: number;
    validatedCount: number;
  };
  validations: {
    path: string;
    count: number;
    corruptCount: number;
  };
  approvalRequests: {
    path: string;
    count: number;
    corruptCount: number;
    pendingCount: number;
  };
  approvalDecisions: {
    path: string;
    count: number;
    corruptCount: number;
    approveCount: number;
    rejectCount: number;
    requestChangesCount: number;
  };
  snapshots: {
    path: string;
    count: number;
    corruptCount: number;
  };
  rollbacks: {
    path: string;
    count: number;
    corruptCount: number;
  };
  applications: {
    path: string;
    count: number;
    corruptCount: number;
    readyCount: number;
    appliedCount: number;
    rolledBackCount: number;
  };
  patchBranches: {
    path: string;
    count: number;
    corruptCount: number;
    plannedCount: number;
  };
  frontierSignals: {
    path: string;
    count: number;
    corruptCount: number;
    activeCount: number;
    rejectedCount: number;
    supersededCount: number;
  };
}

const CONNECTIONS_FILE = 'agentdock-connections.json';
const DEFAULT_CONNECTION_ID = 'agentdock-local';
const FRONTIER_CURSOR_CONNECTION_ID = 'frontier-intake';

export function registerAgentDockSidecarCommands(program: Command, app: AppContext): void {
  const connect = program.command('connect').description('Manage sidecar connections');

  connect
    .command('agent-dock')
    .description('Save an AgentDock HTTP connection for sidecar workflow commands')
    .requiredOption('--base-url <url>', 'AgentDock web/API base URL')
    .option('--id <id>', 'connection id', DEFAULT_CONNECTION_ID)
    .option('--auth-ref <ref>', 'secret reference, currently env:VARNAME')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: { baseUrl: string; id: string; authRef?: string; json?: boolean; human?: boolean }) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const id = normalizeConnectionId(options.id);
        const authRef = normalizeAuthRef(options.authRef);
        const source = createHttpAgentDockSource({
          baseUrl: options.baseUrl,
          connectionId: id,
          now: app.now,
        });
        const now = app.now().toISOString();
        const file = readConnectionsFile(app.paths.root);
        const existing = file.connections[id];
        const connection: AgentDockConnectionRecord = {
          ...(existing ?? {}),
          id,
          baseUrl: source.connection.baseUrl,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        if (authRef) {
          connection.authRef = authRef;
        } else {
          delete connection.authRef;
        }
        file.connections[id] = connection;
        file.defaultConnectionId = id;
        writeConnectionsFile(app.paths.root, file);

        const payload = {
          command: 'connect agent-dock' as const,
          connection,
          path: connectionsPath(app.paths.root),
        };
        if (mode === 'json') {
          renderJson(payload, { stdout: app.stdout });
        } else {
          app.stdout.write(
            [
              `AgentDock connection saved: ${connection.id}`,
              `Base URL: ${connection.baseUrl}`,
              `Config: ${connectionsPath(app.paths.root)}`,
            ].join('\n') + '\n',
          );
        }
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('observe')
    .description('Collect AgentDock observations and persist them for sidecar workflows')
    .option('--connection <id>', 'connection id from agentdock-connections.json')
    .option('--agentdock-url <url>', 'one-shot AgentDock web/API base URL override')
    .option('--base-url <url>', 'alias for --agentdock-url')
    .option('--auth-ref <ref>', 'one-shot auth reference, currently env:VARNAME')
    .option('--source <mode>', 'auto | http | fake', 'auto')
    .option('--since <cursor>', 'last | none | ISO timestamp', 'last')
    .option('--limit <n>', 'maximum observations per returned array')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action(async (options: ObserveOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = await observeAgentDock(app, options);
        if (mode === 'json') {
          renderJson({
            command: result.command,
            connectionId: result.connectionId,
            source: result.source,
            since: result.since,
            cursor: result.cursor,
            observationCount: result.observationCount,
            wroteObservation: result.wroteObservation,
            duplicate: result.duplicate,
            observationPath: result.observationPath,
            cursorPath: result.cursorPath,
            batchId: result.batch.id,
          }, { stdout: app.stdout });
          return;
        }
        app.stdout.write(
          [
            `Observation batch: ${result.batch.id}`,
            `Source: ${result.source}`,
            `Connection: ${result.connectionId}`,
            `Observations: ${result.observationCount}`,
            result.cursor ? `Cursor: ${result.cursor}` : 'Cursor: (unchanged)',
            result.wroteObservation
              ? `Wrote: ${result.observationPath}`
              : result.duplicate
                ? `Skipped duplicate: ${result.observationPath}`
                : 'No new observation file written',
          ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('propose')
    .description('Generate dry-run evolution proposals from persisted AgentDock observations')
    .option('--auto-dry-run', 'generate a dry-run proposal from unconsumed observation batches')
    .option('--include-frontier', 'include active frontier signals as proposal evidence')
    .option('--limit <n>', 'maximum unconsumed observation batches to include')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: ProposeOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = proposeAgentDock(app, options);
        if (mode === 'json') {
          renderJson({
            command: result.command,
            mode: result.mode,
            includeFrontier: result.includeFrontier,
            proposalCount: result.proposalCount,
            consumedObservationCount: result.consumedObservationCount,
            pendingObservationCount: result.pendingObservationCount,
            includedFrontierSignalCount: result.includedFrontierSignalCount,
            availableFrontierSignalCount: result.availableFrontierSignalCount,
            skippedCorruptObservationCount: result.skippedCorruptObservationCount,
            skippedCorruptProposalCount: result.skippedCorruptProposalCount,
            skippedCorruptFrontierSignalCount: result.skippedCorruptFrontierSignalCount,
            wroteProposal: result.wroteProposal,
            assetEventCount: result.assetEventCount,
            assetEventIds: result.assetEventIds,
            proposalId: result.proposal?.id,
            proposalPath: result.proposalPath,
            proposal: result.proposal,
          }, { stdout: app.stdout });
          return;
        }
        if (result.proposal) {
          app.stdout.write(
            [
              `Proposal: ${result.proposal.id}`,
              `Mode: ${result.mode}`,
              `Source observations: ${result.consumedObservationCount}`,
              `Frontier signals: ${result.includedFrontierSignalCount}`,
              `Asset events: ${result.assetEventCount}`,
              `Pending observations after run: ${result.pendingObservationCount}`,
              `Wrote: ${result.proposalPath}`,
            ].join('\n') + '\n',
          );
          return;
        }
        app.stdout.write(
          [
            'No unconsumed AgentDock observation batches found.',
            `Pending observations after run: ${result.pendingObservationCount}`,
          ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('validate')
    .description('Validate persisted pending AgentDock sidecar proposals')
    .option('--pending', 'validate proposals that do not yet have a validation report')
    .option('--limit <n>', 'maximum pending proposals to validate')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: ValidateOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = validateAgentDock(app, options);
        if (mode === 'json') {
          renderJson({
            command: result.command,
            mode: result.mode,
            validationCount: result.validationCount,
            validatedProposalCount: result.validatedProposalCount,
            pendingProposalCount: result.pendingProposalCount,
            skippedCorruptProposalCount: result.skippedCorruptProposalCount,
            skippedCorruptValidationCount: result.skippedCorruptValidationCount,
            wroteValidations: result.wroteValidations,
            assetEventCount: result.assetEventCount,
            assetEventIds: result.assetEventIds,
            validationIds: result.validations.map((report) => report.id),
            validationPaths: result.validationPaths,
            validations: result.validations,
          }, { stdout: app.stdout });
          return;
        }
        if (result.validations.length > 0) {
          app.stdout.write(
            [
              `Validations: ${result.validationCount}`,
              `Validated proposals: ${result.validatedProposalCount}`,
              `Asset events: ${result.assetEventCount}`,
              `Pending proposals after run: ${result.pendingProposalCount}`,
              `Wrote: ${result.validationPaths.join(', ')}`,
            ].join('\n') + '\n',
          );
          return;
        }
        app.stdout.write(
          [
            'No pending AgentDock sidecar proposals found.',
            `Pending proposals after run: ${result.pendingProposalCount}`,
          ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('snapshot')
    .description('Generate sidecar snapshot and rollback metadata for an L0/L1 proposal')
    .requiredOption('--proposal-id <id>', 'proposal id to snapshot')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: SnapshotOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = snapshotAgentDock(app, options);
        if (mode === 'json') {
          renderJson(result, { stdout: app.stdout });
          return;
        }
        app.stdout.write(
          [
            `Snapshot: ${result.snapshotId}`,
            `Rollback: ${result.rollbackId}`,
            `Proposal: ${result.proposalId}`,
            `Wrote: ${result.snapshotPath}`,
            `Wrote: ${result.rollbackPath}`,
          ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('approval-request')
    .description('Render validated proposals into human approval request artifacts')
    .option('--pending', 'generate approval requests for validated proposals that do not yet have one')
    .option('--rewrite-descriptions', 'rewrite pending approval request human-readable descriptions in place')
    .option('--limit <n>', 'maximum pending approval requests to write')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: ApprovalRequestOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = approvalRequestAgentDock(app, options);
        if (mode === 'json') {
          renderJson({
            command: result.command,
            mode: result.mode,
            approvalRequestCount: result.approvalRequestCount,
            requestedProposalCount: result.requestedProposalCount,
            pendingProposalCount: result.pendingProposalCount,
            descriptionRewriteCount: result.descriptionRewriteCount,
            descriptionRewrittenRequestIds: result.descriptionRewrittenRequestIds,
            skippedDuplicatePendingApprovalRequestCount: result.skippedDuplicatePendingApprovalRequestCount,
            skippedNotActionableApprovalRequestCount: result.skippedNotActionableApprovalRequestCount,
            skippedCorruptProposalCount: result.skippedCorruptProposalCount,
            skippedCorruptValidationCount: result.skippedCorruptValidationCount,
            skippedCorruptApprovalRequestCount: result.skippedCorruptApprovalRequestCount,
            skippedCorruptApprovalDecisionCount: result.skippedCorruptApprovalDecisionCount,
            wroteApprovalRequests: result.wroteApprovalRequests,
            approvalRequestIds: result.approvalRequests.map((request) => request.id),
            approvalRequestPaths: result.approvalRequestPaths,
            approvalRequests: result.approvalRequests,
          }, { stdout: app.stdout });
          return;
        }
        if (result.approvalRequests.length > 0) {
          app.stdout.write(
            [
              `Approval requests: ${result.approvalRequestCount}`,
              `Requested proposals: ${result.requestedProposalCount}`,
              `Description rewrites: ${result.descriptionRewriteCount}`,
              `Pending proposals after run: ${result.pendingProposalCount}`,
              `Skipped duplicate pending approval requests: ${result.skippedDuplicatePendingApprovalRequestCount}`,
              `Skipped non-actionable approval requests: ${result.skippedNotActionableApprovalRequestCount}`,
              `Wrote: ${result.approvalRequestPaths.join(', ')}`,
            ].join('\n') + '\n',
          );
          return;
        }
        app.stdout.write(
          [
            'No validated proposals need approval requests.',
            `Description rewrites: ${result.descriptionRewriteCount}`,
            `Pending proposals after run: ${result.pendingProposalCount}`,
            `Skipped duplicate pending approval requests: ${result.skippedDuplicatePendingApprovalRequestCount}`,
            `Skipped non-actionable approval requests: ${result.skippedNotActionableApprovalRequestCount}`,
          ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('apply')
    .description('Apply a validated L0/L1 sidecar proposal through gated snapshot/rollback checks')
    .requiredOption('--proposal-id <id>', 'validated proposal id to apply')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: ApplyOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = applyAgentDock(app, options);
        if (mode === 'json') {
          renderJson(result, { stdout: app.stdout });
          return;
        }
        app.stdout.write(
          result.gatePassed
            ? [
                `Applied: ${result.proposalId}`,
                `Asset events: ${result.assetEventCount}`,
                `Application record: ${result.applicationRecordPath}`,
              ].join('\n') + '\n'
            : [
                `Apply gate blocked: ${result.proposalId}`,
                `Code: ${result.gateCode}`,
                ...result.blockingReasons.map((reason) => `- ${reason}`),
              ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('rollback')
    .description('Rollback an applied sidecar-local L0/L1 application using its rollback record')
    .requiredOption('--application-id <id>', 'applied application record id to roll back')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: RollbackOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = rollbackAgentDock(app, options);
        if (mode === 'json') {
          renderJson(result, { stdout: app.stdout });
          return;
        }
        app.stdout.write(
          result.gatePassed
            ? [
                `Rolled back: ${result.applicationId}`,
                `Asset events: ${result.assetEventCount}`,
                `Application record: ${result.applicationRecordPath}`,
              ].join('\n') + '\n'
            : [
                `Rollback gate blocked: ${result.applicationId}`,
                `Code: ${result.gateCode}`,
                ...result.blockingReasons.map((reason) => `- ${reason}`),
              ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  program
    .command('patch-branch')
    .description('Plan an L2/L3 patch branch instead of applying code-level changes directly')
    .requiredOption('--proposal-id <id>', 'validated L2/L3 proposal id to plan')
    .option('--base-branch <name>', 'optional base branch label for the generated plan')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: PatchBranchOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = patchBranchAgentDock(app, options);
        if (mode === 'json') {
          renderJson(result, { stdout: app.stdout });
          return;
        }
        app.stdout.write(
          result.gatePassed
            ? [
                `Patch branch plan: ${result.branchName}`,
                `Proposal: ${result.proposalId}`,
                `Wrote: ${result.planPath}`,
              ].join('\n') + '\n'
            : [
                `Patch branch gate blocked: ${result.proposalId}`,
                `Code: ${result.gateCode}`,
                ...result.blockingReasons.map((reason) => `- ${reason}`),
              ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

  const intake = program
    .command('intake')
    .description('Collect external sidecar signals for proposal evidence');

  intake
    .command('frontier')
    .description('Normalize curated frontier intelligence signals into the sidecar store')
    .requiredOption('--source-config <file>', 'JSON file containing FrontierSignal[] or { signals: FrontierSignal[] }')
    .option('--since <cursor>', 'last | none | ISO timestamp', 'last')
    .option('--limit <n>', 'maximum new frontier signals to write')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((options: IntakeFrontierOptions) => {
      const mode = resolveOutputMode(options, app.stdout);
      try {
        const result = intakeFrontierSignals(app, options);
        if (mode === 'json') {
          renderJson(result, { stdout: app.stdout });
          return;
        }
        app.stdout.write(
          [
            `Frontier signals read: ${result.signalCount}`,
            `Wrote: ${result.wroteSignalCount}`,
            `Duplicates: ${result.duplicateSignalCount}`,
            `Skipped by since: ${result.skippedBySinceCount}`,
            `Pending after limit: ${result.pendingSignalCount}`,
            `Skipped corrupt existing signals: ${result.skippedCorruptSignalCount}`,
            result.cursor ? `Cursor: ${result.cursor}` : 'Cursor: (unchanged)',
            result.signalPaths.length > 0 ? `Files: ${result.signalPaths.join(', ')}` : 'Files: (none)',
          ].join('\n') + '\n',
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        const exitCode = error instanceof CommanderExit ? error.code : 1;
        throw new CommanderExit(exitCode, error instanceof Error ? error.message : String(error));
      }
    });

}

async function observeAgentDock(app: AppContext, options: ObserveOptions): Promise<ObserveResult> {
  const sourceMode = normalizeSourceMode(options.source);
  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const connection = resolveObservationConnection(app, options, sourceMode);
  const lockDir = acquireConnectionLock(app.paths.root, connection.id);
  try {
    const cursorPath = cursorFilePath(app.paths.root, connection.id);
    const storedCursor = options.since === undefined || options.since === 'last'
      ? readCursor(cursorPath, connection.id)?.cursor
      : undefined;
    const since = resolveSince(options.since, storedCursor);

    const batch = sourceMode === 'fake'
      ? ObservationBatchSchema.parse(
          createFakeAgentDockSource({
            connectionId: connection.id,
            baseUrl: connection.baseUrl,
            now: app.now().toISOString(),
          }).collectObservationBatch(),
        )
      : await createHttpAgentDockSource({
          connectionId: connection.id,
          baseUrl: connection.baseUrl,
          authHeader: resolveAuthHeader(connection.authRef),
          now: app.now,
        }).collectObservationBatch({
          ...(since ? { since } : {}),
          ...(limit ? { limit } : {}),
        });

    const prunedBatch = pruneSeenObservations(app.paths.root, batch);
    const observationCount = countSemanticObservations(prunedBatch);
    const observationPath = observationFilePath(app.paths.root, prunedBatch);
    const duplicate = existsSync(observationPath);
    let wroteObservation = false;
    if (observationCount > 0 && !duplicate) {
      mkdirSync(observationsDir(app.paths.root), { recursive: true });
      writeJsonFile(observationPath, prunedBatch);
      wroteObservation = true;
    }

    if (prunedBatch.window.cursor) {
      const cursorRecord: ObservationCursorRecord = {
        connectionId: connection.id,
        cursor: prunedBatch.window.cursor,
        updatedAt: app.now().toISOString(),
        lastObservationId: prunedBatch.id,
        ...(observationCount > 0 ? { lastObservationPath: observationPath } : {}),
      };
      mkdirSync(cursorsDir(app.paths.root), { recursive: true });
      writeJsonFile(cursorPath, cursorRecord);
    }

    return {
      command: 'observe',
      connectionId: connection.id,
      source: prunedBatch.source,
      ...(since ? { since } : {}),
      ...(prunedBatch.window.cursor ? { cursor: prunedBatch.window.cursor } : {}),
      observationCount,
      wroteObservation,
      duplicate,
      ...(observationCount > 0 ? { observationPath } : {}),
      ...(prunedBatch.window.cursor ? { cursorPath } : {}),
      batch: prunedBatch,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function proposeAgentDock(app: AppContext, options: ProposeOptions): ProposeResult {
  if (!options.autoDryRun) {
    throw new CommanderExit(
      2,
      '`haro propose` is currently read-only; pass `--auto-dry-run` to generate a persisted dry-run proposal.',
    );
  }

  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const lockDir = acquireProposeLock(app.paths.root);
  try {
    const consumedResult = readConsumedObservationBatchIds(app.paths.root);
    const pendingResult = readUnconsumedObservationBatches(app.paths.root, consumedResult.consumed);
    const frontierResult = options.includeFrontier
      ? readActiveFrontierSignals(app.paths.root)
      : { signals: [] as FrontierSignal[], corruptCount: 0 };
    emitCorruptJsonWarnings(app, {
      corruptObservationCount: pendingResult.corruptCount,
      corruptProposalCount: consumedResult.corruptCount,
    });
    if (options.includeFrontier) {
      emitCorruptFrontierSignalWarnings(app, frontierResult.corruptCount);
    }
    const pending = pendingResult.batches;
    const selected = typeof limit === 'number' ? pending.slice(0, limit) : pending;
    if (selected.length === 0) {
      return {
        command: 'propose',
        mode: 'dry-run',
        includeFrontier: options.includeFrontier === true,
        proposalCount: 0,
        consumedObservationCount: 0,
        pendingObservationCount: 0,
        includedFrontierSignalCount: 0,
        availableFrontierSignalCount: frontierResult.signals.length,
        skippedCorruptObservationCount: pendingResult.corruptCount,
        skippedCorruptProposalCount: consumedResult.corruptCount,
        skippedCorruptFrontierSignalCount: frontierResult.corruptCount,
        wroteProposal: false,
        assetEventCount: 0,
        assetEventIds: [],
      };
    }

    const generated = createAutoProposal(app.paths.root, selected, app.now, frontierResult.signals);
    const proposal = generated.proposal;
    const path = proposalFilePath(app.paths.root, proposal);
    for (const contentFile of generated.contentFiles) {
      writeContentFile(contentFile.path, contentFile.content);
    }
    writeJsonFile(path, proposal);
    const assetEventIds = recordProposalAssetEvents(app.paths.root, proposal).map((event) => event.id);
    return {
      command: 'propose',
      mode: 'dry-run',
      includeFrontier: options.includeFrontier === true,
      proposalCount: 1,
      consumedObservationCount: selected.length,
      pendingObservationCount: pending.length - selected.length,
      includedFrontierSignalCount: frontierResult.signals.length,
      availableFrontierSignalCount: frontierResult.signals.length,
      skippedCorruptObservationCount: pendingResult.corruptCount,
      skippedCorruptProposalCount: consumedResult.corruptCount,
      skippedCorruptFrontierSignalCount: frontierResult.corruptCount,
      wroteProposal: true,
      assetEventCount: assetEventIds.length,
      assetEventIds,
      proposal,
      proposalPath: path,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function validateAgentDock(app: AppContext, options: ValidateOptions): ValidateResult {
  if (!options.pending) {
    throw new CommanderExit(
      2,
      '`haro validate` is currently read-only; pass `--pending` to validate persisted pending proposals.',
    );
  }

  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const lockDir = acquireValidateLock(app.paths.root);
  try {
    const existingValidationResult = readValidatedProposalIds(app.paths.root);
    const pendingProposalResult = readPendingProposals(app.paths.root, existingValidationResult.validated);
    emitCorruptValidationWarnings(app, {
      corruptProposalCount: pendingProposalResult.corruptCount,
      corruptValidationCount: existingValidationResult.corruptCount,
    });
    const pending = pendingProposalResult.proposals;
    const selected = typeof limit === 'number' ? pending.slice(0, limit) : pending;
    if (selected.length === 0) {
      return {
        command: 'validate',
        mode: 'pending',
        validationCount: 0,
        validatedProposalCount: 0,
        pendingProposalCount: 0,
        skippedCorruptProposalCount: pendingProposalResult.corruptCount,
        skippedCorruptValidationCount: existingValidationResult.corruptCount,
        wroteValidations: false,
        assetEventCount: 0,
        assetEventIds: [],
        validations: [],
        validationPaths: [],
      };
    }

    const validations = selected.map((proposal) => createValidationReport(app.paths.root, proposal, app.now));
    const validationPaths = validations.map((report) => validationFilePath(app.paths.root, report));
    const assetEventIds: string[] = [];
    for (let i = 0; i < validations.length; i += 1) {
      const report = validations[i]!;
      const path = validationPaths[i]!;
      writeJsonFile(path, report);
      const proposal = selected[i]!;
      const persistedProposal = report.applyEligible
        ? markProposalValidated(app.paths.root, proposal, report.createdAt)
        : proposal;
      assetEventIds.push(
        ...recordValidationAssetEvents(app.paths.root, persistedProposal, report).map((event) => event.id),
      );
    }
    return {
      command: 'validate',
      mode: 'pending',
      validationCount: validations.length,
      validatedProposalCount: selected.length,
      pendingProposalCount: pending.length - selected.length,
      skippedCorruptProposalCount: pendingProposalResult.corruptCount,
      skippedCorruptValidationCount: existingValidationResult.corruptCount,
      wroteValidations: true,
      assetEventCount: assetEventIds.length,
      assetEventIds,
      validations,
      validationPaths,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function approvalRequestAgentDock(app: AppContext, options: ApprovalRequestOptions): ApprovalRequestResult {
  if (options.rewriteDescriptions) {
    return rewritePendingApprovalRequestDescriptions(app, options);
  }
  if (!options.pending) {
    throw new CommanderExit(
      2,
      '`haro approval-request` is currently queue-based; pass `--pending` to render pending validated proposals.',
    );
  }

  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const lockDir = acquireApprovalRequestLock(app.paths.root);
  try {
    const requestedResult = readApprovalRequestedProposalIds(app.paths.root);
    const decidedResult = readApprovalDecisionProposalIds(app.paths.root);
    const validationStats = readValidationStats(app.paths.root);
    const existingApprovalRequestDedupeKeys = readApprovalRequestProposalDedupeKeys(app.paths.root);
    const pendingResult = readValidatedProposalsNeedingApprovalRequest(
      app.paths.root,
      validationStats.validatedProposalIds,
      requestedResult.requested,
      decidedResult.decided,
    );
    const actionableResult = filterActionableApprovalRequestProposals(app.paths.root, pendingResult.proposals);
    const pending: Array<{ proposal: EvolutionProposal; validation: ValidationReport }> = [];
    for (const candidate of actionableResult.proposals) {
      const dedupeKey = proposalApprovalRequestDedupeKey(candidate.proposal);
      if (existingApprovalRequestDedupeKeys.has(dedupeKey)) continue;
      existingApprovalRequestDedupeKeys.add(dedupeKey);
      pending.push(candidate);
    }
    const skippedDuplicatePendingApprovalRequestCount = actionableResult.proposals.length - pending.length;
    const skippedNotActionableApprovalRequestCount = actionableResult.skippedCount;
    const selected = typeof limit === 'number' ? pending.slice(0, limit) : pending;
    if (selected.length === 0) {
      return {
        command: 'approval-request',
        mode: 'pending',
        approvalRequestCount: 0,
        requestedProposalCount: 0,
        pendingProposalCount: 0,
        descriptionRewriteCount: 0,
        descriptionRewrittenRequestIds: [],
        skippedDuplicatePendingApprovalRequestCount,
        skippedNotActionableApprovalRequestCount,
        skippedCorruptProposalCount: pendingResult.corruptCount,
        skippedCorruptValidationCount: validationStats.corruptCount,
        skippedCorruptApprovalRequestCount: requestedResult.corruptCount,
        skippedCorruptApprovalDecisionCount: decidedResult.corruptCount,
        wroteApprovalRequests: false,
        approvalRequests: [],
        approvalRequestPaths: [],
      };
    }

    const approvalRequests = selected.map(({ proposal, validation }) => createApprovalRequestRecord(app, proposal, validation));
    const approvalRequestPaths = approvalRequests.map((record) => approvalRequestFilePath(app.paths.root, record));
    for (let i = 0; i < approvalRequests.length; i += 1) {
      writeJsonFile(approvalRequestPaths[i]!, approvalRequests[i]!);
    }
    return {
      command: 'approval-request',
      mode: 'pending',
      approvalRequestCount: approvalRequests.length,
      requestedProposalCount: selected.length,
      pendingProposalCount: pending.length - selected.length,
      descriptionRewriteCount: 0,
      descriptionRewrittenRequestIds: [],
      skippedDuplicatePendingApprovalRequestCount,
      skippedNotActionableApprovalRequestCount,
      skippedCorruptProposalCount: pendingResult.corruptCount,
      skippedCorruptValidationCount: validationStats.corruptCount,
      skippedCorruptApprovalRequestCount: requestedResult.corruptCount,
      skippedCorruptApprovalDecisionCount: decidedResult.corruptCount,
      wroteApprovalRequests: true,
      approvalRequests,
      approvalRequestPaths,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function rewritePendingApprovalRequestDescriptions(
  app: AppContext,
  options: ApprovalRequestOptions,
): ApprovalRequestResult {
  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const dir = approvalRequestsDir(app.paths.root);
  const rewritten: ApprovalRequestRecord[] = [];
  const paths: string[] = [];
  let corruptRequestCount = 0;
  let skippedCorruptProposalCount = 0;
  let skippedCorruptValidationCount = 0;
  if (!existsSync(dir)) {
    return {
      command: 'approval-request',
      mode: 'rewrite-descriptions',
      approvalRequestCount: 0,
      requestedProposalCount: 0,
      pendingProposalCount: 0,
      descriptionRewriteCount: 0,
      descriptionRewrittenRequestIds: [],
      skippedDuplicatePendingApprovalRequestCount: 0,
      skippedNotActionableApprovalRequestCount: 0,
      skippedCorruptProposalCount: 0,
      skippedCorruptValidationCount: 0,
      skippedCorruptApprovalRequestCount: 0,
      skippedCorruptApprovalDecisionCount: 0,
      wroteApprovalRequests: false,
      approvalRequests: [],
      approvalRequestPaths: [],
    };
  }

  const requestFiles = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (const name of requestFiles) {
    if (typeof limit === 'number' && rewritten.length >= limit) break;
    const path = join(dir, name);
    let request: ApprovalRequestRecord;
    try {
      request = ApprovalRequestRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      corruptRequestCount += 1;
      continue;
    }
    if (request.status !== 'pending') continue;
    const proposal = readProposalById(app.paths.root, request.proposalId);
    if (!proposal) {
      skippedCorruptProposalCount += 1;
      continue;
    }
    const validation = readValidationById(app.paths.root, request.validationId) ??
      readLatestValidationForProposal(app.paths.root, request.proposalId);
    if (!validation) {
      skippedCorruptValidationCount += 1;
      continue;
    }
    const readable = readableApprovalRequestFields(proposal, validation);
    const timestamp = app.now().toISOString();
    const next = ApprovalRequestRecordSchema.parse({
      ...request,
      title: readable.title,
      whyChange: readable.whyChange,
      howChange: readable.howChange,
      expectedBenefits: readable.expectedBenefits,
      manualChecks: readable.manualChecks,
      regressionRisks: readable.regressionRisks,
      rollbackPlan: readable.rollbackPlan,
      reviewerInstruction: readable.reviewerInstruction,
      descriptionRewrittenAt: timestamp,
      updatedAt: timestamp,
    });
    writeJsonFile(path, next);
    rewritten.push(next);
    paths.push(path);
  }

  return {
    command: 'approval-request',
    mode: 'rewrite-descriptions',
    approvalRequestCount: rewritten.length,
    requestedProposalCount: 0,
    pendingProposalCount: 0,
    descriptionRewriteCount: rewritten.length,
    descriptionRewrittenRequestIds: rewritten.map((request) => request.id),
    skippedDuplicatePendingApprovalRequestCount: 0,
    skippedNotActionableApprovalRequestCount: 0,
    skippedCorruptProposalCount,
    skippedCorruptValidationCount,
    skippedCorruptApprovalRequestCount: corruptRequestCount,
    skippedCorruptApprovalDecisionCount: 0,
    wroteApprovalRequests: rewritten.length > 0,
    approvalRequests: rewritten,
    approvalRequestPaths: paths,
  };
}

export async function runAgentDockDailyWorkflow(
  app: AppContext,
  options: HaroRunDailyWorkflowInput,
): Promise<AgentDockDailyWorkflowResult> {
  const observe = await observeAgentDock(app, {
    ...(options.connectionId ? { connection: options.connectionId } : {}),
    ...(options.source ? { source: options.source } : {}),
    since: options.since ?? 'last',
    ...(options.observeLimit ? { limit: String(options.observeLimit) } : {}),
  });
  const frontierIntake = options.frontierSourceConfigPath
    ? intakeFrontierSignals(app, {
        sourceConfig: options.frontierSourceConfigPath,
        since: 'last',
        ...(options.frontierLimit ? { limit: String(options.frontierLimit) } : {}),
      })
    : undefined;
  const propose = proposeAgentDock(app, {
    autoDryRun: true,
    includeFrontier: options.includeFrontier ?? Boolean(options.frontierSourceConfigPath),
    ...(options.proposalLimit ? { limit: String(options.proposalLimit) } : {}),
  });
  const validate = validateAgentDock(app, {
    pending: true,
    ...(options.validationLimit ? { limit: String(options.validationLimit) } : {}),
  });
  const approvalRequest = approvalRequestAgentDock(app, {
    pending: true,
    ...(options.approvalRequestLimit ? { limit: String(options.approvalRequestLimit) } : {}),
  });
  const approvalRequestIds = approvalRequest.approvalRequests.map((request) => request.id);
  const wroteSidecarArtifacts =
    observe.wroteObservation ||
    Boolean(frontierIntake && frontierIntake.wroteSignalCount > 0) ||
    propose.wroteProposal ||
    validate.wroteValidations ||
    approvalRequest.wroteApprovalRequests;

  return {
    command: 'agentdock-daily-workflow',
    mode: 'agentdock-workspace-agent',
    generatedAt: app.now().toISOString(),
    sidecarOnly: true,
    steps: {
      observe: summarizeObserveStep(observe),
      ...(frontierIntake ? { frontierIntake } : {}),
      propose: summarizeProposeStep(propose),
      validate: summarizeValidateStep(validate),
      approvalRequest: {
        ...approvalRequest,
        approvalRequestIds,
      },
    },
    summary: {
      observationCount: observe.observationCount,
      proposalCount: propose.proposalCount,
      validationCount: validate.validationCount,
      approvalRequestCount: approvalRequest.approvalRequestCount,
      approvalRequestIds,
      wroteSidecarArtifacts,
    },
    nextActions: dailyWorkflowNextActions(approvalRequestIds, wroteSidecarArtifacts),
  };
}

function snapshotAgentDock(app: AppContext, options: SnapshotOptions): SnapshotResult {
  const proposalId = options.proposalId.trim();
  if (!proposalId) {
    throw new CommanderExit(2, '`haro snapshot --proposal-id` requires a non-empty proposal id.');
  }

  const lockDir = acquireSnapshotLock(app.paths.root);
  try {
    const proposal = readProposalById(app.paths.root, proposalId);
    if (!proposal) {
      throw new CommanderExit(
        1,
        `No proposal artifact found for ${proposalId} under evolution/proposals.`,
      );
    }
    assertSnapshotAllowedProposal(proposal);
    const validation = readLatestValidationForProposal(app.paths.root, proposal.id);
    const artifacts = createSnapshotArtifacts(app, proposal, validation);
    return writeSnapshotArtifacts(app.paths.root, artifacts);
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function summarizeObserveStep(result: ObserveResult): Omit<ObserveResult, 'batch'> & { batchId: string } {
  const { batch, ...rest } = result;
  return {
    ...rest,
    batchId: batch.id,
  };
}

function summarizeProposeStep(result: ProposeResult): Omit<ProposeResult, 'proposal'> & { proposalId?: string } {
  const { proposal, ...rest } = result;
  return {
    ...rest,
    ...(proposal ? { proposalId: proposal.id } : {}),
  };
}

function summarizeValidateStep(result: ValidateResult): Omit<ValidateResult, 'validations'> & { validationIds: string[] } {
  const { validations, ...rest } = result;
  return {
    ...rest,
    validationIds: validations.map((report) => report.id),
  };
}

function dailyWorkflowNextActions(
  approvalRequestIds: readonly string[],
  wroteSidecarArtifacts: boolean,
): string[] {
  if (approvalRequestIds.length > 0) {
    return [
      '通过 AgentDock IM/workspace 向用户展示审批请求摘要。',
      '在执行任何应用（apply）或补丁分支（patch branch）动作前，必须等待通过、驳回或要求修改的人审结论。',
      'Haro Web 可以作为同一批审批请求的看板，但它不是 workflow runner。',
    ];
  }
  if (wroteSidecarArtifacts) {
    return [
      '本轮没有新增审批请求；重试前请先检查各步骤计数。',
      '除非已验证提案具备明确的人审证据，否则不要应用变更。',
    ];
  }
  return [
    '本轮没有产生新的 sidecar artifact；AgentDock workspace 可以汇报当前没有待审内容。',
  ];
}

export function applyAgentDock(app: AppContext, options: ApplyOptions): ApplyResult {
  const proposalId = options.proposalId.trim();
  if (!proposalId) {
    throw new CommanderExit(2, '`haro apply --proposal-id` requires a non-empty proposal id.');
  }

  const lockDir = acquireApplyLock(app.paths.root);
  try {
    let proposal = readProposalById(app.paths.root, proposalId);
    if (!proposal) {
      return blockedApplyResult(proposalId, 'PROPOSAL_NOT_FOUND', [
        `No proposal artifact found for ${proposalId} under evolution/proposals.`,
      ]);
    }
    const decisionSync = syncProposalWithLatestApprovalDecision(app.paths.root, proposal);
    proposal = decisionSync.proposal;

    if (proposal.level === 'L2' || proposal.level === 'L3') {
      return blockedApplyResult(proposal.id, 'DIRECT_APPLY_FORBIDDEN', [
        'Direct apply is forbidden for L2/L3 proposals; generate a patch branch and require human review.',
      ]);
    }

    const unsupportedTargetReason = unsupportedL0L1TargetReason(proposal);
    if (unsupportedTargetReason) {
      return blockedApplyResult(proposal.id, 'UNSUPPORTED_TARGET_KIND', [unsupportedTargetReason]);
    }

    const validation = readLatestValidationForProposal(app.paths.root, proposal.id);
    if (!validation) {
      return blockedApplyResult(proposal.id, 'VALIDATION_REQUIRED', [
        `No validation report found for proposal ${proposal.id}.`,
      ]);
    }

    if (decisionSync.decision?.decision === 'reject' || proposal.status === 'rejected') {
      return blockedApplyResult(proposal.id, 'APPROVAL_REJECTED', [
        `Proposal ${proposal.id} was rejected by human review and cannot be applied.`,
      ], validation.id);
    }

    if (decisionSync.decision?.decision === 'request-changes') {
      return blockedApplyResult(proposal.id, 'CHANGES_REQUESTED', [
        `人审要求修改提案 ${proposal.id}；应用前必须先创建修订后的提案。`,
        ...(decisionSync.decision.direction ? [`要求修改方向：${decisionSync.decision.direction}`] : []),
      ], validation.id);
    }

    if (proposal.status !== 'validated') {
      return blockedApplyResult(proposal.id, 'VALIDATION_REQUIRED', [
        `Proposal status is ${proposal.status}; gated apply requires proposal.status=validated.`,
      ], validation.id);
    }

    if (missingHumanApproval(proposal)) {
      return blockedApplyResult(proposal.id, 'HUMAN_REVIEW_REQUIRED', [
        'Startup policy requires a human approval ref before any apply; attach approval evidence through the AgentDock approval channel.',
        ...(validation.applyEligible ? [] : ['Validation report has applyEligible=false.']),
        ...(validation.riskVerdict === 'blocked' ? ['Validation report has riskVerdict=blocked.'] : []),
      ], validation.id);
    }

    if (!validation.applyEligible || validation.riskVerdict === 'blocked') {
      return blockedApplyResult(proposal.id, 'APPLY_NOT_ELIGIBLE', [
        ...validation.blockingReasons,
        ...(validation.applyEligible ? [] : ['Validation report has applyEligible=false.']),
      ], validation.id);
    }

    if (!validation.rollbackReady) {
      return blockedApplyResult(proposal.id, 'ROLLBACK_REF_REQUIRED', [
        'Validation report has rollbackReady=false.',
      ], validation.id);
    }

    let snapshotRef = findSnapshotRef(proposal);
    let rollbackRef = findRollbackRef(proposal);
    let generatedSnapshot: SnapshotResult | undefined;
    if (!snapshotRef || !rollbackRef) {
      try {
        generatedSnapshot = writeSnapshotArtifacts(
          app.paths.root,
          createSnapshotArtifacts(app, proposal, validation),
        );
        snapshotRef = generatedSnapshot.snapshotRef;
        rollbackRef = generatedSnapshot.rollbackRef;
      } catch (error) {
        return blockedApplyResult(proposal.id, 'SNAPSHOT_FAILED', [
          error instanceof Error ? error.message : String(error),
        ], validation.id);
      }
    }

    const snapshot = readSnapshotById(app.paths.root, snapshotRef.id);
    if (!snapshot) {
      return blockedApplyResult(proposal.id, 'SNAPSHOT_FAILED', [
        `Snapshot artifact ${snapshotRef.id} was not found under evolution/snapshots.`,
      ], validation.id);
    }
    const rollback = readRollbackById(app.paths.root, rollbackRef.id);
    if (!rollback) {
      return blockedApplyResult(proposal.id, 'ROLLBACK_REF_REQUIRED', [
        `Rollback artifact ${rollbackRef.id} was not found under evolution/rollbacks.`,
      ], validation.id);
    }
    const evidenceRefProblem = validateApplyEvidenceRefs(proposal, validation, snapshot, rollback);
    if (evidenceRefProblem) {
      return blockedApplyResult(
        proposal.id,
        evidenceRefProblem.gateCode,
        [evidenceRefProblem.reason],
        validation.id,
      );
    }

    const preparedApply = prepareSidecarLocalApply(app.paths.root, proposal);
    if (!preparedApply.ok) {
      return blockedApplyResult(
        proposal.id,
        preparedApply.gateCode,
        preparedApply.blockingReasons,
        validation.id,
      );
    }

    const applicationId = applicationRecordId(
      proposal,
      validation,
      snapshotRef,
      rollbackRef,
      preparedApply.changes,
    );
    try {
      applySidecarLocalChanges(preparedApply.changes);
    } catch (error) {
      return blockedApplyResult(proposal.id, 'APPLY_EXECUTION_FAILED', [
        error instanceof Error ? error.message : String(error),
      ], validation.id);
    }

    const appliedContentRefs = preparedApply.changes.map((change) => change.targetContentRef);
    const assetEvents = recordAppliedAssetEvents(
      app.paths.root,
      proposal,
      validation,
      applicationId,
      preparedApply.changes,
      snapshotRef,
      rollbackRef,
      app.now().toISOString(),
    );
    const applicationRecord = createAppliedApplicationRecord(
      app,
      proposal,
      validation,
      snapshotRef,
      rollbackRef,
      applicationId,
      assetEvents.map(assetEventRef),
      appliedContentRefs,
    );
    const applicationRecordPath = applicationFilePath(app.paths.root, applicationRecord);
    writeJsonFile(applicationRecordPath, applicationRecord);
    return {
      command: 'apply',
      proposalId: proposal.id,
      gateStatus: 'applied',
      gateCode: 'READY',
      gatePassed: true,
      applied: true,
      applicationRecordCount: 1,
      assetEventCount: assetEvents.length,
      assetEventIds: assetEvents.map((event) => event.id),
      blockingReasons: [],
      validationId: validation.id,
      snapshotId: snapshotRef.id,
      rollbackId: rollbackRef.id,
      ...(generatedSnapshot ? {
        snapshotPath: generatedSnapshot.snapshotPath,
        rollbackPath: generatedSnapshot.rollbackPath,
        generatedSnapshot: true,
      } : { generatedSnapshot: false }),
      appliedContentRefs,
      applicationRecord,
      applicationRecordPath,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

export function rollbackAgentDock(app: AppContext, options: RollbackOptions): RollbackResult {
  const applicationId = options.applicationId.trim();
  if (!applicationId) {
    throw new CommanderExit(2, '`haro rollback --application-id` requires a non-empty application id.');
  }

  const lockDir = acquireApplyLock(app.paths.root);
  try {
    const application = readApplicationById(app.paths.root, applicationId);
    if (!application) {
      return blockedRollbackResult(applicationId, 'APPLICATION_NOT_FOUND', [
        `No application record found for ${applicationId} under evolution/applications.`,
      ]);
    }

    if (application.status !== 'applied' || !application.applied) {
      return blockedRollbackResult(application.id, 'APPLICATION_NOT_APPLIED', [
        `Application ${application.id} has status=${application.status}; rollback requires status=applied.`,
      ], application);
    }

    if (!application.snapshotRef) {
      return blockedRollbackResult(application.id, 'SNAPSHOT_FAILED', [
        `Application ${application.id} does not contain a snapshotRef.`,
      ], application);
    }
    if (!application.rollbackRef) {
      return blockedRollbackResult(application.id, 'ROLLBACK_REF_REQUIRED', [
        `Application ${application.id} does not contain a rollbackRef.`,
      ], application);
    }

    const snapshot = readSnapshotById(app.paths.root, application.snapshotRef.id);
    if (!snapshot) {
      return blockedRollbackResult(application.id, 'SNAPSHOT_FAILED', [
        `Snapshot artifact ${application.snapshotRef.id} was not found under evolution/snapshots.`,
      ], application);
    }
    const rollback = readRollbackById(app.paths.root, application.rollbackRef.id);
    if (!rollback) {
      return blockedRollbackResult(application.id, 'ROLLBACK_REF_REQUIRED', [
        `Rollback artifact ${application.rollbackRef.id} was not found under evolution/rollbacks.`,
      ], application);
    }

    const evidenceProblem = validateRollbackEvidenceRefs(application, snapshot, rollback);
    if (evidenceProblem) {
      return blockedRollbackResult(
        application.id,
        evidenceProblem.gateCode,
        [evidenceProblem.reason],
        application,
      );
    }

    const preparedRollback = prepareSidecarLocalRollback(app.paths.root, application, snapshot, rollback);
    if (!preparedRollback.ok) {
      return blockedRollbackResult(
        application.id,
        preparedRollback.gateCode,
        preparedRollback.blockingReasons,
        application,
      );
    }

    try {
      applySidecarLocalRollbackChanges(preparedRollback.changes);
    } catch (error) {
      return blockedRollbackResult(application.id, 'ROLLBACK_EXECUTION_FAILED', [
        error instanceof Error ? error.message : String(error),
      ], application);
    }

    const assetEvents = recordRolledBackAssetEvents(
      app.paths.root,
      application,
      rollback,
      preparedRollback.changes,
      app.now().toISOString(),
    );
    const rolledBackContentRefs = preparedRollback.changes.map((change) => change.targetContentRef);
    const applicationRecord = createRolledBackApplicationRecord(
      app,
      application,
      assetEvents.map(assetEventRef),
      rolledBackContentRefs,
    );
    const applicationRecordPath = applicationFilePath(app.paths.root, applicationRecord);
    writeJsonFile(applicationRecordPath, applicationRecord);
    return {
      command: 'rollback',
      applicationId: application.id,
      proposalId: application.proposalId,
      gateStatus: 'rolled-back',
      gateCode: 'READY',
      gatePassed: true,
      rolledBack: true,
      applicationRecordCount: 1,
      assetEventCount: assetEvents.length,
      assetEventIds: assetEvents.map((event) => event.id),
      blockingReasons: [],
      validationId: application.validationId,
      snapshotId: snapshot.id,
      rollbackId: rollback.id,
      rolledBackContentRefs,
      applicationRecord,
      applicationRecordPath,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function patchBranchAgentDock(app: AppContext, options: PatchBranchOptions): PatchBranchResult {
  const proposalId = options.proposalId.trim();
  if (!proposalId) {
    throw new CommanderExit(2, '`haro patch-branch --proposal-id` requires a non-empty proposal id.');
  }
  const baseBranch = options.baseBranch?.trim() || undefined;

  const lockDir = acquirePatchBranchLock(app.paths.root);
  try {
    const proposal = readProposalById(app.paths.root, proposalId);
    if (!proposal) {
      return blockedPatchBranchResult(proposalId, 'PROPOSAL_NOT_FOUND', [
        `No proposal artifact found for ${proposalId} under evolution/proposals.`,
      ]);
    }

    if (proposal.level !== 'L2' && proposal.level !== 'L3') {
      return blockedPatchBranchResult(proposal.id, 'PATCH_BRANCH_NOT_REQUIRED', [
        `Proposal level ${proposal.level} is eligible for gated L0/L1 apply, not Phase G patch branch planning.`,
      ]);
    }

    const validation = readLatestValidationForProposal(app.paths.root, proposal.id);
    if (!validation) {
      return blockedPatchBranchResult(proposal.id, 'VALIDATION_REQUIRED', [
        `No validation report found for proposal ${proposal.id}; run \`haro validate --pending\` before planning a patch branch.`,
      ]);
    }

    const plan = createPatchBranchPlanRecord(app, proposal, validation, baseBranch);
    const planPath = patchBranchPlanFilePath(app.paths.root, plan);
    writeJsonFile(planPath, plan);
    return {
      command: 'patch-branch',
      proposalId: proposal.id,
      gateStatus: 'planned',
      gateCode: 'READY',
      gatePassed: true,
      planCount: 1,
      blockingReasons: [],
      validationId: validation.id,
      branchName: plan.branchName,
      planPath,
      plan,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

function intakeFrontierSignals(app: AppContext, options: IntakeFrontierOptions): IntakeFrontierResult {
  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const sourceConfigPath = resolve(options.sourceConfig);
  const signals = readFrontierSourceConfig(sourceConfigPath);
  const lockDir = acquireFrontierIntakeLock(app.paths.root);
  try {
    const storedCursor = options.since === undefined || options.since === 'last'
      ? readCursor(frontierCursorFilePath(app.paths.root), FRONTIER_CURSOR_CONNECTION_ID)?.cursor
      : undefined;
    const since = resolveSince(options.since, storedCursor);
    assertOptionalIsoDateTime(since, '--since');
    const existingResult = readExistingFrontierSignalRefs(app.paths.root);
    emitCorruptFrontierSignalWarnings(app, existingResult.corruptCount);

    const selected: FrontierSignal[] = [];
    let duplicateSignalCount = 0;
    let skippedBySinceCount = 0;
    let pendingSignalCount = 0;
    const seenSourceKeys = new Set(existingResult.sourceKeys);
    for (const signal of signals) {
      const key = frontierSignalSourceKey(signal);
      if (seenSourceKeys.has(key)) {
        duplicateSignalCount += 1;
        continue;
      }
      if (since && !frontierSignalIsAfter(signal, since)) {
        skippedBySinceCount += 1;
        continue;
      }
      if (typeof limit !== 'number' || selected.length < limit) {
        selected.push(signal);
        seenSourceKeys.add(key);
      } else {
        pendingSignalCount += 1;
      }
    }

    const signalPaths: string[] = [];
    for (const signal of selected) {
      const path = frontierSignalFilePath(app.paths.root, signal);
      writeJsonFile(path, signal);
      signalPaths.push(path);
    }

    const cursor = nextFrontierCursor(
      signals.filter((signal) => !since || frontierSignalIsAfter(signal, since)),
      since ?? storedCursor,
    );
    if (cursor) {
      mkdirSync(cursorsDir(app.paths.root), { recursive: true });
      const cursorRecord: ObservationCursorRecord = {
        connectionId: FRONTIER_CURSOR_CONNECTION_ID,
        cursor,
        updatedAt: app.now().toISOString(),
      };
      if (selected.length > 0) {
        cursorRecord.lastObservationId = selected[selected.length - 1]!.id;
      }
      if (signalPaths.length > 0) {
        cursorRecord.lastObservationPath = signalPaths[signalPaths.length - 1]!;
      }
      writeJsonFile(frontierCursorFilePath(app.paths.root), cursorRecord);
    }

    return {
      command: 'intake frontier',
      sourceConfigPath,
      ...(since ? { since } : {}),
      ...(cursor ? { cursor } : {}),
      signalCount: signals.length,
      wroteSignalCount: selected.length,
      duplicateSignalCount,
      skippedBySinceCount,
      pendingSignalCount,
      skippedCorruptSignalCount: existingResult.corruptCount,
      signalIds: selected.map((signal) => signal.id),
      signalPaths,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
}

export function readAgentDockSidecarStatus(app: AppContext): SidecarStatusResult {
  const validationStats = readValidationStats(app.paths.root);
  const proposalStats = readProposalStats(app.paths.root, validationStats.validatedProposalIds);
  const observationStats = readObservationStats(app.paths.root);
  const frontierSignalStats = readFrontierSignalStats(app.paths.root);
  const applicationStats = readApplicationStats(app.paths.root);
  const approvalRequestStats = readApprovalRequestStats(app.paths.root);
  const approvalDecisionStats = readApprovalDecisionStats(app.paths.root);
  const snapshotStats = readSnapshotStats(app.paths.root);
  const rollbackStats = readRollbackStats(app.paths.root);
  const patchBranchStats = readPatchBranchPlanStats(app.paths.root);
  return {
    command: 'status',
    root: app.paths.root,
    connection: readConnectionStatus(app.paths.root),
    cursors: readCursorStats(app.paths.root),
    observations: {
      path: observationsDir(app.paths.root),
      batchCount: observationStats.batchCount,
      corruptCount: observationStats.corruptCount,
      semanticObservationCount: observationStats.semanticObservationCount,
    },
    proposals: {
      path: proposalsDir(app.paths.root),
      count: proposalStats.count,
      corruptCount: proposalStats.corruptCount,
      pendingCount: proposalStats.pendingCount,
      validatedCount: proposalStats.validatedCount,
    },
    validations: {
      path: validationsDir(app.paths.root),
      count: validationStats.count,
      corruptCount: validationStats.corruptCount,
    },
    approvalRequests: {
      path: approvalRequestsDir(app.paths.root),
      count: approvalRequestStats.count,
      corruptCount: approvalRequestStats.corruptCount,
      pendingCount: approvalRequestStats.pendingCount,
    },
    approvalDecisions: {
      path: approvalDecisionsDir(app.paths.root),
      count: approvalDecisionStats.count,
      corruptCount: approvalDecisionStats.corruptCount,
      approveCount: approvalDecisionStats.approveCount,
      rejectCount: approvalDecisionStats.rejectCount,
      requestChangesCount: approvalDecisionStats.requestChangesCount,
    },
    snapshots: {
      path: snapshotsDir(app.paths.root),
      count: snapshotStats.count,
      corruptCount: snapshotStats.corruptCount,
    },
    rollbacks: {
      path: rollbacksDir(app.paths.root),
      count: rollbackStats.count,
      corruptCount: rollbackStats.corruptCount,
    },
    applications: {
      path: applicationsDir(app.paths.root),
      count: applicationStats.count,
      corruptCount: applicationStats.corruptCount,
      readyCount: applicationStats.readyCount,
      appliedCount: applicationStats.appliedCount,
      rolledBackCount: applicationStats.rolledBackCount,
    },
    patchBranches: {
      path: patchBranchesDir(app.paths.root),
      count: patchBranchStats.count,
      corruptCount: patchBranchStats.corruptCount,
      plannedCount: patchBranchStats.plannedCount,
    },
    frontierSignals: {
      path: frontierSignalsDir(app.paths.root),
      count: frontierSignalStats.count,
      corruptCount: frontierSignalStats.corruptCount,
      activeCount: frontierSignalStats.activeCount,
      rejectedCount: frontierSignalStats.rejectedCount,
      supersededCount: frontierSignalStats.supersededCount,
    },
  };
}

function resolveObservationConnection(
  app: AppContext,
  options: ObserveOptions,
  sourceMode: 'http' | 'fake',
): AgentDockConnectionRecord {
  const id = normalizeConnectionId(
    options.connection ?? process.env.HARO_AGENTDOCK_CONNECTION_ID ?? (sourceMode === 'fake' ? 'fake-agentdock' : DEFAULT_CONNECTION_ID),
  );
  const urlOverride = options.agentdockUrl ?? options.baseUrl ?? process.env.HARO_AGENTDOCK_BASE_URL;
  const authRef = normalizeAuthRef(options.authRef);
  if (urlOverride) {
    const source = createHttpAgentDockSource({ baseUrl: urlOverride, connectionId: id, now: app.now });
    return {
      id,
      baseUrl: source.connection.baseUrl,
      ...(authRef ? { authRef } : {}),
      createdAt: app.now().toISOString(),
      updatedAt: app.now().toISOString(),
    };
  }

  const file = readConnectionsFile(app.paths.root);
  const connectionId = options.connection ?? file.defaultConnectionId;
  const saved = connectionId ? file.connections[connectionId] : undefined;
  if (saved) return { ...saved, ...(authRef ? { authRef } : {}) };
  if (sourceMode === 'fake') {
    return {
      id,
      baseUrl: 'http://127.0.0.1:3000',
      ...(authRef ? { authRef } : {}),
      createdAt: app.now().toISOString(),
      updatedAt: app.now().toISOString(),
    };
  }
  throw new CommanderExit(
    1,
    `No AgentDock connection configured. Run \`haro connect agent-dock --base-url <url>\` or pass \`--agentdock-url <url>\`.`,
  );
}

function normalizeSourceMode(raw: string | undefined): 'http' | 'fake' {
  const mode = (raw ?? process.env.HARO_AGENTDOCK_SOURCE ?? 'auto').trim().toLowerCase();
  if (mode === 'fake' || mode === 'fixture') return 'fake';
  if (mode === 'auto' || mode === 'http') return 'http';
  throw new CommanderExit(2, `--source must be one of auto|http|fake (got '${raw}')`);
}

function resolveSince(raw: string | undefined, storedCursor: string | undefined): string | undefined {
  const value = raw ?? 'last';
  if (value === 'none') return undefined;
  if (value === 'last') return storedCursor;
  return value;
}

function normalizeConnectionId(raw: string): string {
  const value = raw.trim();
  if (!/^[\w:-]+$/.test(value)) {
    throw new CommanderExit(2, `connection id must match /^[\\w:-]+$/ (got '${raw}')`);
  }
  return value;
}

function normalizeAuthRef(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new CommanderExit(2, `auth ref must be env:VARNAME (got '${raw}')`);
  }
  return value;
}

function resolveAuthHeader(authRef: string | undefined): string | undefined {
  if (authRef?.startsWith('env:')) {
    const name = authRef.slice('env:'.length);
    const value = process.env[name];
    if (!value) {
      throw new CommanderExit(1, `AgentDock auth ref ${authRef} is not set in the environment.`);
    }
    return value;
  }
  return process.env.HARO_AGENTDOCK_AUTH_HEADER || undefined;
}

function normalizeOptionalPositiveInt(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new CommanderExit(2, `${label} must be a positive integer`);
  }
  return value;
}

function readConnectionsFile(root: string): AgentDockConnectionsFile {
  const path = connectionsPath(root);
  if (!existsSync(path)) return { connections: {} };
  let value: Partial<AgentDockConnectionsFile>;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AgentDockConnectionsFile>;
  } catch (error) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock connections file at ${path}; remove it or rerun \`haro connect agent-dock\`. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value) || !isRecord(value.connections)) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock connections file at ${path}; expected { connections: {...} }. Remove it or rerun \`haro connect agent-dock\`.`,
    );
  }
  const defaultConnectionId = value.defaultConnectionId;
  if (defaultConnectionId !== undefined && typeof defaultConnectionId !== 'string') {
    throw new CommanderExit(
      1,
      `Invalid AgentDock connections file at ${path}; defaultConnectionId must be a string. Remove it or rerun \`haro connect agent-dock\`.`,
    );
  }
  const connections: Record<string, AgentDockConnectionRecord> = {};
  for (const [id, connection] of Object.entries(value.connections)) {
    connections[id] = validateConnectionRecord(path, id, connection);
  }
  return {
    ...(defaultConnectionId ? { defaultConnectionId } : {}),
    connections,
  };
}

function validateConnectionRecord(path: string, key: string, value: unknown): AgentDockConnectionRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id !== key ||
    typeof value.baseUrl !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.authRef !== undefined && typeof value.authRef !== 'string')
  ) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock connection '${key}' in ${path}; remove it or rerun \`haro connect agent-dock\`.`,
    );
  }
  let authRef: string | undefined;
  try {
    authRef = normalizeAuthRef(value.authRef);
  } catch {
    throw new CommanderExit(
      1,
      `Invalid AgentDock connection '${key}' in ${path}; authRef must be env:VARNAME. Remove it or rerun \`haro connect agent-dock\`.`,
    );
  }
  if (authRef) {
    return {
      ...value,
      id: value.id,
      baseUrl: value.baseUrl,
      authRef,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }
  const withoutAuthRef = { ...value };
  delete withoutAuthRef.authRef;
  return {
    ...withoutAuthRef,
    id: value.id,
    baseUrl: value.baseUrl,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function writeConnectionsFile(root: string, file: AgentDockConnectionsFile): void {
  mkdirSync(root, { recursive: true });
  writeJsonFile(connectionsPath(root), file);
}

function readCursor(path: string, expectedConnectionId?: string): ObservationCursorRecord | undefined {
  if (!existsSync(path)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock cursor file at ${path}; remove it and rerun \`haro observe\`. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const cursor = parseCursorRecord(value);
  if (!cursor) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock cursor file at ${path}; expected { connectionId, cursor }. Remove it and rerun \`haro observe\`.`,
    );
  }
  if (expectedConnectionId && cursor.connectionId !== expectedConnectionId) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock cursor file at ${path}; connectionId '${cursor.connectionId}' does not match '${expectedConnectionId}'. Remove it and rerun \`haro observe\`.`,
    );
  }
  return cursor;
}

function parseCursorRecord(value: unknown): ObservationCursorRecord | undefined {
  if (
    !isRecord(value) ||
    typeof value.connectionId !== 'string' ||
    typeof value.cursor !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.lastObservationId !== undefined && typeof value.lastObservationId !== 'string') ||
    (value.lastObservationPath !== undefined && typeof value.lastObservationPath !== 'string')
  ) {
    return undefined;
  }
  return value as unknown as ObservationCursorRecord;
}

function connectionsPath(root: string): string {
  return join(root, CONNECTIONS_FILE);
}

function cursorFilePath(root: string, connectionId: string): string {
  return join(cursorsDir(root), `${encodedConnectionId(connectionId)}.json`);
}

function observationFilePath(root: string, batch: ObservationBatch): string {
  return join(
    observationsDir(root),
    `${safePathSegment(batch.collectedAt)}-${encodedConnectionId(batch.connectionId)}-${safePathSegment(batch.id)}.json`,
  );
}

function proposalFilePath(root: string, proposal: EvolutionProposal): string {
  return join(proposalsDir(root), `${safePathSegment(proposal.id)}.json`);
}

function validationFilePath(root: string, report: ValidationReport): string {
  return join(validationsDir(root), `${safePathSegment(report.id)}.json`);
}

function approvalRequestFilePath(root: string, record: ApprovalRequestRecord): string {
  return join(approvalRequestsDir(root), `${safePathSegment(record.id)}.json`);
}

function applicationFilePath(root: string, record: ApplicationRecord): string {
  return join(applicationsDir(root), `${safePathSegment(record.id)}.json`);
}

function patchBranchPlanFilePath(root: string, record: PatchBranchPlanRecord): string {
  return join(patchBranchesDir(root), `${safePathSegment(record.id)}.json`);
}

function snapshotFilePath(root: string, record: AssetSnapshotRecord): string {
  return join(snapshotsDir(root), `${safePathSegment(record.id)}.json`);
}

function rollbackFilePath(root: string, record: RollbackRecord): string {
  return join(rollbacksDir(root), `${safePathSegment(record.id)}.json`);
}

function frontierSignalFilePath(root: string, signal: FrontierSignal): string {
  const fingerprint = sha256(frontierSignalSourceKey(signal)).slice(0, 12);
  return join(
    frontierSignalsDir(root),
    `${safePathSegment(signal.collectedAt)}-${safePathSegment(signal.id)}-${fingerprint}.json`,
  );
}

function frontierCursorFilePath(root: string): string {
  return cursorFilePath(root, FRONTIER_CURSOR_CONNECTION_ID);
}

function cursorsDir(root: string): string {
  return join(root, 'evolution', 'cursors');
}

function observationsDir(root: string): string {
  return join(root, 'evolution', 'observations');
}

function proposalsDir(root: string): string {
  return join(root, 'evolution', 'proposals');
}

function validationsDir(root: string): string {
  return join(root, 'evolution', 'validations');
}

function approvalRequestsDir(root: string): string {
  return join(root, 'evolution', 'approval-requests');
}

function approvalDecisionsDir(root: string): string {
  return join(root, 'evolution', 'approval-decisions');
}

function applicationsDir(root: string): string {
  return join(root, 'evolution', 'applications');
}

function patchBranchesDir(root: string): string {
  return join(root, 'evolution', 'patch-branches');
}

function snapshotsDir(root: string): string {
  return join(root, 'evolution', 'snapshots');
}

function rollbacksDir(root: string): string {
  return join(root, 'evolution', 'rollbacks');
}

function snapshotContentDir(root: string, snapshotId: string): string {
  return join(root, 'evolution', 'snapshot-content', safePathSegment(snapshotId));
}

function currentAssetContentDir(root: string, kind: string): string {
  return join(root, 'assets', 'current', kind);
}

function proposalContentDir(root: string, proposalId: string): string {
  return join(root, 'evolution', 'proposal-content', safePathSegment(proposalId));
}

function frontierSignalsDir(root: string): string {
  return join(root, 'evolution', 'frontier-signals');
}

function acquireConnectionLock(root: string, connectionId: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, `${encodedConnectionId(connectionId)}.lock`);
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        `Another haro observe process is already running for connection ${connectionId}.`,
      );
    }
    throw error;
  }
  return dir;
}

function acquireProposeLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'propose.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro propose process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function acquireValidateLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'validate.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro validate process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function acquireApprovalRequestLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'approval-request.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro approval-request process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function acquireSnapshotLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'snapshot.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro snapshot process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function acquireApplyLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'apply.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro apply/rollback process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function acquirePatchBranchLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'patch-branch.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro patch-branch process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function acquireFrontierIntakeLock(root: string): string {
  const parent = join(root, 'evolution', 'locks');
  mkdirSync(parent, { recursive: true });
  const dir = join(parent, 'frontier-intake.lock');
  try {
    mkdirSync(dir);
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'EEXIST') {
      throw new CommanderExit(
        1,
        'Another haro intake frontier process is already running.',
      );
    }
    throw error;
  }
  return dir;
}

function releaseConnectionLock(lockDir: string): void {
  rmSync(lockDir, { recursive: true, force: true });
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

function writeContentFile(path: string, content: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

function pruneSeenObservations(root: string, batch: ObservationBatch): ObservationBatch {
  const seen = readSeenObservationIds(root, batch.connectionId);
  if (seen.size === 0) return batch;
  return ObservationBatchSchema.parse({
    ...batch,
    sessions: batch.sessions.filter((item) => !seen.has(item.id)),
    turns: batch.turns.filter((item) => !seen.has(item.id)),
    toolCalls: batch.toolCalls.filter((item) => !seen.has(item.id)),
    scheduledTaskRuns: batch.scheduledTaskRuns.filter((item) => !seen.has(item.id)),
    memoryMaintenanceLogs: batch.memoryMaintenanceLogs.filter((item) => !seen.has(item.id)),
    runnerErrors: batch.runnerErrors.filter((item) => !seen.has(item.id)),
    usageRecords: batch.usageRecords.filter((item) => !seen.has(item.id)),
  });
}

function readSeenObservationIds(root: string, connectionId: string): Set<string> {
  const dir = join(root, 'evolution', 'observations');
  const ids = new Set<string>();
  if (!existsSync(dir)) return ids;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const batch = ObservationBatchSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      if (batch.connectionId !== connectionId) continue;
      for (const item of [
        ...batch.sessions,
        ...batch.turns,
        ...batch.toolCalls,
        ...batch.scheduledTaskRuns,
        ...batch.memoryMaintenanceLogs,
        ...batch.runnerErrors,
        ...batch.usageRecords,
      ]) {
        ids.add(item.id);
      }
    } catch {
      // Ignore corrupt or non-batch files; doctor/status can report them later.
    }
  }
  return ids;
}

function readUnconsumedObservationBatches(
  root: string,
  consumedBatchIds: ReadonlySet<string>,
): { batches: ObservationBatch[]; corruptCount: number } {
  const dir = join(root, 'evolution', 'observations');
  if (!existsSync(dir)) return { batches: [], corruptCount: 0 };
  const batches: ObservationBatch[] = [];
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const batch = ObservationBatchSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      if (!consumedBatchIds.has(batch.id)) batches.push(batch);
    } catch {
      corruptCount += 1;
    }
  }
  return { batches, corruptCount };
}

function readConsumedObservationBatchIds(root: string): { consumed: Set<string>; corruptCount: number } {
  const dir = join(root, 'evolution', 'proposals');
  const consumed = new Set<string>();
  if (!existsSync(dir)) return { consumed, corruptCount: 0 };
  let corruptCount = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const proposal = EvolutionProposalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      for (const ref of proposal.sourceObservationRefs) {
        if (ref.kind === 'observation-batch') consumed.add(ref.id);
      }
    } catch {
      corruptCount += 1;
    }
  }
  return { consumed, corruptCount };
}

function readPendingProposals(
  root: string,
  validatedProposalIds: ReadonlySet<string>,
): { proposals: EvolutionProposal[]; corruptCount: number } {
  const dir = join(root, 'evolution', 'proposals');
  if (!existsSync(dir)) return { proposals: [], corruptCount: 0 };
  const proposals: EvolutionProposal[] = [];
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const proposal = EvolutionProposalSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      if (!validatedProposalIds.has(proposal.id)) proposals.push(proposal);
    } catch {
      corruptCount += 1;
    }
  }
  return { proposals, corruptCount };
}

function readValidatedProposalIds(root: string): { validated: Set<string>; corruptCount: number } {
  const dir = join(root, 'evolution', 'validations');
  const validated = new Set<string>();
  if (!existsSync(dir)) return { validated, corruptCount: 0 };
  let corruptCount = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = ValidationReportSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      validated.add(report.proposalId);
    } catch {
      corruptCount += 1;
    }
  }
  return { validated, corruptCount };
}

function readApprovalRequestedProposalIds(root: string): { requested: Set<string>; corruptCount: number } {
  const dir = approvalRequestsDir(root);
  const requested = new Set<string>();
  if (!existsSync(dir)) return { requested, corruptCount: 0 };
  let corruptCount = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApprovalRequestRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      requested.add(record.proposalId);
    } catch {
      corruptCount += 1;
    }
  }
  return { requested, corruptCount };
}

function readApprovalRequestProposalDedupeKeys(root: string): Set<string> {
  const dir = approvalRequestsDir(root);
  const keys = new Set<string>();
  if (!existsSync(dir)) return keys;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApprovalRequestRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      const proposal = readProposalById(root, record.proposalId);
      if (proposal) keys.add(proposalApprovalRequestDedupeKey(proposal));
    } catch {
      // Corrupt approval request artifacts are already counted by
      // readApprovalRequestedProposalIds(); skip them here so a corrupt file
      // cannot block new review material.
    }
  }
  return keys;
}

function proposalApprovalRequestDedupeKey(proposal: EvolutionProposal): string {
  return JSON.stringify({
    level: proposal.level,
    targetKind: proposal.targetKind,
    riskLevel: proposal.riskLevel,
    changeSet: proposal.changeSet
      .map((change) => ({
        op: change.op,
        contentHash: change.contentHash ?? '',
        targetRef: {
          id: change.targetRef.id,
          kind: change.targetRef.kind,
          uri: change.targetRef.uri ?? '',
        },
      }))
      .sort((a, b) => (
        `${a.op}:${a.targetRef.kind}:${a.targetRef.id}:${a.targetRef.uri}`
          .localeCompare(`${b.op}:${b.targetRef.kind}:${b.targetRef.id}:${b.targetRef.uri}`)
      )),
  });
}

function readApprovalDecisionProposalIds(root: string): { decided: Set<string>; corruptCount: number } {
  const dir = approvalDecisionsDir(root);
  const decided = new Set<string>();
  if (!existsSync(dir)) return { decided, corruptCount: 0 };
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApprovalDecisionRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      decided.add(record.proposalId);
    } catch {
      corruptCount += 1;
    }
  }
  return { decided, corruptCount };
}

function readLatestApprovalDecisionForProposal(
  root: string,
  proposalId: string,
): { decision?: ApprovalDecisionRecord; corruptCount: number } {
  const dir = approvalDecisionsDir(root);
  if (!existsSync(dir)) return { corruptCount: 0 };
  let decision: ApprovalDecisionRecord | undefined;
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApprovalDecisionRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (record.proposalId !== proposalId) continue;
      if (!decision || record.createdAt > decision.createdAt || (record.createdAt === decision.createdAt && record.id > decision.id)) {
        decision = record;
      }
    } catch {
      corruptCount += 1;
    }
  }
  return { ...(decision ? { decision } : {}), corruptCount };
}

function readValidatedProposalsNeedingApprovalRequest(
  root: string,
  validatedProposalIds: ReadonlySet<string>,
  requestedProposalIds: ReadonlySet<string>,
  decidedProposalIds: ReadonlySet<string>,
): { proposals: Array<{ proposal: EvolutionProposal; validation: ValidationReport }>; corruptCount: number } {
  const dir = proposalsDir(root);
  if (!existsSync(dir)) return { proposals: [], corruptCount: 0 };
  const proposals: Array<{ proposal: EvolutionProposal; validation: ValidationReport }> = [];
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const proposal = EvolutionProposalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (!validatedProposalIds.has(proposal.id)) continue;
      if (requestedProposalIds.has(proposal.id)) continue;
      if (decidedProposalIds.has(proposal.id)) continue;
      if (proposal.humanApprovalRefs.length > 0) continue;
      if (proposal.status === 'rejected' || proposal.status === 'superseded' || proposal.status === 'applied') continue;
      const validation = readLatestValidationForProposal(root, proposal.id);
      if (validation) proposals.push({ proposal, validation });
    } catch {
      corruptCount += 1;
    }
  }
  return { proposals, corruptCount };
}

function filterActionableApprovalRequestProposals(
  root: string,
  proposals: Array<{ proposal: EvolutionProposal; validation: ValidationReport }>,
): { proposals: Array<{ proposal: EvolutionProposal; validation: ValidationReport }>; skippedCount: number } {
  const actionable: Array<{ proposal: EvolutionProposal; validation: ValidationReport }> = [];
  let skippedCount = 0;
  for (const item of proposals) {
    const blockingReasons = approvalRequestReadinessBlockingReasons(root, item.proposal, item.validation);
    if (blockingReasons.length > 0) {
      skippedCount += 1;
      continue;
    }
    actionable.push(item);
  }
  return { proposals: actionable, skippedCount };
}

function readProposalById(root: string, proposalId: string): EvolutionProposal | undefined {
  const dir = proposalsDir(root);
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const proposal = EvolutionProposalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (proposal.id === proposalId) return proposal;
    } catch {
      // Corrupt proposal artifacts are surfaced by status/doctor; apply gates
      // fail closed by treating the target proposal as unavailable.
    }
  }
  return undefined;
}

function readApplicationById(root: string, applicationId: string): ApplicationRecord | undefined {
  const path = join(applicationsDir(root), `${safePathSegment(applicationId)}.json`);
  if (!existsSync(path)) return undefined;
  try {
    const record = ApplicationRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return record.id === applicationId ? record : undefined;
  } catch {
    return undefined;
  }
}

function readLatestValidationForProposal(root: string, proposalId: string): ValidationReport | undefined {
  const dir = validationsDir(root);
  if (!existsSync(dir)) return undefined;
  const reports: ValidationReport[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = ValidationReportSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (report.proposalId === proposalId) reports.push(report);
    } catch {
      // Corrupt validation artifacts are surfaced by status/doctor; apply gates
      // fail closed when no valid validation report remains.
    }
  }
  return reports.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0];
}

function readValidationById(root: string, validationId: string): ValidationReport | undefined {
  const path = join(validationsDir(root), `${safePathSegment(validationId)}.json`);
  if (!existsSync(path)) return undefined;
  try {
    const report = ValidationReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return report.id === validationId ? report : undefined;
  } catch {
    return undefined;
  }
}

function readSnapshotById(root: string, snapshotId: string): AssetSnapshotRecord | undefined {
  const path = join(snapshotsDir(root), `${safePathSegment(snapshotId)}.json`);
  if (!existsSync(path)) return undefined;
  try {
    const snapshot = AssetSnapshotRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return snapshot.id === snapshotId ? snapshot : undefined;
  } catch {
    return undefined;
  }
}

function readRollbackById(root: string, rollbackId: string): RollbackRecord | undefined {
  const path = join(rollbacksDir(root), `${safePathSegment(rollbackId)}.json`);
  if (!existsSync(path)) return undefined;
  try {
    const rollback = RollbackRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return rollback.id === rollbackId ? rollback : undefined;
  } catch {
    return undefined;
  }
}

function readConnectionStatus(root: string): SidecarStatusResult['connection'] {
  const path = connectionsPath(root);
  if (!existsSync(path)) {
    return {
      path,
      configured: false,
      valid: true,
      connectionCount: 0,
      connections: [],
    };
  }
  try {
    const file = readConnectionsFile(root);
    return {
      path,
      configured: true,
      valid: true,
      connectionCount: Object.keys(file.connections).length,
      ...(file.defaultConnectionId ? { defaultConnectionId: file.defaultConnectionId } : {}),
      connections: Object.values(file.connections)
        .map((connection) => ({
          id: connection.id,
          baseUrl: connection.baseUrl,
          hasAuthRef: Boolean(connection.authRef),
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  } catch (error) {
    return {
      path,
      configured: true,
      valid: false,
      connectionCount: 0,
      error: error instanceof Error ? error.message : String(error),
      connections: [],
    };
  }
}

function readCursorStats(root: string): SidecarStatusResult['cursors'] {
  const dir = cursorsDir(root);
  if (!existsSync(dir)) return { path: dir, count: 0, corruptCount: 0 };
  let count = 0;
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const cursor = parseCursorRecord(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (!cursor) {
        corruptCount += 1;
        continue;
      }
      count += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { path: dir, count, corruptCount };
}

function readObservationStats(root: string): {
  batchCount: number;
  corruptCount: number;
  semanticObservationCount: number;
} {
  const dir = observationsDir(root);
  if (!existsSync(dir)) return { batchCount: 0, corruptCount: 0, semanticObservationCount: 0 };
  let batchCount = 0;
  let corruptCount = 0;
  let semanticObservationCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const batch = ObservationBatchSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      batchCount += 1;
      semanticObservationCount += countSemanticObservations(batch);
    } catch {
      corruptCount += 1;
    }
  }
  return { batchCount, corruptCount, semanticObservationCount };
}

function readProposalStats(
  root: string,
  validatedProposalIds: ReadonlySet<string>,
): {
  count: number;
  corruptCount: number;
  pendingCount: number;
  validatedCount: number;
} {
  const dir = proposalsDir(root);
  if (!existsSync(dir)) return { count: 0, corruptCount: 0, pendingCount: 0, validatedCount: 0 };
  let count = 0;
  let corruptCount = 0;
  let pendingCount = 0;
  let validatedCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const proposal = EvolutionProposalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      if (validatedProposalIds.has(proposal.id)) {
        validatedCount += 1;
      } else {
        pendingCount += 1;
      }
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, pendingCount, validatedCount };
}

function readValidationStats(root: string): {
  count: number;
  corruptCount: number;
  validatedProposalIds: Set<string>;
} {
  const dir = validationsDir(root);
  const validatedProposalIds = new Set<string>();
  if (!existsSync(dir)) return { count: 0, corruptCount: 0, validatedProposalIds };
  let count = 0;
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const report = ValidationReportSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      validatedProposalIds.add(report.proposalId);
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, validatedProposalIds };
}

function readApplicationStats(root: string): {
  count: number;
  corruptCount: number;
  readyCount: number;
  appliedCount: number;
  rolledBackCount: number;
} {
  const dir = applicationsDir(root);
  if (!existsSync(dir)) {
    return { count: 0, corruptCount: 0, readyCount: 0, appliedCount: 0, rolledBackCount: 0 };
  }
  let count = 0;
  let corruptCount = 0;
  let readyCount = 0;
  let appliedCount = 0;
  let rolledBackCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApplicationRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      if (record.status === 'ready') readyCount += 1;
      if (record.status === 'applied') appliedCount += 1;
      if (record.status === 'rolled-back') rolledBackCount += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, readyCount, appliedCount, rolledBackCount };
}

function readApprovalRequestStats(root: string): {
  count: number;
  corruptCount: number;
  pendingCount: number;
} {
  const dir = approvalRequestsDir(root);
  if (!existsSync(dir)) return { count: 0, corruptCount: 0, pendingCount: 0 };
  let count = 0;
  let corruptCount = 0;
  let pendingCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApprovalRequestRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      if (record.status === 'pending') pendingCount += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, pendingCount };
}

function readApprovalDecisionStats(root: string): {
  count: number;
  corruptCount: number;
  approveCount: number;
  rejectCount: number;
  requestChangesCount: number;
} {
  const dir = approvalDecisionsDir(root);
  if (!existsSync(dir)) {
    return { count: 0, corruptCount: 0, approveCount: 0, rejectCount: 0, requestChangesCount: 0 };
  }
  let count = 0;
  let corruptCount = 0;
  let approveCount = 0;
  let rejectCount = 0;
  let requestChangesCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = ApprovalDecisionRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      if (record.decision === 'approve') approveCount += 1;
      if (record.decision === 'reject') rejectCount += 1;
      if (record.decision === 'request-changes') requestChangesCount += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, approveCount, rejectCount, requestChangesCount };
}

function readPatchBranchPlanStats(root: string): {
  count: number;
  corruptCount: number;
  plannedCount: number;
} {
  const dir = patchBranchesDir(root);
  if (!existsSync(dir)) return { count: 0, corruptCount: 0, plannedCount: 0 };
  let count = 0;
  let corruptCount = 0;
  let plannedCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = PatchBranchPlanRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      if (record.status === 'planned') plannedCount += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, plannedCount };
}

function readSnapshotStats(root: string): { count: number; corruptCount: number } {
  const dir = snapshotsDir(root);
  if (!existsSync(dir)) return { count: 0, corruptCount: 0 };
  let count = 0;
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      AssetSnapshotRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount };
}

function readRollbackStats(root: string): { count: number; corruptCount: number } {
  const dir = rollbacksDir(root);
  if (!existsSync(dir)) return { count: 0, corruptCount: 0 };
  let count = 0;
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      RollbackRecordSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount };
}

function readFrontierSourceConfig(path: string): FrontierSignal[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CommanderExit(
      1,
      `Invalid frontier source config at ${path}; expected JSON FrontierSignal[] or { signals: [...] }. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.signals)
      ? value.signals
      : undefined;
  if (!items) {
    throw new CommanderExit(
      1,
      `Invalid frontier source config at ${path}; expected FrontierSignal[] or { signals: FrontierSignal[] }.`,
    );
  }
  return items.map((item, index) => {
    const parsed = FrontierSignalSchema.safeParse(item);
    if (parsed.success) return parsed.data;
    const details = parsed.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    throw new CommanderExit(
      1,
      `Invalid FrontierSignal at ${path}#signals[${index}]: ${details}`,
    );
  });
}

function readExistingFrontierSignalRefs(root: string): { sourceKeys: Set<string>; corruptCount: number } {
  const dir = frontierSignalsDir(root);
  const sourceKeys = new Set<string>();
  if (!existsSync(dir)) return { sourceKeys, corruptCount: 0 };
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const signal = FrontierSignalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      sourceKeys.add(frontierSignalSourceKey(signal));
    } catch {
      corruptCount += 1;
    }
  }
  return { sourceKeys, corruptCount };
}

function readFrontierSignalStats(root: string): {
  count: number;
  corruptCount: number;
  activeCount: number;
  rejectedCount: number;
  supersededCount: number;
} {
  const dir = frontierSignalsDir(root);
  if (!existsSync(dir)) {
    return { count: 0, corruptCount: 0, activeCount: 0, rejectedCount: 0, supersededCount: 0 };
  }
  let count = 0;
  let corruptCount = 0;
  let activeCount = 0;
  let rejectedCount = 0;
  let supersededCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const signal = FrontierSignalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      count += 1;
      if (signal.status === 'active') activeCount += 1;
      if (signal.status === 'rejected') rejectedCount += 1;
      if (signal.status === 'superseded') supersededCount += 1;
    } catch {
      corruptCount += 1;
    }
  }
  return { count, corruptCount, activeCount, rejectedCount, supersededCount };
}

function readActiveFrontierSignals(root: string): { signals: FrontierSignal[]; corruptCount: number } {
  const dir = frontierSignalsDir(root);
  if (!existsSync(dir)) return { signals: [], corruptCount: 0 };
  const signals: FrontierSignal[] = [];
  const seenSourceKeys = new Set<string>();
  let corruptCount = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    try {
      const signal = FrontierSignalSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (signal.status !== 'active') continue;
      const key = frontierSignalSourceKey(signal);
      if (seenSourceKeys.has(key)) continue;
      seenSourceKeys.add(key);
      signals.push(signal);
    } catch {
      corruptCount += 1;
    }
  }
  return { signals, corruptCount };
}

function emitCorruptJsonWarnings(
  app: AppContext,
  counts: { corruptObservationCount: number; corruptProposalCount: number },
): void {
  if (counts.corruptObservationCount > 0) {
    app.stderr.write(
      `Warning: skipped ${counts.corruptObservationCount} corrupt AgentDock observation file(s) under evolution/observations.\n`,
    );
  }
  if (counts.corruptProposalCount > 0) {
    app.stderr.write(
      `Warning: skipped ${counts.corruptProposalCount} corrupt AgentDock proposal file(s) under evolution/proposals.\n`,
    );
  }
}

function emitCorruptValidationWarnings(
  app: AppContext,
  counts: { corruptProposalCount: number; corruptValidationCount: number },
): void {
  if (counts.corruptProposalCount > 0) {
    app.stderr.write(
      `Warning: skipped ${counts.corruptProposalCount} corrupt AgentDock proposal file(s) under evolution/proposals.\n`,
    );
  }
  if (counts.corruptValidationCount > 0) {
    app.stderr.write(
      `Warning: skipped ${counts.corruptValidationCount} corrupt AgentDock validation file(s) under evolution/validations.\n`,
    );
  }
}

function emitCorruptFrontierSignalWarnings(app: AppContext, corruptSignalCount: number): void {
  if (corruptSignalCount > 0) {
    app.stderr.write(
      `Warning: skipped ${corruptSignalCount} corrupt frontier signal file(s) under evolution/frontier-signals.\n`,
    );
  }
}

function blockedApplyResult(
  proposalId: string,
  gateCode: Exclude<ApplyGateCode, 'READY'>,
  blockingReasons: string[],
  validationId?: string,
): ApplyResult {
  return {
    command: 'apply',
    proposalId,
    gateStatus: 'blocked',
    gateCode,
    gatePassed: false,
    applied: false,
    applicationRecordCount: 0,
    assetEventCount: 0,
    assetEventIds: [],
    blockingReasons,
    ...(validationId ? { validationId } : {}),
  };
}

function blockedRollbackResult(
  applicationId: string,
  gateCode: Exclude<RollbackGateCode, 'READY'>,
  blockingReasons: string[],
  application?: ApplicationRecord,
): RollbackResult {
  return {
    command: 'rollback',
    applicationId,
    ...(application ? {
      proposalId: application.proposalId,
      validationId: application.validationId,
      snapshotId: application.snapshotRef?.id,
      rollbackId: application.rollbackRef?.id,
    } : {}),
    gateStatus: 'blocked',
    gateCode,
    gatePassed: false,
    rolledBack: false,
    applicationRecordCount: 0,
    assetEventCount: 0,
    assetEventIds: [],
    blockingReasons,
  };
}

function blockedPatchBranchResult(
  proposalId: string,
  gateCode: Exclude<PatchBranchGateCode, 'READY'>,
  blockingReasons: string[],
  validationId?: string,
): PatchBranchResult {
  return {
    command: 'patch-branch',
    proposalId,
    gateStatus: 'blocked',
    gateCode,
    gatePassed: false,
    planCount: 0,
    blockingReasons,
    ...(validationId ? { validationId } : {}),
  };
}

function assertSnapshotAllowedProposal(proposal: EvolutionProposal): void {
  if (proposal.level === 'L2' || proposal.level === 'L3') {
    throw new CommanderExit(
      1,
      'Direct snapshot/apply is forbidden for L2/L3 proposals; generate a patch branch and require human review.',
    );
  }
  const unsupportedTargetReason = unsupportedL0L1TargetReason(proposal);
  if (unsupportedTargetReason) {
    throw new CommanderExit(1, unsupportedTargetReason);
  }
}

function unsupportedL0L1TargetReason(proposal: EvolutionProposal): string | undefined {
  const allowedL0 = new Set(['prompt', 'mcp-tool-config']);
  const allowedL1 = new Set(['skill', 'runner-profile', 'schedule-config', 'routing-rule']);
  const allowed = proposal.level === 'L0' ? allowedL0 : allowedL1;
  if (allowed.has(proposal.targetKind)) return undefined;
  return `Target kind ${proposal.targetKind} is not in the ${proposal.level} direct-apply allowlist.`;
}

function findSnapshotRef(proposal: EvolutionProposal): Ref | undefined {
  return proposal.rollbackPlan.rollbackRefs.find((ref) => /snapshot/i.test(ref.kind));
}

function findRollbackRef(proposal: EvolutionProposal): Ref | undefined {
  return proposal.rollbackPlan.rollbackRefs.find((ref) => /rollback/i.test(ref.kind));
}

function readCurrentAssetContent(
  root: string,
  proposal: EvolutionProposal,
  change: ChangeOperation,
): CurrentAssetContent | undefined {
  const extensions = currentAssetContentExtensions(proposal.targetKind);
  if (extensions.length === 0) return undefined;

  for (const extension of extensions) {
    const fileName = `${encodedAssetPathSegment(change.targetRef.id)}${extension}`;
    const path = join(currentAssetContentDir(root, proposal.targetKind), fileName);
    if (!existsSync(path) || !lstatSync(path).isFile()) continue;
    const content = readFileSync(path);
    return {
      sourceContentRef: currentAssetContentRef(proposal.targetKind, fileName, change.targetRef.id),
      content,
      contentHash: sha256(content),
      extension,
    };
  }
  return undefined;
}

function validateApplyEvidenceRefs(
  proposal: EvolutionProposal,
  validation: ValidationReport,
  snapshot: AssetSnapshotRecord,
  rollback: RollbackRecord,
): { gateCode: Exclude<ApplyGateCode, 'READY'>; reason: string } | undefined {
  if (snapshot.proposalId !== proposal.id) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} belongs to proposal ${snapshot.proposalId}, not ${proposal.id}.`,
    };
  }
  if (snapshot.validationId && snapshot.validationId !== validation.id) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} belongs to validation ${snapshot.validationId}, not ${validation.id}.`,
    };
  }
  if (snapshot.level !== proposal.level || snapshot.targetKind !== proposal.targetKind) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} target ${snapshot.level}/${snapshot.targetKind} does not match proposal ${proposal.level}/${proposal.targetKind}.`,
    };
  }
  if (snapshot.entries.length !== proposal.changeSet.length) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} entry count ${snapshot.entries.length} does not match proposal change count ${proposal.changeSet.length}.`,
    };
  }
  for (const change of proposal.changeSet) {
    if (!snapshot.entries.some((entry) => entry.assetId === change.targetRef.id && entry.targetRef.kind === change.targetRef.kind)) {
      return {
        gateCode: 'SNAPSHOT_FAILED',
        reason: `Snapshot ${snapshot.id} does not contain target ${change.targetRef.kind}:${change.targetRef.id}.`,
      };
    }
  }

  if (rollback.proposalId !== proposal.id) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} belongs to proposal ${rollback.proposalId}, not ${proposal.id}.`,
    };
  }
  if (rollback.validationId && rollback.validationId !== validation.id) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} belongs to validation ${rollback.validationId}, not ${validation.id}.`,
    };
  }
  if (rollback.snapshotRef.id !== snapshot.id) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} points to snapshot ${rollback.snapshotRef.id}, not ${snapshot.id}.`,
    };
  }
  if (rollback.entries.length !== snapshot.entries.length) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} entry count ${rollback.entries.length} does not match snapshot entry count ${snapshot.entries.length}.`,
    };
  }
  for (const entry of snapshot.entries) {
    if (!rollback.entries.some((rollbackEntry) => rollbackEntry.assetId === entry.assetId && rollbackEntry.targetRef.kind === entry.targetRef.kind)) {
      return {
        gateCode: 'ROLLBACK_REF_REQUIRED',
        reason: `Rollback ${rollback.id} does not contain target ${entry.targetRef.kind}:${entry.assetId}.`,
      };
    }
  }
  return undefined;
}

function validateRollbackEvidenceRefs(
  application: ApplicationRecord,
  snapshot: AssetSnapshotRecord,
  rollback: RollbackRecord,
): { gateCode: Exclude<RollbackGateCode, 'READY'>; reason: string } | undefined {
  if (application.snapshotRef?.id !== snapshot.id) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Application ${application.id} points to snapshot ${application.snapshotRef?.id ?? '(missing)'}, not ${snapshot.id}.`,
    };
  }
  if (application.rollbackRef?.id !== rollback.id) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Application ${application.id} points to rollback ${application.rollbackRef?.id ?? '(missing)'}, not ${rollback.id}.`,
    };
  }
  if (snapshot.proposalId !== application.proposalId) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} belongs to proposal ${snapshot.proposalId}, not ${application.proposalId}.`,
    };
  }
  if (snapshot.validationId && snapshot.validationId !== application.validationId) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} belongs to validation ${snapshot.validationId}, not ${application.validationId}.`,
    };
  }
  if (snapshot.level !== application.level || snapshot.targetKind !== application.targetKind) {
    return {
      gateCode: 'SNAPSHOT_FAILED',
      reason: `Snapshot ${snapshot.id} target ${snapshot.level}/${snapshot.targetKind} does not match application ${application.level}/${application.targetKind}.`,
    };
  }
  if (rollback.proposalId !== application.proposalId) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} belongs to proposal ${rollback.proposalId}, not ${application.proposalId}.`,
    };
  }
  if (rollback.validationId && rollback.validationId !== application.validationId) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} belongs to validation ${rollback.validationId}, not ${application.validationId}.`,
    };
  }
  if (rollback.snapshotRef.id !== snapshot.id) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} points to snapshot ${rollback.snapshotRef.id}, not ${snapshot.id}.`,
    };
  }
  if (rollback.entries.length !== snapshot.entries.length) {
    return {
      gateCode: 'ROLLBACK_REF_REQUIRED',
      reason: `Rollback ${rollback.id} entry count ${rollback.entries.length} does not match snapshot entry count ${snapshot.entries.length}.`,
    };
  }
  for (const entry of rollback.entries) {
    if (!snapshot.entries.some((snapshotEntry) => (
      snapshotEntry.changeIndex === entry.changeIndex &&
      snapshotEntry.assetId === entry.assetId &&
      snapshotEntry.targetRef.kind === entry.targetRef.kind
    ))) {
      return {
        gateCode: 'ROLLBACK_REF_REQUIRED',
        reason: `Rollback ${rollback.id} contains target ${entry.targetRef.kind}:${entry.assetId} that is not covered by snapshot ${snapshot.id}.`,
      };
    }
  }
  return undefined;
}

function prepareSidecarLocalApply(root: string, proposal: EvolutionProposal): PreparedApply | BlockedApply {
  if (!isSidecarLocalExecutableTarget(proposal.level, proposal.targetKind)) {
    return {
      ok: false,
      gateCode: 'UNSUPPORTED_APPLY_EXECUTOR',
      blockingReasons: [
        `The Phase F local apply executor only supports sidecar-local L0 prompt/mcp-tool-config and L1 skill/runner-profile/schedule-config/routing-rule targets; received ${proposal.level}/${proposal.targetKind}.`,
      ],
    };
  }

  const changes: ProposedAssetContent[] = [];
  for (let index = 0; index < proposal.changeSet.length; index += 1) {
    const change = proposal.changeSet[index]!;
    if (change.op !== 'create' && change.op !== 'update') {
      return {
        ok: false,
        gateCode: 'UNSUPPORTED_CHANGE_OPERATION',
        blockingReasons: [
          `Change ${index} uses op=${change.op}; the Phase F local apply executor only supports create/update.`,
        ],
      };
    }

    const kind = assetKindForChange(proposal, change);
    if (!kind || !isSidecarLocalExecutableTarget(proposal.level, kind)) {
      return {
        ok: false,
        gateCode: 'UNSUPPORTED_APPLY_EXECUTOR',
        blockingReasons: [
          `Change ${index} targets kind=${change.targetRef.kind}; the Phase F local apply executor only supports sidecar-local L0 prompt/mcp-tool-config and L1 skill/runner-profile/schedule-config/routing-rule.`,
        ],
      };
    }

    const proposedContent = readProposedAssetContent(root, proposal, change, index, kind);
    if (!proposedContent) {
      return {
        ok: false,
        gateCode: 'APPLY_CONTENT_REQUIRED',
        blockingReasons: [
          `No sidecar-local proposal content found for change ${index}. Expected ${proposalContentHint(proposal, change, index, kind)}.`,
        ],
      };
    }

    if (change.contentHash && !contentHashMatches(change.contentHash, proposedContent.contentHash)) {
      return {
        ok: false,
        gateCode: 'APPLY_CONTENT_HASH_MISMATCH',
        blockingReasons: [
          `Proposal content hash mismatch for change ${index}: expected ${change.contentHash}, got ${proposedContent.contentHash}.`,
        ],
      };
    }
    changes.push(proposedContent);
  }
  return { ok: true, changes };
}

function readProposedAssetContent(
  root: string,
  proposal: EvolutionProposal,
  change: ChangeOperation,
  changeIndex: number,
  kind: AssetKind,
): ProposedAssetContent | undefined {
  for (const extension of currentAssetContentExtensions(kind)) {
    const proposalFileName = proposalContentFileName(changeIndex, change.targetRef.id, extension);
    const sourcePath = join(proposalContentDir(root, proposal.id), proposalFileName);
    if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) continue;
    const content = readFileSync(sourcePath);
    const targetFileName = `${encodedAssetPathSegment(change.targetRef.id)}${extension}`;
    const alternateTargetPaths = currentAssetContentExtensions(kind)
      .filter((candidateExtension) => candidateExtension !== extension)
      .map((candidateExtension) => join(
        currentAssetContentDir(root, kind),
        `${encodedAssetPathSegment(change.targetRef.id)}${candidateExtension}`,
      ));
    return {
      changeIndex,
      targetRef: change.targetRef,
      assetId: change.targetRef.id,
      kind,
      sourceContentRef: proposalContentRef(proposal.id, proposalFileName, change.targetRef.id),
      targetContentRef: currentAssetContentRef(kind, targetFileName, change.targetRef.id),
      targetPath: join(currentAssetContentDir(root, kind), targetFileName),
      alternateTargetPaths,
      content,
      contentHash: sha256(content),
      extension,
    };
  }
  return undefined;
}

function applySidecarLocalChanges(changes: readonly ProposedAssetContent[]): void {
  for (const change of changes) {
    writeContentFile(change.targetPath, change.content);
    for (const alternatePath of change.alternateTargetPaths) {
      rmSync(alternatePath, { force: true });
    }
  }
}

function prepareSidecarLocalRollback(
  root: string,
  application: ApplicationRecord,
  snapshot: AssetSnapshotRecord,
  rollback: RollbackRecord,
): PreparedRollback | BlockedRollback {
  if (!isSidecarLocalExecutableTarget(application.level, application.targetKind)) {
    return {
      ok: false,
      gateCode: 'UNSUPPORTED_ROLLBACK_EXECUTOR',
      blockingReasons: [
        `The Phase F local rollback executor only supports sidecar-local L0 prompt/mcp-tool-config and L1 skill/runner-profile/schedule-config/routing-rule targets; received ${application.level}/${application.targetKind}.`,
      ],
    };
  }
  if (!rollback.reversible) {
    return {
      ok: false,
      gateCode: 'ROLLBACK_NOT_REVERSIBLE',
      blockingReasons: [`Rollback ${rollback.id} is marked reversible=false.`],
    };
  }

  const changes: RollbackAssetContent[] = [];
  for (const entry of rollback.entries) {
    const kind = assetKindForRollbackEntry(application, entry);
    if (!kind || !isSidecarLocalExecutableTarget(application.level, kind)) {
      return {
        ok: false,
        gateCode: 'UNSUPPORTED_ROLLBACK_EXECUTOR',
        blockingReasons: [
          `Rollback entry ${entry.changeIndex} targets kind=${entry.targetRef.kind}; the Phase F local rollback executor only supports sidecar-local L0 prompt/mcp-tool-config and L1 skill/runner-profile/schedule-config/routing-rule.`,
        ],
      };
    }

    if (entry.action === 'delete-created-asset') {
      const contentHash = sha256(JSON.stringify({
        rollbackId: rollback.id,
        assetId: entry.assetId,
        action: entry.action,
      }));
      changes.push({
        changeIndex: entry.changeIndex,
        targetRef: entry.targetRef,
        assetId: entry.assetId,
        kind,
        action: entry.action,
        sourceContentRef: rollbackRecordRef(rollback),
        targetContentRef: rollbackRecordRef(rollback),
        contentHash,
        version: contentHash.slice(0, 16),
        removePaths: currentAssetContentPaths(root, kind, entry.assetId),
      });
      continue;
    }

    if (!entry.restoreContentRef) {
      return {
        ok: false,
        gateCode: 'ROLLBACK_CONTENT_REQUIRED',
        blockingReasons: [
          `Rollback entry ${entry.changeIndex} does not include a restoreContentRef; this rollback executor only restores sidecar-local snapshot content.`,
        ],
      };
    }
    const restoreContent = readSnapshotRestoreContent(root, snapshot.id, entry.restoreContentRef, kind);
    if (!restoreContent) {
      return {
        ok: false,
        gateCode: 'ROLLBACK_CONTENT_REQUIRED',
        blockingReasons: [
          `No sidecar-local snapshot content found for rollback entry ${entry.changeIndex} at ${entry.restoreContentRef.uri ?? entry.restoreContentRef.id}.`,
        ],
      };
    }
    const contentHash = sha256(restoreContent.content);
    if (entry.restoreContentHash && !contentHashMatches(entry.restoreContentHash, contentHash)) {
      return {
        ok: false,
        gateCode: 'ROLLBACK_CONTENT_HASH_MISMATCH',
        blockingReasons: [
          `Rollback content hash mismatch for entry ${entry.changeIndex}: expected ${entry.restoreContentHash}, got ${contentHash}.`,
        ],
      };
    }
    const targetFileName = `${encodedAssetPathSegment(entry.assetId)}${restoreContent.extension}`;
    const restorePath = join(currentAssetContentDir(root, kind), targetFileName);
    const alternatePaths = currentAssetContentExtensions(kind)
      .filter((candidateExtension) => candidateExtension !== restoreContent.extension)
      .map((candidateExtension) => join(
        currentAssetContentDir(root, kind),
        `${encodedAssetPathSegment(entry.assetId)}${candidateExtension}`,
      ));
    changes.push({
      changeIndex: entry.changeIndex,
      targetRef: entry.targetRef,
      assetId: entry.assetId,
      kind,
      action: entry.action,
      sourceContentRef: entry.restoreContentRef,
      targetContentRef: currentAssetContentRef(kind, targetFileName, entry.assetId),
      contentHash,
      version: entry.restoreVersion ?? contentHash.slice(0, 16),
      restorePath,
      content: restoreContent.content,
      removePaths: alternatePaths,
    });
  }
  return { ok: true, changes };
}

function applySidecarLocalRollbackChanges(changes: readonly RollbackAssetContent[]): void {
  for (const change of changes) {
    if (change.action === 'restore-latest-event') {
      if (!change.restorePath || !change.content) {
        throw new Error(`Rollback entry ${change.changeIndex} is missing restore content.`);
      }
      writeContentFile(change.restorePath, change.content);
    }
    for (const path of change.removePaths) {
      rmSync(path, { force: true });
    }
  }
}

function proposalContentHint(
  proposal: EvolutionProposal,
  change: ChangeOperation,
  changeIndex: number,
  kind: AssetKind,
): string {
  const candidates = currentAssetContentExtensions(kind)
    .map((extension) => join(
      proposalContentDir('$HARO_HOME', proposal.id),
      proposalContentFileName(changeIndex, change.targetRef.id, extension),
    ));
  return candidates.join(' or ');
}

function contentHashMatches(expected: string, actual: string): boolean {
  return expected === actual || expected === `sha256:${actual}`;
}

function assetKindForRollbackEntry(
  application: ApplicationRecord,
  entry: RollbackRecord['entries'][number],
): AssetKind | undefined {
  const targetRefKind = AssetKindSchema.safeParse(entry.targetRef.kind);
  if (targetRefKind.success) return targetRefKind.data;
  const applicationKind = AssetKindSchema.safeParse(application.targetKind);
  if (applicationKind.success) return applicationKind.data;
  return undefined;
}

function currentAssetContentExtensions(kind: string): readonly string[] {
  if (kind === 'prompt') return ['.md', '.txt', '.json'];
  if (kind === 'mcp-tool-config') return ['.json', '.md', '.txt'];
  if (kind === 'skill') return ['.md', '.json', '.txt'];
  if (kind === 'runner-profile') return ['.json', '.yaml', '.yml', '.toml', '.md', '.txt'];
  if (kind === 'schedule-config' || kind === 'routing-rule') {
    return ['.json', '.yaml', '.yml', '.md', '.txt'];
  }
  return [];
}

function isSidecarLocalExecutableTarget(level: string, targetKind: string): boolean {
  if (level === 'L0') return targetKind === 'prompt' || targetKind === 'mcp-tool-config';
  if (level === 'L1') {
    return targetKind === 'skill' ||
      targetKind === 'runner-profile' ||
      targetKind === 'schedule-config' ||
      targetKind === 'routing-rule';
  }
  return false;
}

function currentAssetContentPaths(root: string, kind: string, assetId: string): string[] {
  return currentAssetContentExtensions(kind)
    .map((extension) => join(
      currentAssetContentDir(root, kind),
      `${encodedAssetPathSegment(assetId)}${extension}`,
    ));
}

function readSnapshotRestoreContent(
  root: string,
  snapshotId: string,
  ref: Ref,
  kind: AssetKind,
): { content: Buffer; extension: string } | undefined {
  const fileName = snapshotContentFileNameFromRef(ref, snapshotId);
  if (!fileName) return undefined;
  const extension = currentAssetContentExtensions(kind).find((candidate) => fileName.endsWith(candidate));
  if (!extension) return undefined;
  const path = join(snapshotContentDir(root, snapshotId), fileName);
  if (!existsSync(path) || !lstatSync(path).isFile()) return undefined;
  return {
    content: readFileSync(path),
    extension,
  };
}

function snapshotContentFileNameFromRef(ref: Ref, snapshotId: string): string | undefined {
  if (ref.kind !== 'snapshot-content' || !ref.uri) return undefined;
  const prefix = 'haro-sidecar://snapshot-content/';
  if (!ref.uri.startsWith(prefix)) return undefined;
  const parts = ref.uri.slice(prefix.length).split('/');
  if (parts.length !== 2) return undefined;
  try {
    const decodedSnapshotId = decodeURIComponent(parts[0]!);
    const fileName = decodeURIComponent(parts[1]!);
    if (decodedSnapshotId !== snapshotId) return undefined;
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) return undefined;
    return fileName;
  } catch {
    return undefined;
  }
}

function snapshotEntryFingerprint(entry: SnapshotEntryDraft): Record<string, unknown> {
  return {
    changeIndex: entry.changeIndex,
    targetRef: entry.targetRef,
    assetId: entry.assetId,
    existed: entry.existed,
    snapshotSource: entry.snapshotSource,
    ...(entry.latestEventRef ? { latestEventRef: entry.latestEventRef } : {}),
    ...(entry.sourceContentRef ? { sourceContentRef: entry.sourceContentRef } : {}),
    ...(entry.contentRef ? { contentRef: entry.contentRef } : {}),
    ...(entry.contentHash ? { contentHash: entry.contentHash } : {}),
    ...(entry.version ? { version: entry.version } : {}),
    ...(entry.status ? { status: entry.status } : {}),
    ...(entry.contentExtension ? { contentExtension: entry.contentExtension } : {}),
  };
}

function snapshotContentFileName(changeIndex: number, assetId: string, extension: string): string {
  return `${String(changeIndex).padStart(4, '0')}-${encodedAssetPathSegment(assetId)}${extension}`;
}

function proposalContentFileName(changeIndex: number, assetId: string, extension: string): string {
  return `${String(changeIndex).padStart(4, '0')}-${encodedAssetPathSegment(assetId)}${extension}`;
}

function currentAssetContentRef(kind: string, fileName: string, assetId: string): Ref {
  return {
    id: `${kind}:${assetId}:${fileName}`,
    kind: 'sidecar-current-content',
    uri: `haro-sidecar://assets/current/${encodeURIComponent(kind)}/${encodeURIComponent(fileName)}`,
  };
}

function snapshotContentRef(snapshotId: string, fileName: string, assetId: string): Ref {
  return {
    id: `${snapshotId}:${assetId}:${fileName}`,
    kind: 'snapshot-content',
    uri: `haro-sidecar://snapshot-content/${encodeURIComponent(snapshotId)}/${encodeURIComponent(fileName)}`,
  };
}

function proposalContentRef(proposalId: string, fileName: string, assetId: string): Ref {
  return {
    id: `${proposalId}:${assetId}:${fileName}`,
    kind: 'proposal-content',
    uri: `haro-sidecar://proposal-content/${encodeURIComponent(proposalId)}/${encodeURIComponent(fileName)}`,
  };
}

function applicationRecordRef(applicationId: string): Ref {
  return {
    id: applicationId,
    kind: 'application-record',
    uri: `haro-sidecar://applications/${encodeURIComponent(applicationId)}`,
  };
}

function applicationRecordId(
  proposal: EvolutionProposal,
  validation: ValidationReport,
  snapshotRef: Ref,
  rollbackRef: Ref,
  changes: readonly ProposedAssetContent[],
): string {
  return `application_${sha256(JSON.stringify({
    proposalId: proposal.id,
    validationId: validation.id,
    humanApprovalRefs: proposal.humanApprovalRefs,
    snapshotRef,
    rollbackRef,
    appliedContent: changes.map((change) => ({
      changeIndex: change.changeIndex,
      assetId: change.assetId,
      contentHash: change.contentHash,
    })),
  })).slice(0, 24)}`;
}

function createAppliedApplicationRecord(
  app: AppContext,
  proposal: EvolutionProposal,
  validation: ValidationReport,
  snapshotRef: Ref,
  rollbackRef: Ref,
  applicationId: string,
  assetEventRefs: Ref[],
  appliedContentRefs: Ref[],
): ApplicationRecord {
  const timestamp = app.now().toISOString();
  return ApplicationRecordSchema.parse({
    id: applicationId,
    proposalId: proposal.id,
    validationId: validation.id,
    status: 'applied',
    gateCode: 'READY',
    level: proposal.level,
    targetKind: proposal.targetKind,
    applied: true,
    snapshotRef,
    rollbackRef,
    assetEventRefs,
    evidenceRefs: [
      evolutionProposalRef(proposal),
      validationReportRef(validation),
      ...proposal.humanApprovalRefs,
      snapshotRef,
      rollbackRef,
      ...appliedContentRefs,
      ...assetEventRefs,
    ],
    blockingReasons: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createRolledBackApplicationRecord(
  app: AppContext,
  application: ApplicationRecord,
  rollbackAssetEventRefs: Ref[],
  rolledBackContentRefs: Ref[],
): ApplicationRecord {
  const timestamp = app.now().toISOString();
  return ApplicationRecordSchema.parse({
    ...application,
    status: 'rolled-back',
    gateCode: 'READY',
    applied: false,
    assetEventRefs: [
      ...application.assetEventRefs,
      ...rollbackAssetEventRefs,
    ],
    evidenceRefs: [
      ...application.evidenceRefs,
      ...(application.rollbackRef ? [application.rollbackRef] : []),
      ...rolledBackContentRefs,
      ...rollbackAssetEventRefs,
    ],
    blockingReasons: [],
    updatedAt: timestamp,
  });
}

function createPatchBranchPlanRecord(
  app: AppContext,
  proposal: EvolutionProposal,
  validation: ValidationReport,
  baseBranch?: string,
): PatchBranchPlanRecord {
  const changeRefs = proposal.changeSet.map((_change, index) => proposalChangeRef(proposal, index));
  const branchName = `haro/evolution/${safePathSegment(proposal.id)}`;
  const timestamp = app.now().toISOString();
  const planId = `patch_branch_plan_${sha256(JSON.stringify({
    proposalId: proposal.id,
    validationId: validation.id,
    baseBranch,
    changeSet: proposal.changeSet.map((change, index) => ({
      index,
      op: change.op,
      targetRef: change.targetRef,
      contentHash: change.contentHash,
    })),
  })).slice(0, 24)}`;
  return PatchBranchPlanRecordSchema.parse({
    id: planId,
    proposalId: proposal.id,
    validationId: validation.id,
    status: 'planned',
    level: proposal.level,
    targetKind: proposal.targetKind,
    sourceRef: evolutionProposalRef(proposal),
    validationRef: validationReportRef(validation),
    branchName,
    ...(baseBranch ? { baseBranch } : {}),
    changeRefs,
    requiredTests: validation.requiredTests.length > 0
      ? validation.requiredTests
      : proposal.testPlan.requiredCommands,
    manualChecks: [
      ...proposal.testPlan.manualChecks,
      '合并 L2/L3 补丁分支前必须完成人审。',
    ],
    regressionRisks: proposal.testPlan.regressionRisks,
    rollbackPlan: {
      ...proposal.rollbackPlan,
      snapshotRequired: false,
    },
    humanReviewRequired: true,
    evidenceRefs: [
      evolutionProposalRef(proposal),
      validationReportRef(validation),
      ...proposal.humanApprovalRefs,
      ...proposal.sourceObservationRefs,
      ...validation.evidenceRefs,
      ...changeRefs,
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createApprovalRequestRecord(
  app: AppContext,
  proposal: EvolutionProposal,
  validation: ValidationReport,
): ApprovalRequestRecord {
  const timestamp = app.now().toISOString();
  const changeRefs = proposal.changeSet.map((_change, index) => proposalChangeRef(proposal, index));
  const readable = readableApprovalRequestFields(proposal, validation);
  const id = `approval_request_${sha256(JSON.stringify({
    proposalId: proposal.id,
    validationId: validation.id,
    proposalUpdatedAt: proposal.updatedAt,
    validationCreatedAt: validation.createdAt,
    changeSet: proposal.changeSet.map((change, index) => ({
      index,
      op: change.op,
      targetRef: change.targetRef,
      contentHash: change.contentHash,
      summary: change.summary,
    })),
  })).slice(0, 24)}`;
  return ApprovalRequestRecordSchema.parse({
    id,
    proposalId: proposal.id,
    validationId: validation.id,
    status: 'pending',
    title: readable.title,
    level: proposal.level,
    targetKind: proposal.targetKind,
    riskLevel: proposal.riskLevel,
    sourceRef: evolutionProposalRef(proposal),
    validationRef: validationReportRef(validation),
    whyChange: readable.whyChange,
    howChange: readable.howChange,
    expectedBenefits: readable.expectedBenefits,
    requiredTests: validation.requiredTests.length > 0
      ? validation.requiredTests
      : proposal.testPlan.requiredCommands,
    manualChecks: readable.manualChecks,
    regressionRisks: readable.regressionRisks,
    rollbackPlan: readable.rollbackPlan,
    decisionOptions: ['approve', 'reject', 'request-changes'],
    reviewerInstruction: readable.reviewerInstruction,
    humanReviewRequired: true,
    evidenceRefs: [
      evolutionProposalRef(proposal),
      validationReportRef(validation),
      ...proposal.sourceObservationRefs,
      ...validation.evidenceRefs,
      ...changeRefs,
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

interface ReadableApprovalRequestFields {
  title: string;
  whyChange: string[];
  howChange: string[];
  expectedBenefits: string[];
  manualChecks: string[];
  regressionRisks: string[];
  rollbackPlan: EvolutionProposal['rollbackPlan'];
  reviewerInstruction: string;
}

function readableApprovalRequestFields(
  proposal: EvolutionProposal,
  validation: ValidationReport,
): ReadableApprovalRequestFields {
  const rollbackPlan = {
    ...proposal.rollbackPlan,
    strategy: readableRollbackStrategy(proposal),
  };
  return {
    title: readableApprovalTitle(proposal),
    whyChange: readableWhyChange(proposal, validation),
    howChange: readableHowChange(proposal),
    expectedBenefits: readableExpectedBenefits(proposal),
    manualChecks: readableManualChecks(proposal),
    regressionRisks: readableRegressionRisks(proposal),
    rollbackPlan,
    reviewerInstruction: [
      '请选择 approve（同意）、reject（驳回）或 request-changes（要求修改）。',
      '只有当你能用自己的话说清“为什么改、改哪里、坏了怎么撤”时才 approve。',
      '如果你看完仍然不知道为什么改，请直接 request-changes，并要求 Haro 重写描述。',
    ].join(' '),
  };
}

function readableApprovalTitle(proposal: EvolutionProposal): string {
  if (isGenericDryRunProposal(proposal)) {
    return '历史演练提案：没有具体改动文件，建议驳回或要求 Haro 重新生成';
  }
  if (proposal.targetKind === 'mcp-tool-config') {
    return '给 Haro 自动提案加审批门：没写清工具、边界和撤回办法的提案不再进审批页';
  }
  if (proposal.targetKind === 'runner-profile') {
    return '给 Haro 运行错误加恢复策略：遇到同类错误时先说明证据和建议，不自动重试任务';
  }
  if (proposal.targetKind === 'schedule-config') {
    return '给 Haro 定时任务失败加复核规则：失败原因没说清前不自动改调度';
  }
  return `让 Haro 的 ${readableTargetKind(proposal.targetKind)} 改动先讲清影响范围，再进入审批`;
}

function readableWhyChange(proposal: EvolutionProposal, validation: ValidationReport): string[] {
  if (isGenericDryRunProposal(proposal)) {
    return [
      '这是早期版本留下的演练请求：它只把 Haro 自检和外部资料摘要送进审批页，但没有给出可执行的具体改动文件。',
      '如果直接通过，审批人其实不知道 Haro 会改哪里；更安全的处理是驳回，或要求 Haro 重新生成一条带具体改动内容的提案。',
    ];
  }
  const evidence = readableEvidenceSummary(proposal);
  const risk = validation.applyEligible
    ? '自动检查已经确认：这条提案有人审通过后才允许继续，不会直接改 AgentDock 代码。'
    : '自动检查还没通过：这条提案暂时只能看，不能继续应用。';
  if (proposal.targetKind === 'mcp-tool-config') {
    return [
      `过去的问题是：Haro 已经能自动生成提案，但审批页没有强制要求它先说清“会用哪些工具、哪些写入能力默认关闭、出问题怎么撤”。${evidence}`,
      `不补这道门，审批人会反复看到看似正式、实际说不清边界的提案，容易误判能不能通过。${risk}`,
    ];
  }
  if (proposal.targetKind === 'runner-profile') {
    return [
      `本轮 Haro 自检快照里已经出现真实运行错误，提案会保留原始错误码、错误消息和是否可恢复，避免把运行故障包装成泛泛的优化建议。${evidence}`,
      `不做这层策略，Haro 下次遇到同类错误时仍只能生成难懂的 dry-run，审批人看不出是否应该重试、降级还是要求人工处理。${risk}`,
    ];
  }
  if (proposal.targetKind === 'schedule-config') {
    return [
      `本轮 Haro 自检快照里已经出现失败的定时任务，提案会把失败 taskId、结果引用和人工复核要求写清楚。${evidence}`,
      `不做这层规则，Haro 可能继续把“定时任务失败”描述成内部状态，审批人不知道是否需要改调度、重跑还是先补证据。${risk}`,
    ];
  }
  return [
    `这条提案要改的是 Haro 自己的 ${readableTargetKind(proposal.targetKind)}，不是 AgentDock 代码。${evidence}`,
    `现在需要审批人判断这项改动是否值得继续；${risk}`,
  ];
}

function readableHowChange(proposal: EvolutionProposal): string[] {
  return proposal.changeSet.map((change, index) => {
    const target = readableChangeTarget(proposal, change);
    const perspective = readableUserVisibleChange(proposal);
    const contentEvidence = change.contentHash
      ? '本次改动带有“具体内容文件 + 内容指纹”，审批前后可以核对内容有没有被替换。'
      : '这一步没有提供可核对的具体内容文件，因此只适合要求修改或驳回。';
    return `${index + 1}. 改动对象：${target}。${perspective} ${contentEvidence}`;
  });
}

function readableExpectedBenefits(proposal: EvolutionProposal): string[] {
  if (isGenericDryRunProposal(proposal)) {
    return [
      '审批人可以一眼识别这是历史演练请求，避免误点通过。',
      '要求 Haro 重新生成后，新的提案必须带清楚的改动内容、影响范围和撤回办法。',
    ];
  }
  if (proposal.targetKind === 'mcp-tool-config') {
    return [
      '审批人不用懂 Haro 内部实现，也能判断提案是否列清了工具、权限边界和撤回办法。',
      '描述不完整的自动提案会被挡在审批页外，减少“看不懂但像是真的”的待审项。',
      '只影响 Haro 自己的工具配置，不会修改 AgentDock 代码或用户记忆。',
    ];
  }
  if (proposal.targetKind === 'runner-profile') {
    return [
      '审批人能直接看到错误码和错误消息，判断该让 Haro 重试、降级，还是要求人工处理。',
      'Haro 下次遇到同类运行错误时，会先给出带证据的建议，而不是生成空泛演练提案。',
      '只影响 Haro 自己的运行策略文件，不会自动重放用户任务。',
    ];
  }
  if (proposal.targetKind === 'schedule-config') {
    return [
      '审批人能看到哪个定时任务失败、失败结果在哪里查，而不是只看到内部状态名。',
      'Haro 不会自动改调度；它只会把失败转成需要人审的清晰提案。',
      '只影响 Haro 自己的调度复核规则，不接管 AgentDock scheduler。',
    ];
  }
  return [
    `审批人能用普通话理解这次 ${readableTargetKind(proposal.targetKind)} 改动的影响范围。`,
    'Haro 保留测试和撤回步骤，避免通过后才发现不知道怎么恢复。',
  ];
}

function readableManualChecks(proposal: EvolutionProposal): string[] {
  if (isGenericDryRunProposal(proposal)) {
    return [
      '确认这是一条历史演练请求：它没有真正可应用的改动内容。',
      '如果你不想保留它，请在审批页选择 reject；如果希望 Haro 重新产出，请选择 request-changes 并写明要补具体改动文件。',
    ];
  }
  if (proposal.targetKind === 'mcp-tool-config') {
    return [
      '在审批页确认：这条规则讲清了 Haro 会用哪些工具、哪些写入能力默认关闭、出问题怎么撤。',
      '确认改动范围只限 Haro 自己维护的 MCP 工具配置文件，不会修改 AgentDock 代码、AgentDock 配置或用户记忆。',
      '如果你看不懂这条规则具体拦什么提案，请选择 request-changes 要求重写说明。',
    ];
  }
  if (proposal.targetKind === 'runner-profile') {
    return [
      '在审批页确认：这条策略展示了真实错误码、错误消息、是否可恢复和详情引用。',
      '确认它只给 Haro 后续处理同类运行错误提供建议，不会自动重试用户任务。',
      '如果错误证据不足以判断，请选择 request-changes 要求补充日志或拆分错误类型。',
    ];
  }
  if (proposal.targetKind === 'schedule-config') {
    return [
      '在审批页确认：这条策略展示了失败任务、任务结果引用和人工复核要求。',
      '确认它不会自动禁用、触发、重跑或改写任何 AgentDock 定时任务。',
      '如果失败原因没有讲清，请选择 request-changes 要求补充任务结果或失败日志。',
    ];
  }
  return [
    `确认这条提案只影响 ${readableTargetKind(proposal.targetKind)}。`,
    '如果你无法判断改动范围或撤回办法，请选择 request-changes 要求 Haro 重写描述。',
  ];
}

function readableRegressionRisks(proposal: EvolutionProposal): string[] {
  if (isGenericDryRunProposal(proposal)) {
    return [
      '最坏情况：审批人误以为这条历史演练请求是真改动并点了通过；最先感知的是审批人自己，因为后续找不到具体文件变化；恢复方式是在审批页 request-changes 或 reject，通常几分钟内能清掉。',
    ];
  }
  if (proposal.targetKind === 'mcp-tool-config') {
    return [
      '最坏情况：审批门设得过严，Haro 的低风险提案也进不了审批页；最先感知的是审批人，因为待审列表变少或缺少预期提案；恢复方式是在审批页 request-changes 要求放宽规则，若已应用则运行 `haro rollback --application-id <application-id>`，通常几分钟内恢复。',
    ];
  }
  if (proposal.targetKind === 'runner-profile') {
    return [
      '最坏情况：不同根因的错误被合并成同一条恢复策略；最先感知的是审批人或后续运行 Haro 的人，因为错误处理建议不匹配；恢复方式是在审批页 request-changes 要求拆分错误类型，若已应用则运行 `haro rollback --application-id <application-id>`，通常几分钟内恢复。',
    ];
  }
  if (proposal.targetKind === 'schedule-config') {
    return [
      '最坏情况：失败任务只有摘要没有足够证据，审批人仍看不出该不该改；最先感知的是审批人；恢复方式是 request-changes 要求补 resultRef 或失败日志，若已应用则运行 `haro rollback --application-id <application-id>`，通常几分钟内恢复。',
    ];
  }
  return [
    `最坏情况：${readableTargetKind(proposal.targetKind)} 的影响范围没有写清；最先感知的是审批人；恢复方式是在审批页 request-changes 要求重写描述，若已应用则运行 \`haro rollback --application-id <application-id>\`。`,
  ];
}

function readableRollbackStrategy(proposal: EvolutionProposal): string {
  if (isGenericDryRunProposal(proposal)) {
    return '如果还没通过：在 Haro Web 审批页选择 reject；如果只是看不懂：选择 request-changes 并要求 Haro 重新生成带具体改动文件的提案。这类历史演练请求没有实际可应用内容，不需要运行回滚命令。';
  }
  return [
    '如果还没通过：在 Haro Web 审批页选择 reject，或选择 request-changes 写明要 Haro 改哪里。',
    '如果已经通过并应用：先运行 `haro doctor --component sidecar --json` 或查看 Haro Web 的应用记录找到 application id，再运行 `haro rollback --application-id <application-id>` 恢复到上一个 Haro sidecar 资产版本。',
    `本次撤回只影响 ${readableTargetKind(proposal.targetKind)}，不会回滚 AgentDock 代码或 aria-memory-vault。`,
  ].join(' ');
}

function readableEvidenceSummary(proposal: EvolutionProposal): string {
  const kinds = new Set(proposal.sourceObservationRefs.map((ref) => ref.kind));
  const parts: string[] = [];
  if (kinds.has('observation-batch')) parts.push('本轮 Haro 自检快照');
  if (kinds.has('frontier-signal')) parts.push('外部一手情报（如 GitHub Changelog 等）');
  if (parts.length === 0) return '证据已经随提案保留，审批页可以继续展开查看。';
  return `证据来自${parts.join('和')}，审批页仍会保留原始引用供复核。`;
}

function readableChangeTarget(proposal: EvolutionProposal, change: ChangeOperation): string {
  const label = readableTargetKind(change.targetRef.kind || proposal.targetKind);
  return `${label}（asset id: ${change.targetRef.id}）`;
}

function readableTargetKind(kind: string): string {
  const labels: Record<string, string> = {
    'mcp-tool-config': 'Haro 自己维护的 MCP 工具配置文件',
    'runner-profile': 'Haro 自己的运行策略文件',
    'schedule-config': 'Haro 自己的调度复核规则',
    prompt: 'Haro 自己的提示词文件',
    skill: 'Haro 自己的 skill 文件',
    'routing-rule': 'Haro 自己的路由规则',
    'haro-code': 'Haro 代码',
    'agentdock-contract': 'AgentDock/Haro sidecar 契约',
  };
  return labels[kind] ?? `Haro 自己的 ${kind} 资产`;
}

function readableUserVisibleChange(proposal: EvolutionProposal): string {
  if (proposal.targetKind === 'mcp-tool-config') {
    return '审批人会看到：后续自动提案必须列清工具、权限边界和撤回办法；Haro 会把没写清这些信息的提案挡在审批页外。';
  }
  if (proposal.targetKind === 'runner-profile') {
    return '用户和审批人会看到：运行错误会显示原始错误码、错误消息和可恢复判断；Haro 会先给建议，不会自动重试任务。';
  }
  if (proposal.targetKind === 'schedule-config') {
    return '审批人会看到：失败的定时任务、结果引用和下一步复核要求；Haro 不会自动改调度或重跑任务。';
  }
  return '审批人会看到：这次改动的影响范围、预期变化和撤回方式；Haro 会等待人审结果再继续。';
}

function createSnapshotArtifacts(
  app: AppContext,
  proposal: EvolutionProposal,
  validation?: ValidationReport,
): SnapshotArtifacts {
  assertSnapshotAllowedProposal(proposal);
  const registry = createSidecarAssetRegistry(app.paths.root);
  const baselineEvents = registry.listEvents();
  const entryDrafts = proposal.changeSet.map((change, index): SnapshotEntryDraft => {
    const currentContent = readCurrentAssetContent(app.paths.root, proposal, change);
    if (currentContent) {
      return {
        changeIndex: index,
        targetRef: change.targetRef,
        assetId: change.targetRef.id,
        existed: true,
        snapshotSource: 'target-content',
        sourceContentRef: currentContent.sourceContentRef,
        contentHash: currentContent.contentHash,
        content: currentContent.content,
        contentExtension: currentContent.extension,
      };
    }

    const baseline = latestRollbackBaselineEvent(baselineEvents, proposal, change);
    return {
      changeIndex: index,
      targetRef: change.targetRef,
      assetId: change.targetRef.id,
      existed: Boolean(baseline),
      snapshotSource: baseline ? 'sidecar-ledger' : 'absent',
      ...(baseline ? {
        latestEventRef: assetEventRef(baseline),
        contentRef: baseline.contentRef,
        contentHash: baseline.contentHash,
        version: baseline.version,
        status: baseline.status,
      } : {}),
    };
  });
  const snapshotId = `snapshot_${sha256(JSON.stringify({
    proposalId: proposal.id,
    validationId: validation?.id,
    entries: entryDrafts.map(snapshotEntryFingerprint),
  })).slice(0, 24)}`;
  const snapshotRef = assetSnapshotRef(snapshotId);
  const timestamp = app.now().toISOString();
  const contentFiles: SnapshotContentFile[] = [];
  const entries = entryDrafts.map((draft) => {
    const { content, contentExtension, ...entry } = draft;
    if (content && contentExtension) {
      const fileName = snapshotContentFileName(entry.changeIndex, entry.assetId, contentExtension);
      const path = join(snapshotContentDir(app.paths.root, snapshotId), fileName);
      const contentRef = snapshotContentRef(snapshotId, fileName, entry.assetId);
      contentFiles.push({ path, content });
      return {
        ...entry,
        contentRef,
      };
    }
    return entry;
  });
  const snapshot = AssetSnapshotRecordSchema.parse({
    id: snapshotId,
    proposalId: proposal.id,
    ...(validation ? { validationId: validation.id } : {}),
    level: proposal.level,
    targetKind: proposal.targetKind,
    sourceRef: evolutionProposalRef(proposal),
    entries,
    createdAt: timestamp,
  });
  const rollbackEntries = snapshot.entries.map((entry) => ({
    changeIndex: entry.changeIndex,
    targetRef: entry.targetRef,
    assetId: entry.assetId,
    action: entry.existed ? 'restore-latest-event' : 'delete-created-asset',
    existedBefore: entry.existed,
    ...(entry.latestEventRef ? { restoreEventRef: entry.latestEventRef } : {}),
    ...(entry.contentRef ? { restoreContentRef: entry.contentRef } : {}),
    ...(entry.contentHash ? { restoreContentHash: entry.contentHash } : {}),
    ...(entry.version ? { restoreVersion: entry.version } : {}),
  }));
  const rollbackId = `rollback_${sha256(JSON.stringify({
    proposalId: proposal.id,
    validationId: validation?.id,
    snapshotId,
    entries: rollbackEntries,
  })).slice(0, 24)}`;
  const rollback = RollbackRecordSchema.parse({
    id: rollbackId,
    proposalId: proposal.id,
    ...(validation ? { validationId: validation.id } : {}),
    snapshotRef,
    sourceRef: snapshotRef,
    reversible: true,
    entries: rollbackEntries,
    createdAt: timestamp,
  });
  return { snapshot, rollback, contentFiles };
}

function writeSnapshotArtifacts(
  root: string,
  artifacts: SnapshotArtifacts,
): SnapshotResult {
  const snapshotPath = snapshotFilePath(root, artifacts.snapshot);
  const rollbackPath = rollbackFilePath(root, artifacts.rollback);
  for (const contentFile of artifacts.contentFiles) {
    writeContentFile(contentFile.path, contentFile.content);
  }
  writeJsonFile(snapshotPath, artifacts.snapshot);
  writeJsonFile(rollbackPath, artifacts.rollback);
  return {
    command: 'snapshot',
    proposalId: artifacts.snapshot.proposalId,
    snapshotId: artifacts.snapshot.id,
    rollbackId: artifacts.rollback.id,
    snapshotPath,
    rollbackPath,
    snapshotRef: assetSnapshotRef(artifacts.snapshot.id),
    rollbackRef: rollbackRecordRef(artifacts.rollback),
    snapshot: artifacts.snapshot,
    rollback: artifacts.rollback,
  };
}

function latestRollbackBaselineEvent(
  events: readonly AssetEvent[],
  proposal: EvolutionProposal,
  change: ChangeOperation,
): AssetEvent | undefined {
  const baselineStatuses = new Set(['applied', 'rolled-back', 'archived']);
  return events
    .filter((event) => event.assetId === change.targetRef.id)
    .filter((event) => baselineStatuses.has(event.status))
    .filter((event) => event.proposalRef?.id !== proposal.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0];
}

function assetEventRef(event: AssetEvent): Ref {
  return {
    id: event.id,
    kind: 'asset-event',
    uri: `haro-sidecar://assets/events/${encodeURIComponent(event.id)}`,
  };
}

function assetSnapshotRef(snapshotId: string): Ref {
  return {
    id: snapshotId,
    kind: 'asset-snapshot',
    uri: `haro-sidecar://snapshots/${encodeURIComponent(snapshotId)}`,
  };
}

function rollbackRecordRef(record: RollbackRecord): Ref {
  return {
    id: record.id,
    kind: 'rollback-ref',
    uri: `haro-sidecar://rollbacks/${encodeURIComponent(record.id)}`,
  };
}

function createDryRunProposal(
  batches: readonly ObservationBatch[],
  now: () => Date,
  frontierSignals: readonly FrontierSignal[] = [],
): EvolutionProposal {
  const sourceObservationRefs = [
    ...batches.map(observationBatchRef),
    ...frontierSignals.map(frontierSignalRef),
  ];
  const summary = summarizeObservationBatches(batches);
  const frontierSummary = summarizeFrontierSignals(frontierSignals);
  const fingerprint = sha256(JSON.stringify({
    refs: sourceObservationRefs.map((ref) => ref.id).sort(),
    summary,
    frontierSummary,
  }));
  const proposalId = `proposal_${fingerprint.slice(0, 24)}`;
  const contentRef = `haro-sidecar://proposals/${proposalId}/dry-run`;
  const contentHash = sha256(JSON.stringify({ sourceObservationRefs, summary, frontierSummary, contentRef }));
  const timestamp = now().toISOString();
  return EvolutionProposalSchema.parse({
    id: proposalId,
    title: dryRunProposalTitle(batches.length, frontierSignals.length),
    status: 'dry-run',
    level: summary.runnerErrors > 0 ? 'L1' : 'L0',
    targetKind: summary.scheduledTaskErrors > 0 ? 'schedule-config' : summary.runnerErrors > 0 ? 'runner-profile' : 'mcp-tool-config',
    riskLevel: summary.runnerErrors > 0 || summary.scheduledTaskErrors > 0 ? 'medium' : 'low',
    sourceObservationRefs,
    changeSet: [
      {
        op: 'update',
        targetRef: proposalTargetRef(summary),
        contentRef,
        contentHash,
        summary: proposalSummary(summary, frontierSummary),
      },
    ],
    testPlan: {
      requiredCommands: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      manualChecks: [
        'AgentDock 人审通过前，这个自动提案不能被应用，也不能转换为真实分支。',
        frontierSignals.length > 0
          ? '通过 AgentDock workspace/agent 调用 Haro MCP workflow：先 `haro observe`，再 `haro propose --auto-dry-run --include-frontier --json`，并确认不会修改 runtime 代码。'
          : '通过 AgentDock workspace/agent 调用 Haro MCP workflow：先 `haro observe`，再 `haro propose --auto-dry-run --json`，并确认不会修改 runtime 代码。',
        ...(frontierSignals.length > 0
          ? ['信任外部证据前，必须复核引用的 frontier-signal source refs。']
          : []),
      ],
      regressionRisks: [
        'Observation schema 变化可能导致已持久化 batch 无法读取，需要 doctor/status 明确暴露损坏文件。',
        '如果 proposal lock 被绕过，并发 AgentDock workspace/agent Haro workflow 可能生成重复提案。',
        ...(frontierSignals.length > 0
          ? ['外部 frontier signals 可能过期或被新信息替代；已驳回/已被替代的信号不能继续作为有效证据。']
          : []),
      ],
    },
    rollbackPlan: {
      strategy:
        'dry-run 提案生成只会写入 proposal JSON artifact；在验证或审批前删除对应 proposal 文件即可回滚。',
      snapshotRequired: false,
      rollbackRefs: sourceObservationRefs,
    },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createAutoProposal(
  root: string,
  batches: readonly ObservationBatch[],
  now: () => Date,
  frontierSignals: readonly FrontierSignal[] = [],
): GeneratedProposal {
  const actionableRunnerProfileProposal = createActionableRunnerProfileProposal(root, batches, now);
  if (actionableRunnerProfileProposal) return actionableRunnerProfileProposal;
  const actionableScheduleConfigProposal = createActionableScheduleConfigProposal(root, batches, now);
  if (actionableScheduleConfigProposal) return actionableScheduleConfigProposal;
  const actionableMcpProposal = createActionableMcpToolConfigProposal(root, batches, now, frontierSignals);
  if (actionableMcpProposal) return actionableMcpProposal;
  return {
    proposal: createDryRunProposal(batches, now, frontierSignals),
    contentFiles: [],
  };
}

function createActionableRunnerProfileProposal(
  root: string,
  batches: readonly ObservationBatch[],
  now: () => Date,
): GeneratedProposal | undefined {
  const diagnostics = collectObservedErrorDiagnostics(batches);
  if (diagnostics.runnerErrors.length === 0) return undefined;

  const sourceObservationRefs = batches.map(observationBatchRef);
  const assetId = 'haro-sidecar:runner-profile:error-recovery-policy';
  const content = actionableRunnerProfileContent(assetId, diagnostics);
  const contentHash = sha256(content);
  const fingerprint = sha256(JSON.stringify({
    kind: 'actionable-runner-profile',
    assetId,
    sourceObservationRefs: sourceObservationRefs.map((ref) => ref.id).sort(),
    contentHash,
  }));
  const proposalId = `proposal_${fingerprint.slice(0, 24)}`;
  const fileName = proposalContentFileName(0, assetId, '.json');
  const contentRef = proposalContentRef(proposalId, fileName, assetId).uri!;
  const timestamp = now().toISOString();
  const runnerErrorCodes = uniqueSorted(diagnostics.runnerErrors.map(({ error }) => error.code));
  const scheduledTaskIds = uniqueSorted(diagnostics.scheduledTaskErrors.map(({ run }) => run.taskId));

  const proposal = EvolutionProposalSchema.parse({
    id: proposalId,
    title: '根据真实 runner 错误建立 Haro sidecar Runner Profile 恢复策略',
    status: 'proposed',
    level: 'L1',
    targetKind: 'runner-profile',
    riskLevel: 'medium',
    sourceObservationRefs,
    changeSet: [
      {
        op: 'update',
        targetRef: {
          id: assetId,
          kind: 'runner-profile',
          uri: `haro-sidecar://assets/current/runner-profile/${encodeURIComponent(assetId)}`,
        },
        contentRef,
        contentHash,
        summary: [
          `写入 Haro sidecar 自有 Runner Profile 恢复策略，基于真实 runner error code/message：${runnerErrorCodes.join(', ') || '无'}。`,
          scheduledTaskIds.length > 0
            ? `同时把失败定时任务作为上下文纳入策略：${scheduledTaskIds.join(', ')}。`
            : '',
          '该变更只落到 Haro sidecar assets/current/runner-profile，不修改 AgentDock 代码或 aria-memory-vault。',
        ].filter(Boolean).join(' '),
      },
    ],
    testPlan: {
      requiredCommands: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      manualChecks: [
        '在 Haro Web 审批页确认提案展示了真实 runner error code、message、recoverable 标记和 detailsRef。',
        '确认 proposal-content JSON 只写入 Haro sidecar 自有 assets/current/runner-profile 目标，不写 AgentDock 代码、AgentDock 配置或 aria-memory-vault。',
        '确认该策略只指导后续 Haro sidecar runner-profile 选择/降级/重试建议，不会绕过人审直接修改运行时。',
      ],
      regressionRisks: [
        '如果错误聚合过宽，可能把不同根因合并到同一个 runner-profile 策略，需要审批人核对 code/message 样本。',
        '如果 AgentDock observation schema 变化导致 runnerErrors 缺少 message，提案必须退回 dry-run 或 blocked，而不是生成无证据策略。',
      ],
    },
    rollbackPlan: {
      strategy:
        '该提案只写 Haro sidecar 自有 runner-profile asset；如审批后应用，可通过 Haro rollback 恢复旧版本或删除该 current asset。',
      snapshotRequired: false,
      rollbackRefs: [],
    },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    proposal,
    contentFiles: [
      {
        path: join(proposalContentDir(root, proposalId), fileName),
        content: Buffer.from(content, 'utf8'),
      },
    ],
  };
}

function createActionableScheduleConfigProposal(
  root: string,
  batches: readonly ObservationBatch[],
  now: () => Date,
): GeneratedProposal | undefined {
  const diagnostics = collectObservedErrorDiagnostics(batches);
  if (diagnostics.scheduledTaskErrors.length === 0) return undefined;

  const sourceObservationRefs = batches.map(observationBatchRef);
  const assetId = 'haro-sidecar:schedule-config:error-review-policy';
  const content = actionableScheduleConfigContent(assetId, diagnostics);
  const contentHash = sha256(content);
  const fingerprint = sha256(JSON.stringify({
    kind: 'actionable-schedule-config',
    assetId,
    sourceObservationRefs: sourceObservationRefs.map((ref) => ref.id).sort(),
    contentHash,
  }));
  const proposalId = `proposal_${fingerprint.slice(0, 24)}`;
  const fileName = proposalContentFileName(0, assetId, '.json');
  const contentRef = proposalContentRef(proposalId, fileName, assetId).uri!;
  const timestamp = now().toISOString();
  const scheduledTaskIds = uniqueSorted(diagnostics.scheduledTaskErrors.map(({ run }) => run.taskId));

  const proposal = EvolutionProposalSchema.parse({
    id: proposalId,
    title: '根据失败定时任务建立 Haro sidecar 调度错误复核策略',
    status: 'proposed',
    level: 'L1',
    targetKind: 'schedule-config',
    riskLevel: 'medium',
    sourceObservationRefs,
    changeSet: [
      {
        op: 'update',
        targetRef: {
          id: assetId,
          kind: 'schedule-config',
          uri: `haro-sidecar://assets/current/schedule-config/${encodeURIComponent(assetId)}`,
        },
        contentRef,
        contentHash,
        summary: [
          `写入 Haro sidecar 自有 schedule-config 错误复核策略，覆盖失败任务：${scheduledTaskIds.join(', ') || '未知任务'}。`,
          '该雏形只约束 Haro sidecar 如何把 scheduledTaskErrors 转换为人审提案，不接管 AgentDock scheduler。',
        ].join(' '),
      },
    ],
    testPlan: {
      requiredCommands: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      manualChecks: [
        '在 Haro Web 审批页确认提案展示了失败 taskId、executionType、resultRef 和 startedAt。',
        '确认 proposal-content JSON 只写入 Haro sidecar 自有 assets/current/schedule-config 目标，不修改 AgentDock scheduler、任务定义或系统服务。',
        '确认策略不会自动 disable/trigger/retry 任何 AgentDock task；所有执行性变更仍需单独人审。',
      ],
      regressionRisks: [
        '如果 AgentDock task resultRef 无法展开，审批人只能看到失败任务摘要，不能据此批准实际调度变更。',
        '如果把 Haro sidecar 策略误认为 AgentDock scheduler 配置，可能越过 sidecar-only 边界；审批时必须核对 target URI。',
      ],
    },
    rollbackPlan: {
      strategy:
        '该提案只写 Haro sidecar 自有 schedule-config asset；如审批后应用，可通过 Haro rollback 恢复旧版本或删除该 current asset。',
      snapshotRequired: false,
      rollbackRefs: [],
    },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    proposal,
    contentFiles: [
      {
        path: join(proposalContentDir(root, proposalId), fileName),
        content: Buffer.from(content, 'utf8'),
      },
    ],
  };
}

function collectObservedErrorDiagnostics(batches: readonly ObservationBatch[]): {
  runnerErrors: Array<{ batch: ObservationBatch; error: ObservationBatch['runnerErrors'][number] }>;
  scheduledTaskErrors: Array<{ batch: ObservationBatch; run: ObservationBatch['scheduledTaskRuns'][number] }>;
} {
  const productionBatches = batches.filter((batch) => batch.source === 'agentdock-http');
  return {
    runnerErrors: productionBatches.flatMap((batch) =>
      batch.runnerErrors.map((error) => ({ batch, error })),
    ),
    scheduledTaskErrors: productionBatches.flatMap((batch) =>
      batch.scheduledTaskRuns
        .filter((run) => run.status === 'error')
        .map((run) => ({ batch, run })),
    ),
  };
}

function actionableRunnerProfileContent(
  assetId: string,
  diagnostics: ReturnType<typeof collectObservedErrorDiagnostics>,
): string {
  const runnerErrorClasses = summarizeRunnerErrorClasses(diagnostics.runnerErrors);
  const scheduledTaskContexts = summarizeScheduledTaskErrors(diagnostics.scheduledTaskErrors);
  const payload = {
    id: assetId,
    kind: 'runner-profile',
    version: 1,
    language: 'zh-CN',
    owner: 'haro-sidecar',
    purpose:
      '根据 AgentDock observation 中真实 runner error code/message，建立 Haro sidecar 自有 runner-profile 恢复策略；该策略只影响 Haro sidecar 后续提案如何解释和处理 runner 错误。',
    sidecarBoundary: {
      scope:
        '仅写入 Haro sidecar assets/current/runner-profile；不得修改 AgentDock 代码、AgentDock scheduler、AgentDock workspace runtime 或 aria-memory-vault。',
      applyMode: 'human-reviewed-gated-apply-only',
    },
    observedRunnerErrorClasses: runnerErrorClasses,
    scheduledTaskContext: scheduledTaskContexts,
    policy: {
      defaultHandling: [
        '进入审批前必须保留原始 code、message、recoverable 和 detailsRef 作为证据。',
        'recoverable=true 的错误只能建议 bounded retry/backoff 或更保守的 runner profile，不能自动重放用户任务。',
        'recoverable=false 的错误必须要求人工复核，不能自动降级或自动 apply。',
        '如果同一 code/message 已有 pending 或 decided approval request，后续相同 contentHash 不能重复打扰审批人。',
      ],
      profilePatch: {
        evidenceRequired: ['code', 'message', 'recoverable', 'occurredAt'],
        proposedControls: [
          '为可恢复 runner 错误保留 bounded retry 建议字段。',
          '为 timeout/fetch failed 类错误保留 runner health check 和短退避建议字段。',
          '为非可恢复错误保留 request-changes/人工复核建议字段。',
        ],
      },
      tests: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      rollback:
        '删除或回滚 assets/current/runner-profile 下该 asset 即可撤销；不得触碰 AgentDock runtime。',
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function actionableScheduleConfigContent(
  assetId: string,
  diagnostics: ReturnType<typeof collectObservedErrorDiagnostics>,
): string {
  const scheduledTaskErrors = summarizeScheduledTaskErrors(diagnostics.scheduledTaskErrors);
  const payload = {
    id: assetId,
    kind: 'schedule-config',
    version: 1,
    language: 'zh-CN',
    owner: 'haro-sidecar',
    purpose:
      '根据 AgentDock observation 中真实 scheduledTaskErrors，建立 Haro sidecar 自有调度错误复核策略；该策略只描述 Haro 如何把失败定时任务转换为人审提案。',
    sidecarBoundary: {
      scope:
        '仅写入 Haro sidecar assets/current/schedule-config；不得修改 AgentDock scheduler、任务定义、systemd service、AgentDock 代码或 aria-memory-vault。',
      applyMode: 'human-reviewed-gated-apply-only',
    },
    observedScheduledTaskErrors: scheduledTaskErrors,
    policy: {
      defaultHandling: [
        '记录失败 taskId、executionType、status、startedAt 和 resultRef。',
        '如果只有 task failure 摘要而没有可审查 resultRef，提案必须要求人工补充证据或 request-changes。',
        '不得自动 disable、trigger、retry 或改写任何 AgentDock task；执行性调度变更必须另起提案并人审。',
        '相同 taskId/resultRef 生成相同 contentHash 时，approval-request 去重必须阻止重复打扰审批人。',
      ],
      proposalRequirements: [
        '说明为什么该 task failure 需要 sidecar 策略而不是 AgentDock 代码改动。',
        '说明策略如何保持 Haro daily workflow 只经 MCP 运行，不绕过 AgentDock。',
        '列出 rollback plan：删除或回滚 Haro sidecar schedule-config asset。',
      ],
      tests: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      rollback:
        '删除或回滚 assets/current/schedule-config 下该 asset 即可撤销；不得触碰 AgentDock scheduler。',
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function summarizeRunnerErrorClasses(
  items: ReadonlyArray<{ batch: ObservationBatch; error: ObservationBatch['runnerErrors'][number] }>,
): Array<{
  code: string;
  messages: string[];
  recoverableValues: boolean[];
  runnerIds: string[];
  detailsRefs: string[];
}> {
  const byCode = new Map<string, {
    messages: Set<string>;
    recoverableValues: Set<boolean>;
    runnerIds: Set<string>;
    detailsRefs: Set<string>;
  }>();
  for (const { error } of items) {
    const entry = byCode.get(error.code) ?? {
      messages: new Set<string>(),
      recoverableValues: new Set<boolean>(),
      runnerIds: new Set<string>(),
      detailsRefs: new Set<string>(),
    };
    entry.messages.add(normalizeEvidenceText(error.message));
    entry.recoverableValues.add(error.recoverable);
    if (error.runnerId) entry.runnerIds.add(error.runnerId);
    if (error.detailsRef) entry.detailsRefs.add(error.detailsRef);
    byCode.set(error.code, entry);
  }
  return Array.from(byCode.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, entry]) => ({
      code,
      messages: uniqueSorted(Array.from(entry.messages)),
      recoverableValues: Array.from(entry.recoverableValues).sort((a, b) => Number(a) - Number(b)),
      runnerIds: uniqueSorted(Array.from(entry.runnerIds)),
      detailsRefs: uniqueSorted(Array.from(entry.detailsRefs)),
    }));
}

function summarizeScheduledTaskErrors(
  items: ReadonlyArray<{ batch: ObservationBatch; run: ObservationBatch['scheduledTaskRuns'][number] }>,
): Array<{
  taskId: string;
  executionTypes: string[];
  messages: string[];
  resultRefs: string[];
}> {
  const byTask = new Map<string, {
    executionTypes: Set<string>;
    messages: Set<string>;
    resultRefs: Set<string>;
  }>();
  for (const { run } of items) {
    const entry = byTask.get(run.taskId) ?? {
      executionTypes: new Set<string>(),
      messages: new Set<string>(),
      resultRefs: new Set<string>(),
    };
    entry.executionTypes.add(run.executionType);
    entry.messages.add(normalizeEvidenceText(
      run.resultRef
        ? `scheduled task ${run.taskId} returned status=error; resultRef=${run.resultRef}`
        : `scheduled task ${run.taskId} returned status=error`,
    ));
    if (run.resultRef) entry.resultRefs.add(run.resultRef);
    byTask.set(run.taskId, entry);
  }
  return Array.from(byTask.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([taskId, entry]) => ({
      taskId,
      executionTypes: uniqueSorted(Array.from(entry.executionTypes)),
      messages: uniqueSorted(Array.from(entry.messages)),
      resultRefs: uniqueSorted(Array.from(entry.resultRefs)),
    }));
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort();
}

function createActionableMcpToolConfigProposal(
  root: string,
  batches: readonly ObservationBatch[],
  now: () => Date,
  frontierSignals: readonly FrontierSignal[],
): GeneratedProposal | undefined {
  const signals = selectMcpToolAuditSignals(frontierSignals);
  if (signals.length === 0) return undefined;

  const sourceObservationRefs = [
    ...batches.map(observationBatchRef),
    ...signals.map(frontierSignalRef),
  ];
  const assetId = 'agentdock:haro-sidecar-mcp-audit-policy';
  const content = actionableMcpToolConfigContent(assetId, signals);
  const contentHash = sha256(content);
  const fingerprint = sha256(JSON.stringify({
    kind: 'actionable-mcp-tool-config',
    assetId,
    signalIds: signals.map((signal) => signal.id).sort(),
    contentHash,
  }));
  const proposalId = `proposal_${fingerprint.slice(0, 24)}`;
  const fileName = proposalContentFileName(0, assetId, '.json');
  const contentRef = proposalContentRef(proposalId, fileName, assetId).uri!;
  const timestamp = now().toISOString();

  const proposal = EvolutionProposalSchema.parse({
    id: proposalId,
    title: '建立 Haro sidecar MCP 工具配置审计策略',
    status: 'proposed',
    level: 'L0',
    targetKind: 'mcp-tool-config',
    riskLevel: 'low',
    sourceObservationRefs,
    changeSet: [
      {
        op: 'update',
        targetRef: {
          id: assetId,
          kind: 'mcp-tool-config',
          uri: 'haro-sidecar://assets/current/mcp-tool-config/agentdock:haro-sidecar-mcp-audit-policy',
        },
        contentRef,
        contentHash,
        summary:
          '写入 Haro sidecar MCP 工具配置审计策略：审批前必须展示 MCP server、默认工具、gated-write 工具、调度入口和网络/执行边界，防止自动提案在缺少具体工具配置证据时进入人审。',
      },
    ],
    testPlan: {
      requiredCommands: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      manualChecks: [
        '在 Haro Web 审批页确认本提案展示了为什么改、怎么改、收益、风险和回滚方案。',
        '确认 proposal-content JSON 只写入 Haro sidecar 自有 assets/current/mcp-tool-config 目标，不写 AgentDock 代码、AgentDock 配置或 aria-memory-vault。',
        '确认 `haro_apply` / `haro_rollback` 仍只在显式 gated-write 启用且人审通过后可用。',
      ],
      regressionRisks: [
        '过严的 MCP 工具配置审计策略可能导致低价值但无害的 sidecar 配置提案无法进入审批。',
        '如果上游 AgentDock MCP 注册结构变化，该 sidecar-local 配置需要同步扩展字段，而不是直接改 AgentDock 代码。',
      ],
    },
    rollbackPlan: {
      strategy:
        '该提案只写 Haro sidecar 自有 mcp-tool-config asset；如审批后应用，可通过 Haro rollback 恢复旧版本或删除该 current asset。',
      snapshotRequired: false,
      rollbackRefs: [],
    },
    humanReviewRequired: true,
    humanApprovalRefs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    proposal,
    contentFiles: [
      {
        path: join(proposalContentDir(root, proposalId), fileName),
        content: Buffer.from(content, 'utf8'),
      },
    ],
  };
}

function selectMcpToolAuditSignals(signals: readonly FrontierSignal[]): FrontierSignal[] {
  return signals.filter((signal) => {
    if (signal.status !== 'active') return false;
    if (!signal.targetDomains.includes('mcp-tools') && !signal.targetDomains.includes('haro-sidecar')) {
      return false;
    }
    const haystack = [
      signal.id,
      signal.title,
      signal.summary,
      signal.sourceRef.id,
      signal.sourceRef.kind,
      signal.sourceRef.uri ?? '',
      signal.rawRef?.uri ?? '',
      ...signal.claims,
    ].join(' ').toLowerCase();
    return /audit|审计|cloud agent configuration|enabled tools|firewall configuration|actions workflow policy|rest api/.test(haystack);
  });
}

function actionableMcpToolConfigContent(assetId: string, signals: readonly FrontierSignal[]): string {
  const payload = {
    id: assetId,
    kind: 'mcp-tool-config',
    version: 1,
    language: 'zh-CN',
    owner: 'haro-sidecar',
    purpose:
      '为 Haro sidecar 自动提案建立 MCP 工具配置审计策略，确保进入人审前能说明工具暴露、权限边界、调度入口和回滚方式。',
    sourceSignals: signals.map((signal) => ({
      id: signal.id,
      title: signal.title,
      sourceType: signal.sourceType,
      sourceRef: signal.sourceRef,
      publishedAt: signal.publishedAt,
      confidence: signal.confidence,
    })),
    policy: {
      scope:
        '仅约束 Haro sidecar 自有 MCP 工具配置资产；不得直接修改 AgentDock 代码、AgentDock 运行时配置或 aria-memory-vault。',
      defaultTools: [
        'haro_observe',
        'haro_propose',
        'haro_validate',
        'haro_asset_query',
        'haro_run_daily_workflow',
      ],
      gatedWriteTools: ['haro_apply', 'haro_rollback'],
      approvalRequirements: [
        '自动提案必须包含具体 proposal-content 和 contentHash。',
        '审批请求必须展示 why/how/expected benefits/risks/rollback plan。',
        'gated-write 工具必须保持默认关闭；只有显式启用且人审通过后才能进入 apply/rollback。',
        '如果 frontier signal 只提供泛化趋势，proposer 必须输出 blocked dry-run，而不是生成审批请求。',
      ],
      auditChecklist: [
        '列出 Haro MCP server 暴露的默认工具和 gated-write 工具。',
        '确认每个 gated-write 工具只能接受 proposal/application id，不接受自由文本 patch。',
        '确认 daily workflow 只写 Haro sidecar artifacts，不写 AgentDock memory 或 aria-memory-vault。',
        '确认 proposal-content 落在 $HARO_HOME/evolution/proposal-content/<proposal-id>/，apply 目标只在 $HARO_HOME/assets/current/ allowlist 内。',
      ],
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function createValidationReport(
  root: string,
  proposal: EvolutionProposal,
  now: () => Date,
): ValidationReport {
  const rollbackReady = !proposal.rollbackPlan.snapshotRequired || proposal.rollbackPlan.rollbackRefs.length > 0;
  const blockingReasons = validationBlockingReasons(root, proposal, rollbackReady);
  const riskVerdict = blockingReasons.length > 0
    ? 'blocked'
    : proposal.riskLevel;
  const applyEligible = proposal.level !== 'L2' &&
    proposal.level !== 'L3' &&
    rollbackReady &&
    blockingReasons.length === 0 &&
    riskVerdict !== 'blocked';
  const evidenceRefs: Ref[] = [
    {
      id: proposal.id,
      kind: 'evolution-proposal',
      uri: `haro-sidecar://proposals/${encodeURIComponent(proposal.id)}`,
    },
    ...proposal.sourceObservationRefs,
  ];
  const fingerprint = sha256(JSON.stringify({
    proposalId: proposal.id,
    proposalUpdatedAt: proposal.updatedAt,
    riskVerdict,
    rollbackReady,
    blockingReasons,
    requiredTests: proposal.testPlan.requiredCommands,
    humanReviewRequired: proposal.humanReviewRequired,
    humanApprovalRefs: proposal.humanApprovalRefs,
  }));
  return ValidationReportSchema.parse({
    id: `validation_${fingerprint.slice(0, 24)}`,
    proposalId: proposal.id,
    riskVerdict,
    requiredTests: proposal.testPlan.requiredCommands,
    rollbackReady,
    applyEligible,
    blockingReasons,
    evidenceRefs,
    createdAt: now().toISOString(),
  });
}

function markProposalValidated(root: string, proposal: EvolutionProposal, updatedAt: string): EvolutionProposal {
  if (proposal.status === 'validated') return proposal;
  const next = EvolutionProposalSchema.parse({
    ...proposal,
    status: 'validated',
    updatedAt,
  });
  writeJsonFile(proposalFilePath(root, next), next);
  return next;
}

function recordProposalAssetEvents(root: string, proposal: EvolutionProposal): AssetEvent[] {
  return recordAssetEvents(root, proposal, 'proposed');
}

function recordValidationAssetEvents(
  root: string,
  proposal: EvolutionProposal,
  validation: ValidationReport,
): AssetEvent[] {
  return recordAssetEvents(root, proposal, 'validated', validation);
}

function recordAppliedAssetEvents(
  root: string,
  proposal: EvolutionProposal,
  validation: ValidationReport,
  applicationId: string,
  changes: readonly ProposedAssetContent[],
  snapshotRef: Ref,
  rollbackRef: Ref,
  createdAt: string,
): AssetEvent[] {
  const registry = createSidecarAssetRegistry(root);
  const events = changes.map((change) => AssetEventSchema.parse({
    id: appliedAssetEventId({ proposal, validation, applicationId, change }),
    assetId: change.assetId,
    kind: change.kind,
    version: change.contentHash.slice(0, 16),
    sourceRef: applicationRecordRef(applicationId),
    contentRef: change.targetContentRef,
    contentHash: change.contentHash,
    status: 'applied',
    eventType: 'applied',
    actor: 'haro',
    proposalRef: evolutionProposalRef(proposal),
    validationRef: validationReportRef(validation),
    rollbackMetadata: {
      rollbackRef,
      snapshotRef,
      reversible: true,
    },
    createdAt,
  }));
  for (const event of events) {
    registry.recordEvent(event);
  }
  return events;
}

function recordRolledBackAssetEvents(
  root: string,
  application: ApplicationRecord,
  rollback: RollbackRecord,
  changes: readonly RollbackAssetContent[],
  createdAt: string,
): AssetEvent[] {
  const registry = createSidecarAssetRegistry(root);
  const events = changes.map((change) => AssetEventSchema.parse({
    id: rolledBackAssetEventId({ application, rollback, change }),
    assetId: change.assetId,
    kind: change.kind,
    version: change.version,
    sourceRef: applicationRecordRef(application.id),
    contentRef: change.targetContentRef,
    contentHash: change.contentHash,
    status: 'rolled-back',
    eventType: 'rolled-back',
    actor: 'haro',
    proposalRef: {
      id: application.proposalId,
      kind: 'evolution-proposal',
      uri: `haro-sidecar://proposals/${encodeURIComponent(application.proposalId)}`,
    },
    validationRef: {
      id: application.validationId,
      kind: 'validation-report',
      uri: `haro-sidecar://validations/${encodeURIComponent(application.validationId)}`,
    },
    rollbackMetadata: {
      rollbackRef: rollbackRecordRef(rollback),
      snapshotRef: rollback.snapshotRef,
      reversible: rollback.reversible,
    },
    createdAt,
  }));
  for (const event of events) {
    registry.recordEvent(event);
  }
  return events;
}

function recordAssetEvents(
  root: string,
  proposal: EvolutionProposal,
  status: 'proposed' | 'validated',
  validation?: ValidationReport,
): AssetEvent[] {
  const registry = createSidecarAssetRegistry(root);
  const events = proposal.changeSet
    .map((change, index) => createAssetEventForChange(proposal, change, index, status, validation))
    .filter((event): event is AssetEvent => Boolean(event));
  for (const event of events) {
    registry.recordEvent(event);
  }
  return events;
}

function createAssetEventForChange(
  proposal: EvolutionProposal,
  change: ChangeOperation,
  index: number,
  status: 'proposed' | 'validated',
  validation?: ValidationReport,
): AssetEvent | undefined {
  const kind = assetKindForChange(proposal, change);
  if (!kind) return undefined;
  const contentRefValue = change.contentRef ?? `haro-sidecar://proposals/${encodeURIComponent(proposal.id)}/changes/${index}`;
  const contentHash = change.contentHash ?? sha256(JSON.stringify({
    proposalId: proposal.id,
    change,
  }));
  const validationRef = validation ? validationReportRef(validation) : undefined;
  return AssetEventSchema.parse({
    id: assetEventId({ proposal, change, index, status, contentHash, validation }),
    assetId: change.targetRef.id,
    kind,
    version: contentHash.slice(0, 16),
    sourceRef: validationRef ?? evolutionProposalRef(proposal),
    contentRef: stringToRef(contentRefValue, `${kind}-content`),
    contentHash,
    status,
    eventType: status,
    actor: 'haro',
    proposalRef: evolutionProposalRef(proposal),
    ...(validationRef ? { validationRef } : {}),
    createdAt: validation?.createdAt ?? proposal.createdAt,
  });
}

function assetKindForChange(
  proposal: EvolutionProposal,
  change: ChangeOperation,
): AssetKind | undefined {
  const targetRefKind = AssetKindSchema.safeParse(change.targetRef.kind);
  if (targetRefKind.success) return targetRefKind.data;
  const proposalKind = AssetKindSchema.safeParse(proposal.targetKind);
  if (proposalKind.success) return proposalKind.data;
  return undefined;
}

function assetEventId(input: {
  proposal: EvolutionProposal;
  change: ChangeOperation;
  index: number;
  status: 'proposed' | 'validated';
  contentHash: string;
  validation?: ValidationReport;
}): string {
  return `asset_event_${sha256(JSON.stringify({
    proposalId: input.proposal.id,
    validationId: input.validation?.id,
    changeIndex: input.index,
    assetId: input.change.targetRef.id,
    status: input.status,
    contentHash: input.contentHash,
  })).slice(0, 24)}`;
}

function appliedAssetEventId(input: {
  proposal: EvolutionProposal;
  validation: ValidationReport;
  applicationId: string;
  change: ProposedAssetContent;
}): string {
  return `asset_event_${sha256(JSON.stringify({
    proposalId: input.proposal.id,
    validationId: input.validation.id,
    applicationId: input.applicationId,
    changeIndex: input.change.changeIndex,
    assetId: input.change.assetId,
    status: 'applied',
    contentHash: input.change.contentHash,
  })).slice(0, 24)}`;
}

function rolledBackAssetEventId(input: {
  application: ApplicationRecord;
  rollback: RollbackRecord;
  change: RollbackAssetContent;
}): string {
  return `asset_event_${sha256(JSON.stringify({
    proposalId: input.application.proposalId,
    validationId: input.application.validationId,
    applicationId: input.application.id,
    rollbackId: input.rollback.id,
    changeIndex: input.change.changeIndex,
    assetId: input.change.assetId,
    status: 'rolled-back',
    action: input.change.action,
    contentHash: input.change.contentHash,
  })).slice(0, 24)}`;
}

function evolutionProposalRef(proposal: EvolutionProposal): Ref {
  return {
    id: proposal.id,
    kind: 'evolution-proposal',
    uri: `haro-sidecar://proposals/${encodeURIComponent(proposal.id)}`,
  };
}

function validationReportRef(report: ValidationReport): Ref {
  return {
    id: report.id,
    kind: 'validation-report',
    uri: `haro-sidecar://validations/${encodeURIComponent(report.id)}`,
  };
}

function proposalChangeRef(proposal: EvolutionProposal, index: number): Ref {
  return {
    id: `${proposal.id}:change:${index}`,
    kind: 'proposal-change',
    uri: `haro-sidecar://proposals/${encodeURIComponent(proposal.id)}/changes/${index}`,
  };
}

function approvalDecisionApprovalRef(decision: ApprovalDecisionRecord): Ref {
  return {
    id: decision.id,
    kind: 'human-approval',
    uri: `haro-sidecar://approval-decisions/${encodeURIComponent(decision.id)}`,
  };
}

function syncProposalWithLatestApprovalDecision(
  root: string,
  proposal: EvolutionProposal,
): { proposal: EvolutionProposal; decision?: ApprovalDecisionRecord } {
  const { decision } = readLatestApprovalDecisionForProposal(root, proposal.id);
  if (!decision) return { proposal };

  let next = proposal;
  let changed = false;
  if (decision.decision === 'approve') {
    const approvalRef = decision.approvalRef ?? approvalDecisionApprovalRef(decision);
    if (!next.humanApprovalRefs.some((ref) => ref.id === approvalRef.id && ref.kind === approvalRef.kind)) {
      next = {
        ...next,
        humanApprovalRefs: [...next.humanApprovalRefs, approvalRef],
        updatedAt: decision.createdAt,
      };
      changed = true;
    }
  } else if (decision.decision === 'reject') {
    if (next.status !== 'rejected') {
      next = { ...next, status: 'rejected', updatedAt: decision.createdAt };
      changed = true;
    }
  } else if (decision.decision === 'request-changes') {
    if (next.status !== 'superseded') {
      next = { ...next, status: 'superseded', updatedAt: decision.createdAt };
      changed = true;
    }
  }

  if (changed) {
    writeJsonFile(proposalFilePath(root, next), next);
  }
  return { proposal: next, decision };
}

function stringToRef(value: string, kind: string): Ref {
  const ref: Ref = { id: value, kind };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    ref.uri = value;
  }
  return ref;
}

function validationBlockingReasons(root: string, proposal: EvolutionProposal, rollbackReady: boolean): string[] {
  const reasons = proposalExecutionReadinessBlockingReasons(root, proposal);
  if (!rollbackReady) {
    reasons.push('回滚方案需要快照（snapshot）或回滚引用（rollback refs）后，才允许进入应用判断。');
  }
  if (proposal.riskLevel === 'high') {
    reasons.push('高风险提案进入任何应用门禁（apply gate）前都必须人工复核。');
  }
  return reasons;
}

function proposalExecutionReadinessBlockingReasons(root: string, proposal: EvolutionProposal): string[] {
  const reasons: string[] = [];
  if (isGenericDryRunProposal(proposal)) {
    reasons.push('提案仍是泛化 dry-run 演练：缺少具体 proposed content / patch，不能进入审批。');
  }
  if (proposal.level === 'L0' || proposal.level === 'L1') {
    const prepared = prepareSidecarLocalApply(root, proposal);
    if (!prepared.ok) reasons.push(...prepared.blockingReasons);
  }
  return Array.from(new Set(reasons));
}

function isGenericDryRunProposal(proposal: EvolutionProposal): boolean {
  if (proposal.status === 'dry-run') return true;
  return proposal.changeSet.some((change) => (
    change.contentRef?.includes('/dry-run') ||
    /仅演练|复核已持久化的 AgentDock sidecar 观察数据/.test(change.summary)
  ));
}

function approvalRequestReadinessBlockingReasons(
  root: string,
  proposal: EvolutionProposal,
  validation: ValidationReport,
): string[] {
  const reasons: string[] = [];
  if (proposal.status !== 'validated') {
    reasons.push(`提案状态为 ${proposal.status}；只有已验证（validated）的具体提案才能进入审批。`);
  }
  if (validation.riskVerdict === 'blocked') {
    reasons.push('验证结论为 blocked，不能进入审批。');
  }
  if (!validation.rollbackReady) {
    reasons.push('验证报告 rollbackReady=false，不能进入审批。');
  }
  if ((proposal.level === 'L0' || proposal.level === 'L1') && !validation.applyEligible) {
    reasons.push('L0/L1 提案缺少可执行内容或未通过应用前质量门槛，不能进入审批。');
  }
  reasons.push(...proposalExecutionReadinessBlockingReasons(root, proposal));
  return Array.from(new Set(reasons));
}

function missingHumanApproval(proposal: EvolutionProposal): boolean {
  return proposal.humanApprovalRefs.length === 0;
}

function observationBatchRef(batch: ObservationBatch): Ref {
  return {
    id: batch.id,
    kind: 'observation-batch',
    uri: `haro-sidecar://observations/${encodeURIComponent(batch.id)}`,
  };
}

function frontierSignalRef(signal: FrontierSignal): Ref {
  return {
    id: signal.id,
    kind: 'frontier-signal',
    uri: `haro-sidecar://frontier-signals/${encodeURIComponent(signal.id)}`,
  };
}

function summarizeObservationBatches(batches: readonly ObservationBatch[]) {
  return {
    batches: batches.length,
    sessions: batches.reduce((sum, batch) => sum + batch.sessions.length, 0),
    turns: batches.reduce((sum, batch) => sum + batch.turns.length, 0),
    toolCalls: batches.reduce((sum, batch) => sum + batch.toolCalls.length, 0),
    scheduledTaskRuns: batches.reduce((sum, batch) => sum + batch.scheduledTaskRuns.length, 0),
    scheduledTaskErrors: batches.reduce(
      (sum, batch) => sum + batch.scheduledTaskRuns.filter((item) => item.status === 'error').length,
      0,
    ),
    memoryMaintenanceLogs: batches.reduce((sum, batch) => sum + batch.memoryMaintenanceLogs.length, 0),
    runnerErrors: batches.reduce((sum, batch) => sum + batch.runnerErrors.length, 0),
    usageRecords: batches.reduce((sum, batch) => sum + batch.usageRecords.length, 0),
  };
}

function summarizeFrontierSignals(signals: readonly FrontierSignal[]) {
  const domains = Array.from(new Set(signals.flatMap((signal) => signal.targetDomains))).sort();
  const sourceTypes = Array.from(new Set(signals.map((signal) => signal.sourceType))).sort();
  return {
    frontierSignals: signals.length,
    sourceTypes,
    targetDomains: domains,
    highConfidence: signals.filter((signal) => signal.confidence === 'high').length,
    mediumConfidence: signals.filter((signal) => signal.confidence === 'medium').length,
    lowConfidence: signals.filter((signal) => signal.confidence === 'low').length,
  };
}

function dryRunProposalTitle(observationBatchCount: number, frontierSignalCount: number): string {
  if (frontierSignalCount === 0) {
    return `基于 ${observationBatchCount} 个 AgentDock 观察批次的 Haro 自进化演练提案（dry-run）`;
  }
  return `基于 ${observationBatchCount} 个 AgentDock 观察批次和 ${frontierSignalCount} 条前沿信号的 Haro 自进化演练提案（dry-run）`;
}

function proposalTargetRef(summary: ReturnType<typeof summarizeObservationBatches>): Ref {
  if (summary.scheduledTaskErrors > 0) {
    return {
      id: 'agentdock:haro-sidecar-schedule',
      kind: 'schedule-config',
      uri: 'agentdock://tasks/haro-sidecar',
    };
  }
  if (summary.runnerErrors > 0) {
    return {
      id: 'agentdock:runner-profile',
      kind: 'runner-profile',
      uri: 'agentdock://runner-profiles/default',
    };
  }
  return {
    id: 'agentdock:haro-sidecar-registration',
    kind: 'mcp-tool-config',
    uri: 'agentdock://mcp-servers/haro',
  };
}

function proposalSummary(
  summary: ReturnType<typeof summarizeObservationBatches>,
  frontierSummary?: ReturnType<typeof summarizeFrontierSignals>,
): string {
  return [
    '复核已持久化的 AgentDock sidecar 观察数据，并生成一个仅演练（dry-run）的自优化提案。',
    `观察批次=${summary.batches}，会话=${summary.sessions}，轮次=${summary.turns}，工具调用=${summary.toolCalls}，定时任务运行=${summary.scheduledTaskRuns}，定时任务错误=${summary.scheduledTaskErrors}，runner 错误=${summary.runnerErrors}，用量记录=${summary.usageRecords}。`,
    frontierSummary && frontierSummary.frontierSignals > 0
      ? `前沿信号=${frontierSummary.frontierSignals}，来源类型=${frontierSummary.sourceTypes.join('|') || '无'}，目标域=${frontierSummary.targetDomains.join('|') || '无'}。`
      : '',
  ].filter(Boolean).join(' ');
}

function frontierSignalSourceKey(signal: FrontierSignal): string {
  return JSON.stringify({
    sourceType: signal.sourceType,
    sourceRef: {
      id: signal.sourceRef.id,
      kind: signal.sourceRef.kind,
      uri: signal.sourceRef.uri ?? '',
    },
  });
}

function frontierSignalTimestamp(signal: FrontierSignal): string {
  return signal.publishedAt ?? signal.collectedAt;
}

function frontierSignalIsAfter(signal: FrontierSignal, since: string): boolean {
  return Date.parse(frontierSignalTimestamp(signal)) > Date.parse(since);
}

function nextFrontierCursor(signals: readonly FrontierSignal[], previous: string | undefined): string | undefined {
  let cursor = previous;
  for (const signal of signals) {
    const timestamp = frontierSignalTimestamp(signal);
    if (!cursor || Date.parse(timestamp) > Date.parse(cursor)) {
      cursor = timestamp;
    }
  }
  return cursor;
}

function assertOptionalIsoDateTime(value: string | undefined, label: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new CommanderExit(2, `${label} must be last|none|ISO timestamp`);
  }
}

function encodedConnectionId(connectionId: string): string {
  return Buffer.from(connectionId, 'utf8').toString('base64url');
}

function encodedAssetPathSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countSemanticObservations(batch: ObservationBatch): number {
  return batch.sessions.length +
    batch.turns.length +
    batch.toolCalls.length +
    batch.scheduledTaskRuns.length +
    batch.memoryMaintenanceLogs.length +
    batch.runnerErrors.length +
    batch.usageRecords.length;
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
