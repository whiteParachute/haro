import type {
  AgentProvider,
  AgentQueryParams,
  AgentEvent,
  AgentCapabilities,
} from '@haro/core/provider';
import { createSdkEventMapper, mapSdkEvent } from './event-mapping.js';
import { buildClaudeCapabilities, DEFAULT_CLAUDE_MODEL } from './capabilities.js';
import { claudeProviderOptionsSchema, type ClaudeProviderOptions } from './schema.js';
import type { SdkEvent, SdkQueryFn, SdkQueryOptions } from './sdk-types.js';

export const CLAUDE_PROVIDER_ID = 'claude' as const;

/**
 * Env variables that would bypass the subscription path and cause Anthropic to
 * bill the user via their raw API quota — exactly the封号 vector FEAT-002
 * exists to prevent. We fail loud at construction when any are set so the
 * user removes them deliberately (rather than silently falling back to a
 * non-compliant code path).
 */
const FORBIDDEN_ENV_VARS = ['ANTHROPIC_API_KEY'] as const;

export interface ClaudeProviderDeps {
  /** Injection point for the SDK's `query` function. Unit tests pass a mock. */
  queryFn?: SdkQueryFn;
  /** Overrides the dynamic SDK loader (used by live tests / production). */
  loadSdk?: () => Promise<{ query: SdkQueryFn }>;
  /** Optional warn channel for tools that do not map to the SDK. */
  warn?: (msg: string, ctx?: Record<string, unknown>) => void;
  /** Override process.env inspection (tests). */
  readEnv?: (name: string) => string | undefined;
  /** Skip the env guard (tests only — never enable in production). */
  skipEnvGuard?: boolean;
}

interface ResolvedAllowlist {
  allow: readonly string[] | undefined;
  deny: readonly string[] | undefined;
}

/**
 * FEAT-002 Claude Provider. Wraps `@anthropic-ai/claude-agent-sdk` and exposes
 * the Haro AgentProvider surface. No raw Anthropic API, no credential reads,
 * no Claude.ai browser emulation — the spec §2 goals and §3 non-goals fence
 * this adapter to exactly one合规 path.
 */
export class ClaudeProvider implements AgentProvider {
  public readonly id = CLAUDE_PROVIDER_ID;

  private readonly options: ClaudeProviderOptions;
  private readonly deps: ClaudeProviderDeps;
  private sdkPromise: Promise<{ query: SdkQueryFn }> | null = null;

  constructor(options: ClaudeProviderOptions = {}, deps: ClaudeProviderDeps = {}) {
    this.options = claudeProviderOptionsSchema.parse(options);
    this.deps = deps;
    if (!deps.skipEnvGuard) this.assertEnvNotLeakingApiKey();
  }

  private assertEnvNotLeakingApiKey(): void {
    const read = this.deps.readEnv ?? ((name: string) => process.env[name]);
    for (const name of FORBIDDEN_ENV_VARS) {
      const val = read(name);
      if (val && val.length > 0) {
        throw new Error(
          `Claude Provider: environment variable ${name} is set; this would route Claude traffic through the raw API and risks account suspension (see FEAT-002 R7). Unset the variable before starting Haro — Claude subscription auth is handled by @anthropic-ai/claude-agent-sdk.`,
        );
      }
    }
  }

  capabilities(): AgentCapabilities {
    return buildClaudeCapabilities(this.options.defaultModel);
  }

  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    const queryFn = await this.resolveQueryFn();
    const sdkOptions = this.buildSdkOptions(params);
    let iterator: AsyncIterable<SdkEvent>;
    try {
      iterator = queryFn(sdkOptions);
    } catch (err) {
      yield this.buildErrorEvent(err);
      return;
    }

