import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  ApplicationRecordSchema,
  AssetSnapshotRecordSchema,
  AssetKindSchema,
  AssetEventSchema,
  EvolutionProposalSchema,
  FrontierSignalSchema,
  ObservationBatchSchema,
  RollbackRecordSchema,
  ValidationReportSchema,
  createFakeAgentDockSource,
  createHttpAgentDockSource,
  type ApplicationRecord,
  type ApplyGateCode,
  type AssetSnapshotRecord,
  type AssetEvent,
  type AssetKind,
  type ChangeOperation,
  type EvolutionProposal,
  type FrontierSignal,
  type ObservationBatch,
  type Ref,
  type RollbackRecord,
  type SnapshotSource,
  type ValidationReport,
} from '@haro/agentdock-contract';
import { createSidecarAssetRegistry } from '@haro/mcp-tools';
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

interface SnapshotOptions extends OutputFlags {
  proposalId: string;
}

interface ApplyOptions extends OutputFlags {
  proposalId: string;
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

interface ApplyResult {
  command: 'apply';
  proposalId: string;
  gateStatus: 'ready' | 'blocked';
  gateCode: ApplyGateCode;
  gatePassed: boolean;
  applied: false;
  applicationRecordCount: number;
  blockingReasons: string[];
  validationId?: string;
  snapshotId?: string;
  rollbackId?: string;
  snapshotPath?: string;
  rollbackPath?: string;
  generatedSnapshot?: boolean;
  applicationRecord?: ApplicationRecord;
  applicationRecordPath?: string;
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
    .description('Save an AgentDock HTTP connection for scheduled sidecar CLI commands')
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
    .description('Collect AgentDock observations and persist them for scheduled sidecar workflows')
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
    .command('apply')
    .description('Run the L0/L1 gated apply preflight for a validated sidecar proposal')
    .requiredOption('--proposal-id <id>', 'validated proposal id to gate')
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
                `Apply gate ready: ${result.proposalId}`,
                'Applied: false (gate-only preflight; content mutation is not implemented in this slice)',
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

    const proposal = createDryRunProposal(selected, app.now, frontierResult.signals);
    const path = proposalFilePath(app.paths.root, proposal);
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

