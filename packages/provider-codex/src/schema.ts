import { z } from 'zod';

/**
 * FEAT-003 R5 — provider-side option schema. Mirrors `providers.codex` in the
 * global config schema (packages/core/src/config/schema.ts) but applied at
 * the adapter boundary as a belt-and-braces guard for tests and code paths
 * that build provider options without going through the global loader.
 *
 * Credentials are intentionally absent: the OpenAI key is read from
 * `process.env.OPENAI_API_KEY` at construction time (see `codex-provider.ts`).
 * Any `apiKey` slipping through is rejected outright.
 */
export const codexProviderOptionsSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    /**
     * Optional default model name. The provider does NOT ship a hardcoded
     * fallback (FEAT-003 R8); if unset, the SDK / upstream fallback rules
     * apply. We DO validate it against `listModels()` results when the
     * Agent registry resolves `defaultModel` (FEAT-004 R8 / AC7).
     */
    defaultModel: z.string().optional(),
    /**
     * TTL (seconds) for the in-process `listModels()` cache. Defaults to
     * 600 (10 min). Tests override to exercise expiration.
     */
    listModelsTtlSeconds: z.number().positive().optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    if (val && typeof val === 'object' && 'apiKey' in (val as Record<string, unknown>)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message:
          'Codex Provider 不接受配置中的 apiKey（见 FEAT-003 R5）— 请通过 OPENAI_API_KEY 环境变量传递凭证',
      });
    }
  });

export type CodexProviderOptions = z.infer<typeof codexProviderOptionsSchema>;