    // Tool-use blocks are split across `content_block_start` (metadata) and
    // subsequent `input_json_delta` events. The mapper state-machine is
    // per-query so concurrent queries stay isolated.
    const mapper = createSdkEventMapper();
    try {
      for await (const ev of iterator) {
        for (const mapped of mapper.push(ev)) yield mapped;
      }
      for (const mapped of mapper.flush()) yield mapped;
    } catch (err) {
      for (const mapped of mapper.flush()) yield mapped;
      yield this.buildErrorEvent(err);
    }
  }

  async healthCheck(): Promise<boolean> {
    // R5 — the "light-weight ping" is a 1-token dry query with a 5 second
    // ceiling (AC5). The real SDK may ignore our AbortSignal, so we race
    // `next()` against an independent timer rejection; this keeps the AC5
    // bound regardless of SDK cooperation. Credentials are never leaked to
    // caller logs — we surface only a boolean.
    try {
      const queryFn = await this.resolveQueryFn();
      const ac = new AbortController();
      let timeoutTriggered = false;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          timeoutTriggered = true;
          ac.abort();
          reject(new Error('healthCheck timeout'));
        }, 5_000);
        id.unref?.();
      });
      let firstIter: AsyncIterator<SdkEvent> | null = null;
      try {
        const iterable = queryFn({
          prompt: 'ping',
          systemPrompt: 'Respond with "pong". No tools, no reasoning.',
          model: this.options.defaultModel ?? DEFAULT_CLAUDE_MODEL,
          maxTokens: 1,
          signal: ac.signal,
        } as SdkQueryOptions);
        const asyncIter = iterable as AsyncIterable<SdkEvent>;
        firstIter = asyncIter[Symbol.asyncIterator]();
        await Promise.race([firstIter.next(), timeoutPromise]);
        return !timeoutTriggered;
      } finally {
        if (firstIter && typeof firstIter.return === 'function') {
          try {
            await firstIter.return();
          } catch {
            /* swallow — closing best-effort */
          }
        }
      }
    } catch {
      return false;
    }
  }

  private buildSdkOptions(params: AgentQueryParams): SdkQueryOptions {
    const allowlist = this.resolveAllowlist(params.tools);
    const model = params.model ?? this.options.defaultModel ?? DEFAULT_CLAUDE_MODEL;
    const opts: SdkQueryOptions = {
      prompt: params.prompt,
      model,
    };
    if (params.systemPrompt) opts.systemPrompt = params.systemPrompt;
    if (params.permissionMode) opts.permissionMode = params.permissionMode;
    if (allowlist.allow) opts.allowedTools = allowlist.allow;
    if (allowlist.deny) opts.disallowedTools = allowlist.deny;
    if (params.sessionContext?.sessionId) opts.sessionId = params.sessionContext.sessionId;
    if (params.providerOptions) {
      for (const [k, v] of Object.entries(params.providerOptions)) {
        if (k === 'apiKey') continue; // FEAT-002 R7 — never transmit credentials
        opts[k] = v;
      }
    }
    return opts;
  }

  private resolveAllowlist(tools: readonly string[] | undefined): ResolvedAllowlist {
    const configAllow = this.options.toolsAllow;
    const configDeny = this.options.toolsDeny;
    // `tools === undefined` means "inherit config"; `tools === []` is a
    // deliberate "use no tools" override (codex MUST-FIX: do not conflate
    // them). OpenClaw's tools.allow semantics guided this choice.
    let allow: readonly string[] | undefined = undefined;
    if (tools !== undefined) {
      allow = configAllow
        ? tools.filter((t) => configAllow.includes(t))
        : [...tools];
      const denied = allow.filter((t) => configDeny?.includes(t));
      if (denied.length > 0) {
        this.deps.warn?.(
          'Claude Provider: filtered tools overlap deny-list',
          { denied },
        );
      }
      if (configDeny) allow = allow.filter((t) => !configDeny.includes(t));
    } else if (configAllow) {
      allow = [...configAllow];
      if (configDeny) allow = allow.filter((t) => !configDeny.includes(t));
    }
    return { allow, deny: configDeny };
  }

  private buildErrorEvent(err: unknown): AgentEvent {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'error') {
      const mapped = mapSdkEvent(err as SdkEvent);
      if (mapped) return mapped;
    }
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code ?? 'provider_exception';
    return {
      type: 'error',
      code,
      message,
      retryable: false,
    };
  }

  private async resolveQueryFn(): Promise<SdkQueryFn> {
    if (this.deps.queryFn) return this.deps.queryFn;
    if (!this.sdkPromise) {
      const loader = this.deps.loadSdk ?? (async () => {
        // Dynamic import so packages that build without the SDK installed
        // (unit tests that inject queryFn) still compile. The import is
        // restricted to this single call site — provider-claude is the only
        // package where the SDK module name is allowed (FEAT-002 R6).
        const modName = '@anthropic-ai/claude-agent-sdk';
        const mod = (await import(modName)) as { query: SdkQueryFn };
        return { query: mod.query };
      });
      this.sdkPromise = loader();
    }
    const { query } = await this.sdkPromise;
    return query;
  }
}

export function createClaudeProvider(
  options: ClaudeProviderOptions = {},
  deps: ClaudeProviderDeps = {},
): ClaudeProvider {
  return new ClaudeProvider(options, deps);
}