    const validations = selected.map((proposal) => createValidationReport(proposal, app.now));
    const validationPaths = validations.map((report) => validationFilePath(app.paths.root, report));
    const assetEventIds: string[] = [];
    for (let i = 0; i < validations.length; i += 1) {
      const report = validations[i]!;
      const path = validationPaths[i]!;
      writeJsonFile(path, report);
      const proposal = selected[i]!;
      assetEventIds.push(
        ...recordValidationAssetEvents(app.paths.root, proposal, report).map((event) => event.id),
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

function applyAgentDock(app: AppContext, options: ApplyOptions): ApplyResult {
  const proposalId = options.proposalId.trim();
  if (!proposalId) {
    throw new CommanderExit(2, '`haro apply --proposal-id` requires a non-empty proposal id.');
  }

  const lockDir = acquireApplyLock(app.paths.root);
  try {
    const proposal = readProposalById(app.paths.root, proposalId);
    if (!proposal) {
      return blockedApplyResult(proposalId, 'PROPOSAL_NOT_FOUND', [
        `No proposal artifact found for ${proposalId} under evolution/proposals.`,
      ]);
    }

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

    if (proposal.status !== 'validated') {
      return blockedApplyResult(proposal.id, 'VALIDATION_REQUIRED', [
        `Proposal status is ${proposal.status}; gated apply requires proposal.status=validated.`,
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

    const applicationRecord = createReadyApplicationRecord(app, proposal, validation, snapshotRef, rollbackRef);
    const applicationRecordPath = applicationFilePath(app.paths.root, applicationRecord);
    writeJsonFile(applicationRecordPath, applicationRecord);
    return {
      command: 'apply',
      proposalId: proposal.id,
      gateStatus: 'ready',
      gateCode: 'READY',
      gatePassed: true,
      applied: false,
      applicationRecordCount: 1,
      blockingReasons: [],
      validationId: validation.id,
      snapshotId: snapshotRef.id,
      rollbackId: rollbackRef.id,
      ...(generatedSnapshot ? {
        snapshotPath: generatedSnapshot.snapshotPath,
        rollbackPath: generatedSnapshot.rollbackPath,
        generatedSnapshot: true,
      } : { generatedSnapshot: false }),
      applicationRecord,
      applicationRecordPath,
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
  const snapshotStats = readSnapshotStats(app.paths.root);
  const rollbackStats = readRollbackStats(app.paths.root);
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

function applicationFilePath(root: string, record: ApplicationRecord): string {
  return join(applicationsDir(root), `${safePathSegment(record.id)}.json`);
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

function applicationsDir(root: string): string {
  return join(root, 'evolution', 'applications');
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
        'Another haro apply process is already running.',
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

function currentAssetContentExtensions(kind: string): readonly string[] {
  if (kind === 'prompt') return ['.md', '.txt', '.json'];
  if (kind === 'mcp-tool-config') return ['.json', '.md', '.txt'];
  return [];
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

function createReadyApplicationRecord(
  app: AppContext,
  proposal: EvolutionProposal,
  validation: ValidationReport,
  snapshotRef: Ref,
  rollbackRef: Ref,
): ApplicationRecord {
  const timestamp = app.now().toISOString();
  const id = `application_${sha256(JSON.stringify({
    proposalId: proposal.id,
    validationId: validation.id,
    snapshotRef,
    rollbackRef,
  })).slice(0, 24)}`;
  return ApplicationRecordSchema.parse({
    id,
    proposalId: proposal.id,
    validationId: validation.id,
    status: 'ready',
    gateCode: 'READY',
    level: proposal.level,
    targetKind: proposal.targetKind,
    applied: false,
    snapshotRef,
    rollbackRef,
    assetEventRefs: [],
    evidenceRefs: [
      evolutionProposalRef(proposal),
      validationReportRef(validation),
      snapshotRef,
      rollbackRef,
    ],
    blockingReasons: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
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
        frontierSignals.length > 0
          ? 'Run AgentDock scheduled script task for `haro observe` followed by `haro propose --auto-dry-run --include-frontier --json` and verify no runtime code is modified.'
          : 'Run AgentDock scheduled script task for `haro observe` followed by `haro propose --auto-dry-run --json` and verify no runtime code is modified.',
        ...(frontierSignals.length > 0
          ? ['Review cited frontier-signal source refs before trusting external evidence.']
          : []),
      ],
      regressionRisks: [
        'Observation schema drift can make persisted batches unreadable until doctor/status surfaces the corrupt file.',
        'AgentDock scheduler task overlap can create duplicate proposals if the proposal lock is bypassed.',
        ...(frontierSignals.length > 0
          ? ['External frontier signals can become stale or be superseded; rejected/superseded signals must not remain active evidence.']
          : []),
      ],
    },
    rollbackPlan: {
      strategy:
        'Dry-run proposal generation only writes a proposal JSON artifact; delete the proposal file to roll back before validation or approval.',
      snapshotRequired: false,
      rollbackRefs: sourceObservationRefs,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createValidationReport(
  proposal: EvolutionProposal,
  now: () => Date,
): ValidationReport {
  const rollbackReady = !proposal.rollbackPlan.snapshotRequired || proposal.rollbackPlan.rollbackRefs.length > 0;
  const blockingReasons = validationBlockingReasons(proposal, rollbackReady);
  const riskVerdict = proposal.level === 'L2' || proposal.level === 'L3'
    ? 'blocked'
    : proposal.riskLevel;
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
  }));
  return ValidationReportSchema.parse({
    id: `validation_${fingerprint.slice(0, 24)}`,
    proposalId: proposal.id,
    riskVerdict,
    requiredTests: proposal.testPlan.requiredCommands,
    rollbackReady,
    applyEligible: false,
    blockingReasons,
    evidenceRefs,
    createdAt: now().toISOString(),
  });
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

function stringToRef(value: string, kind: string): Ref {
  const ref: Ref = { id: value, kind };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    ref.uri = value;
  }
  return ref;
}

function validationBlockingReasons(proposal: EvolutionProposal, rollbackReady: boolean): string[] {
  const reasons = [
    'FEAT-045 scheduled validation is advisory; gated apply and explicit user approval are not implemented in this CLI slice.',
  ];
  if (!rollbackReady) {
    reasons.push('Rollback plan requires a snapshot or rollback refs before apply can be considered.');
  }
  if (proposal.level === 'L2' || proposal.level === 'L3') {
    reasons.push('Direct apply is forbidden for L2/L3 proposals; generate a patch branch and require human review.');
  }
  if (proposal.riskLevel === 'high') {
    reasons.push('High-risk proposals require manual review before any apply gate can be considered.');
  }
  return reasons;
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
  const observationPart = `${observationBatchCount} observation batch${observationBatchCount === 1 ? '' : 'es'}`;
  if (frontierSignalCount === 0) {
    return `Dry-run AgentDock sidecar proposal from ${observationPart}`;
  }
  const frontierPart = `${frontierSignalCount} frontier signal${frontierSignalCount === 1 ? '' : 's'}`;
  return `Dry-run AgentDock sidecar proposal from ${observationPart} and ${frontierPart}`;
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
    'Review persisted AgentDock sidecar observations and prepare a dry-run self-optimization proposal.',
    `Batches=${summary.batches}, sessions=${summary.sessions}, turns=${summary.turns}, toolCalls=${summary.toolCalls}, scheduledTaskRuns=${summary.scheduledTaskRuns}, scheduledTaskErrors=${summary.scheduledTaskErrors}, runnerErrors=${summary.runnerErrors}, usageRecords=${summary.usageRecords}.`,
    frontierSummary && frontierSummary.frontierSignals > 0
      ? `FrontierSignals=${frontierSummary.frontierSignals}, sourceTypes=${frontierSummary.sourceTypes.join('|') || '(none)'}, targetDomains=${frontierSummary.targetDomains.join('|') || '(none)'}.`
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
