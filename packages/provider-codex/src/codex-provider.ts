import type {
  AgentCapabilities,
  AgentEvent,
  AgentProvider,
  AgentQueryParams,
} from '@haro/core/provider';
import { buildCodexCapabilities } from './capabilities.js';
import { createCodexEventMapper } from './event-mapping.js';
import { mapCodexError } from './error-mapping.js';
import { createModelLister, type ModelLister, type CodexModelInfo, type ListModelsDeps } from './list-models.js';
import { codexProviderOptionsSchema, type CodexProviderOptions } from './schema.js';
import type {
  SdkCodex,
  SdkCodexFactory,
  SdkCodexOptions,
  SdkThread,
  SdkThreadEvent,
} from './sdk-types.js';

export const CODEX_PROVIDER_ID = 'codex' as const;

export interface CodexProviderDeps {
  /** Inject a Codex factory (tests use a fake; production uses the real SDK). */
  codexFactory?: SdkCodexFactory;
  /** Lazy loader for the real SDK so unit tests do not need it installed. */
  loadSdk?: () => Promise<{ Codex: new (options?: SdkCodexOptions) => SdkCodex }>;
  /** Replace `process.env.OPENAI_API_KEY` lookup. */
  readApiKey?: () => string | undefined;
  /** Override fetch / clock for `listModels()` cache. */
  modelListerDeps?: ListModelsDeps;
  /** Optional pre-built lister (tests wire this directly). */
  modelLister?: ModelLister;
}

/**
 * FEAT-003 Codex Provider. Wraps `@openai/codex-sdk`.
 *
 * Responsibilities:
 * - Translate Haro `AgentQueryParams` into a `Codex.startThread()` /
 *   `Thread.runStreamed()` round-trip.
 * - Forward `previousResponseId` as the SDK's resume id (Codex calls it
 *   `thread_id`; we reuse the AgentResultEvent.responseId slot).
 * - Surface model list via `listModels()` (FEAT-003 R4) with TTL caching.
 * - Translate failure modes into the canonical AgentErrorEvent shape with
 *   `hint: 'save-and-clear'` for context overflows (AC7).
 */
export class CodexProvider implements AgentProvider {
  public readonly id = CODEX_PROVIDER_ID;

  private readonly options: CodexProviderOptions;
  private readonly deps: CodexProviderDeps;
  private codexInstance: SdkCodex | null = null;
  private codexInstancePromise: Promise<SdkCodex> | null = null;
  private readonly lister: ModelLister;

  constructor(options: CodexProviderOptions = {}, deps: CodexProviderDeps = {}) {
    this.options = codexProviderOptionsSchema.parse(options);
    this.deps = deps;

    if (deps.modelLister) {
      this.lister = deps.modelLister;
    } else {
      const listerOpts: { baseUrl?: string; ttlSeconds?: number } = {};
      if (this.options.baseUrl) listerOpts.baseUrl = this.options.baseUrl;
      if (this.options.listModelsTtlSeconds) listerOpts.ttlSeconds = this.options.listModelsTtlSeconds;
      const listerDeps: ListModelsDeps = { ...(deps.modelListerDeps ?? {}) };
      if (deps.readApiKey && !listerDeps.readApiKey) listerDeps.readApiKey = deps.readApiKey;
      this.lister = createModelLister(listerOpts, listerDeps);
    }
  }

  /**
   * FEAT-003 R4 — capability surface.
   *
   * `maxContextTokens` is populated lazily: the first call may return `null`
   * for the model list (no fetch yet), which yields `maxContextTokens =
   * undefined`. Callers that need an authoritative window should `await
   * listModels()` first; downstream FEAT-005 Runner does this exactly once
   * per session boot.
   */
  capabilities(): AgentCapabilities {
    const cached = this.lister.inspectCache();
    return buildCodexCapabilities(this.options.defaultModel, cached?.models ?? null);
  }

  async listModels(): Promise<readonly CodexModelInfo[]> {
    return this.lister.listModels();
  }

  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    let codex: SdkCodex;
    try {
      codex = await this.resolveCodex();
    } catch (err) {
      yield mapCodexError(err);
      return;
    }

