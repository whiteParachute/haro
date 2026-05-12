import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Command } from 'commander';
import {
  EvolutionProposalSchema,
  ObservationBatchSchema,
  ValidationReportSchema,
  createFakeAgentDockSource,
  createHttpAgentDockSource,
  type EvolutionProposal,
  type ObservationBatch,
  type Ref,
  type ValidationReport,
} from '@haro/agentdock-contract';
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
  limit?: string;
}

interface ValidateOptions extends OutputFlags {
  pending?: boolean;
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
  proposalCount: number;
  consumedObservationCount: number;
  pendingObservationCount: number;
  skippedCorruptObservationCount: number;
  skippedCorruptProposalCount: number;
  wroteProposal: boolean;
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
  validations: ValidationReport[];
  validationPaths: string[];
}

const CONNECTIONS_FILE = 'agentdock-connections.json';
const DEFAULT_CONNECTION_ID = 'agentdock-local';

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
            proposalCount: result.proposalCount,
            consumedObservationCount: result.consumedObservationCount,
            pendingObservationCount: result.pendingObservationCount,
            skippedCorruptObservationCount: result.skippedCorruptObservationCount,
            skippedCorruptProposalCount: result.skippedCorruptProposalCount,
            wroteProposal: result.wroteProposal,
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
      mkdirSync(join(app.paths.root, 'evolution', 'observations'), { recursive: true });
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
      mkdirSync(join(app.paths.root, 'evolution', 'cursors'), { recursive: true });
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
    emitCorruptJsonWarnings(app, {
      corruptObservationCount: pendingResult.corruptCount,
      corruptProposalCount: consumedResult.corruptCount,
    });
    const pending = pendingResult.batches;
    const selected = typeof limit === 'number' ? pending.slice(0, limit) : pending;
    if (selected.length === 0) {
      return {
        command: 'propose',
        mode: 'dry-run',
        proposalCount: 0,
        consumedObservationCount: 0,
        pendingObservationCount: 0,
        skippedCorruptObservationCount: pendingResult.corruptCount,
        skippedCorruptProposalCount: consumedResult.corruptCount,
        wroteProposal: false,
      };
    }

    const proposal = createDryRunProposal(selected, app.now);
    const path = proposalFilePath(app.paths.root, proposal);
    mkdirSync(join(app.paths.root, 'evolution', 'proposals'), { recursive: true });
    writeJsonFile(path, proposal);
    return {
      command: 'propose',
      mode: 'dry-run',
      proposalCount: 1,
      consumedObservationCount: selected.length,
      pendingObservationCount: pending.length - selected.length,
      skippedCorruptObservationCount: pendingResult.corruptCount,
      skippedCorruptProposalCount: consumedResult.corruptCount,
      wroteProposal: true,
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
        validations: [],
        validationPaths: [],
      };
    }

    const validations = selected.map((proposal) => createValidationReport(proposal, app.now));
    const validationPaths = validations.map((report) => validationFilePath(app.paths.root, report));
    for (let i = 0; i < validations.length; i += 1) {
      const report = validations[i]!;
      const path = validationPaths[i]!;
      writeJsonFile(path, report);
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
      validations,
      validationPaths,
    };
  } finally {
    releaseConnectionLock(lockDir);
  }
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
  if (
    !isRecord(value) ||
    typeof value.connectionId !== 'string' ||
    typeof value.cursor !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.lastObservationId !== undefined && typeof value.lastObservationId !== 'string') ||
    (value.lastObservationPath !== undefined && typeof value.lastObservationPath !== 'string')
  ) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock cursor file at ${path}; expected { connectionId, cursor }. Remove it and rerun \`haro observe\`.`,
    );
  }
  if (expectedConnectionId && value.connectionId !== expectedConnectionId) {
    throw new CommanderExit(
      1,
      `Invalid AgentDock cursor file at ${path}; connectionId '${value.connectionId}' does not match '${expectedConnectionId}'. Remove it and rerun \`haro observe\`.`,
    );
  }
  return value as unknown as ObservationCursorRecord;
}

function connectionsPath(root: string): string {
  return join(root, CONNECTIONS_FILE);
}

function cursorFilePath(root: string, connectionId: string): string {
  return join(root, 'evolution', 'cursors', `${encodedConnectionId(connectionId)}.json`);
}

function observationFilePath(root: string, batch: ObservationBatch): string {
  return join(
    root,
    'evolution',
    'observations',
    `${safePathSegment(batch.collectedAt)}-${encodedConnectionId(batch.connectionId)}-${safePathSegment(batch.id)}.json`,
  );
}

function proposalFilePath(root: string, proposal: EvolutionProposal): string {
  return join(root, 'evolution', 'proposals', `${safePathSegment(proposal.id)}.json`);
}

function validationFilePath(root: string, report: ValidationReport): string {
  return join(root, 'evolution', 'validations', `${safePathSegment(report.id)}.json`);
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

function createDryRunProposal(
  batches: readonly ObservationBatch[],
  now: () => Date,
): EvolutionProposal {
  const sourceObservationRefs = batches.map(observationBatchRef);
  const summary = summarizeObservationBatches(batches);
  const fingerprint = sha256(JSON.stringify({
    refs: sourceObservationRefs.map((ref) => ref.id).sort(),
    summary,
  }));
  const proposalId = `proposal_${fingerprint.slice(0, 24)}`;
  const contentRef = `haro-sidecar://proposals/${proposalId}/dry-run`;
  const contentHash = sha256(JSON.stringify({ sourceObservationRefs, summary, contentRef }));
  const timestamp = now().toISOString();
  return EvolutionProposalSchema.parse({
    id: proposalId,
    title: `Dry-run AgentDock sidecar proposal from ${batches.length} observation batch${batches.length === 1 ? '' : 'es'}`,
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
        summary: proposalSummary(summary),
      },
    ],
    testPlan: {
      requiredCommands: [
        'pnpm -F @haro/agentdock-contract test',
        'pnpm -F @haro/cli test -- test/agentdock-sidecar-cli.test.ts',
      ],
      manualChecks: [
        'Run AgentDock scheduled script task for `haro observe` followed by `haro propose --auto-dry-run --json` and verify no runtime code is modified.',
      ],
      regressionRisks: [
        'Observation schema drift can make persisted batches unreadable until doctor/status surfaces the corrupt file.',
        'AgentDock scheduler task overlap can create duplicate proposals if the proposal lock is bypassed.',
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

function proposalSummary(summary: ReturnType<typeof summarizeObservationBatches>): string {
  return [
    'Review persisted AgentDock sidecar observations and prepare a dry-run self-optimization proposal.',
    `Batches=${summary.batches}, sessions=${summary.sessions}, turns=${summary.turns}, toolCalls=${summary.toolCalls}, scheduledTaskRuns=${summary.scheduledTaskRuns}, scheduledTaskErrors=${summary.scheduledTaskErrors}, runnerErrors=${summary.runnerErrors}, usageRecords=${summary.usageRecords}.`,
  ].join(' ');
}

function encodedConnectionId(connectionId: string): string {
  return Buffer.from(connectionId, 'utf8').toString('base64url');
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

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
