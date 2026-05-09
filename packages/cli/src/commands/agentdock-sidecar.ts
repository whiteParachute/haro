import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  ObservationBatchSchema,
  createFakeAgentDockSource,
  createHttpAgentDockSource,
  type ObservationBatch,
} from '@haro/agentdock-contract';
import { CommanderExit, type AppContext } from '../index.js';
import { renderError, renderJson, resolveOutputMode } from '../output/index.js';

interface OutputFlags {
  json?: boolean;
  human?: boolean;
}

interface AgentDockConnectionRecord {
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
          id,
          baseUrl: source.connection.baseUrl,
          ...(authRef ? { authRef } : {}),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
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
}

async function observeAgentDock(app: AppContext, options: ObserveOptions): Promise<ObserveResult> {
  const sourceMode = normalizeSourceMode(options.source);
  const limit = normalizeOptionalPositiveInt(options.limit, '--limit');
  const connection = resolveObservationConnection(app, options, sourceMode);
  const lockDir = acquireConnectionLock(app.paths.root, connection.id);
  try {
    const cursorPath = cursorFilePath(app.paths.root, connection.id);
    const storedCursor = options.since === undefined || options.since === 'last'
      ? readCursor(cursorPath)?.cursor
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
  return value as unknown as AgentDockConnectionRecord;
}

function writeConnectionsFile(root: string, file: AgentDockConnectionsFile): void {
  mkdirSync(root, { recursive: true });
  writeJsonFile(connectionsPath(root), file);
}

function readCursor(path: string): ObservationCursorRecord | undefined {
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

function releaseConnectionLock(lockDir: string): void {
  rmSync(lockDir, { recursive: true, force: true });
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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