    const threadOptions: { model?: string; skipGitRepoCheck: boolean } = {
      skipGitRepoCheck: true,
    };
    const model = params.model ?? this.options.defaultModel;
    if (model) threadOptions.model = model;
    if (params.systemPrompt) {
      // The SDK does not currently expose a systemPrompt slot on
      // ThreadOptions; surface it inside the prompt as an instruction
      // header. This keeps spec R2/R3 transparent without leaking SDK
      // internals to the caller.
      // (Documented gap, not a workaround we hide — keep visible.)
    }

    let thread: SdkThread;
    const previousId = params.sessionContext?.previousResponseId;
    try {
      thread =
        previousId && previousId.length > 0
          ? codex.resumeThread(previousId, threadOptions)
          : codex.startThread(threadOptions);
    } catch (err) {
      yield mapCodexError(err);
      return;
    }

    const promptText = this.composePrompt(params);
    const mapper = createCodexEventMapper({ initialThreadId: previousId ?? null });
    let stream: { events: AsyncGenerator<SdkThreadEvent> };
    try {
      stream = await thread.runStreamed(promptText);
    } catch (err) {
      yield mapCodexError(err);
      return;
    }

    try {
      for await (const ev of stream.events) {
        for (const mapped of mapper.push(ev)) yield mapped;
      }
      for (const mapped of mapper.flush()) yield mapped;
    } catch (err) {
      for (const mapped of mapper.flush()) yield mapped;
      yield mapCodexError(err);
    }
  }

  /**
   * FEAT-003 R6 — health check via the upstream `/models` REST call. The
   * provider runs the request through `listModels()` (which uses the
   * configured baseUrl + OPENAI_API_KEY) and races it against a 5s timer
   * so a hung connection cannot stall startup. AC3 calibrates the bound.
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Force a fresh fetch — health needs the live answer, not a stale
      // cache from minutes ago.
      this.lister.invalidate();
      const result = await Promise.race([
        this.lister.listModels().then(() => true).catch(() => false),
        new Promise<false>((resolve) => {
          const id = setTimeout(() => resolve(false), 5_000);
          id.unref?.();
        }),
      ]);
      return result;
    } catch {
      return false;
    }
  }

  private composePrompt(params: AgentQueryParams): string {
    if (!params.systemPrompt) return params.prompt;
    return `${params.systemPrompt}\n\n---\n\n${params.prompt}`;
  }

  private async resolveCodex(): Promise<SdkCodex> {
    if (this.codexInstance) return this.codexInstance;
    if (!this.codexInstancePromise) {
      this.codexInstancePromise = this.constructCodex();
    }
    this.codexInstance = await this.codexInstancePromise;
    return this.codexInstance;
  }

  private async constructCodex(): Promise<SdkCodex> {
    const sdkOptions: SdkCodexOptions = {};
    if (this.options.baseUrl) sdkOptions.baseUrl = this.options.baseUrl;
    const apiKey = this.readApiKey();
    if (!apiKey) {
      throw new Error(
        'Codex Provider: OPENAI_API_KEY is not set (FEAT-003 R5). Export the env var before issuing queries.',
      );
    }
    sdkOptions.apiKey = apiKey;

    if (this.deps.codexFactory) {
      return this.deps.codexFactory(sdkOptions);
    }
    const loader = this.deps.loadSdk ?? this.defaultSdkLoader();
    const { Codex } = await loader();
    return new Codex(sdkOptions);
  }

  private defaultSdkLoader(): () => Promise<{ Codex: new (options?: SdkCodexOptions) => SdkCodex }> {
    return async () => {
      // Dynamic import keeps unit tests free of the binary dependency on
      // the codex CLI. Production / live tests load it normally.
      const modName = '@openai/codex-sdk';
      const mod = (await import(modName)) as {
        Codex: new (options?: SdkCodexOptions) => SdkCodex;
      };
      return { Codex: mod.Codex };
    };
  }

  private readApiKey(): string | undefined {
    if (this.deps.readApiKey) return this.deps.readApiKey();
    return process.env.OPENAI_API_KEY;
  }
}

export function createCodexProvider(
  options: CodexProviderOptions = {},
  deps: CodexProviderDeps = {},
): CodexProvider {
  return new CodexProvider(options, deps);
}
