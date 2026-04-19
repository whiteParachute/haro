import { z } from 'zod';

/**
 * FEAT-002 R7 — the provider's own config view rejects apiKey at the
 * adapter boundary as a belt-and-braces guard on top of the global-config
 * schema rejection (see packages/core/src/config/schema.ts). Motivation:
 * some future config source (env-based overrides, CLI flag dumps, tests)
 * might construct a ClaudeProvider config object without going through the
 * global schema — we still want to refuse apiKey there.
 */
export const claudeProviderOptionsSchema = z
  .object({
    defaultModel: z.string().min(1).optional(),
    toolsAllow: z.array(z.string()).optional(),
    toolsDeny: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    if (val && typeof val === 'object' && 'apiKey' in (val as Record<string, unknown>)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message:
          'Claude Provider 不应配置 apiKey（见 FEAT-002）— 订阅认证由 @anthropic-ai/claude-agent-sdk 自动处理',
      });
    }
  });

export type ClaudeProviderOptions = z.infer<typeof claudeProviderOptionsSchema>;
