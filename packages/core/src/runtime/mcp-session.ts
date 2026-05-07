/**
 * Per-session MCP server lifecycle (FEAT-032 D1 / R10 / AC6).
 *
 * AgentRunner spawns a fresh MCP server subprocess for every session and
 * shuts it down (SIGTERM with a 5 s grace, then SIGKILL) when the session
 * ends. Keeping the lifecycle in its own module avoids leaking subprocess
 * details into runner.ts and lets tests stub the factory with an in-memory
 * implementation.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

export interface McpSessionContext {
  sessionId: string;
  agentId: string;
  channelId?: string;
  userId?: string;
}

export interface McpSessionHandle {
  /** Stop the subprocess. Returns once the OS confirms exit. */
  stop(options?: { timeoutMs?: number }): Promise<void>;
  /** True until the subprocess exits. */
  readonly alive: boolean;
  /**
   * Underlying ChildProcess (subprocess factory only). Exposed so a future
   * provider integration can attach JSON-RPC client to the spawned MCP
   * server's stdio without round-tripping through the factory. `undefined`
   * for in-memory / no-op handles.
   */
  readonly child?: ChildProcess;
}

export type McpSessionFactory = (input: McpSessionStartInput) => Promise<McpSessionHandle>;

export interface McpSessionStartInput {
  session: McpSessionContext;
  root?: string;
  dbFile?: string;
  /** Override clock for tests (defaults to Date.now()). */
  now?: () => number;
}

export interface SubprocessFactoryOptions {
  /** Path to the compiled server-entry.js (defaults to the resolved @haro/mcp-tools/bin entry). */
  serverEntry?: string;
  /** Override node binary for tests. */
  nodeBinary?: string;
  /** Stderr / stdout sink (defaults to inherit). */
  stderr?: 'inherit' | 'ignore' | 'pipe';
  stdout?: 'inherit' | 'ignore' | 'pipe';
}

/**
 * Build a subprocess-backed factory. The MCP tools package owns its own
 * server-entry; we resolve it lazily so core has no hard runtime dependency
 * on @haro/mcp-tools — installs that opt out of MCP tools simply pass a
 * different factory (or none at all).
 */
export function createSubprocessMcpFactory(options: SubprocessFactoryOptions = {}): McpSessionFactory {
  return async (input) => {
    const serverEntry = options.serverEntry ?? resolveDefaultServerEntry();
    const nodeBin = options.nodeBinary ?? process.execPath;
    const args = [
      serverEntry,
      JSON.stringify(input.session),
      JSON.stringify({
        ...(input.root ? { root: input.root } : {}),
        ...(input.dbFile ? { dbFile: input.dbFile } : {}),
      }),
    ];
    const child = spawn(nodeBin, args, {
      stdio: ['pipe', options.stdout ?? 'inherit', options.stderr ?? 'inherit'],
      env: { ...process.env },
    });
    return new SubprocessMcpHandle(child);
  };
}

class SubprocessMcpHandle implements McpSessionHandle {
  private exitedAt: number | null = null;
  private exitedResolvers: Array<() => void> = [];

  constructor(readonly child: ChildProcess) {
    child.once('exit', () => {
      this.exitedAt = Date.now();
      const resolvers = this.exitedResolvers.splice(0);
      for (const resolve of resolvers) resolve();
    });
  }

  get alive(): boolean {
    return this.exitedAt === null;
  }

  async stop(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.exitedAt !== null) return;
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (this.child.killed) {
      await this.waitForExit();
      return;
    }
    try {
      this.child.kill('SIGTERM');
    } catch {
      /* already dead */
    }
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    await new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (resolved) return;
        try {
          this.child.kill('SIGKILL');
        } catch {
          /* noop */
        }
      }, timeoutMs);
      const onExit = (): void => {
        resolved = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };
      if (this.exitedAt !== null) onExit();
      else this.exitedResolvers.push(onExit);
    });
  }

  private async waitForExit(): Promise<void> {
    if (this.exitedAt !== null) return;
    await new Promise<void>((resolve) => this.exitedResolvers.push(resolve));
  }
}

function resolveDefaultServerEntry(): string {
  // require.resolve replacement for ESM packages — defer to dynamic import path.
  // Rather than baking a brittle path here, the runner.ts caller is expected to
  // supply `serverEntry` explicitly when wiring the factory; if it doesn't, we
  // throw so misconfiguration surfaces immediately.
  throw new Error(
    "createSubprocessMcpFactory: serverEntry is required (no default — pass options.serverEntry).",
  );
}

/** No-op factory — useful for tests / installs that disable MCP tools. */
export function createNoopMcpFactory(): McpSessionFactory {
  return async () => ({
    alive: false,
    stop: async () => undefined,
  });
}
