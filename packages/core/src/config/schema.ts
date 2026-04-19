import { z } from 'zod';

const providerConfigSchema = z
  .object({
    apiKey: z.string().optional(),
    defaultModel: z.string().optional(),
  })
  .partial()
  .passthrough();

/**
 * Claude Provider MUST NOT accept apiKey (FEAT-002 R7/AC3) — the subscription
 * flow is managed by `@anthropic-ai/claude-agent-sdk`. Direct API-key usage
 * would bypass the SDK and is the key封号 vector this whole provider guards
 * against. We keep the rest of the object passthrough-friendly so future
 * fields (toolsAllow/deny, resume hints, …) do not require a schema bump.
 */
const claudeProviderConfigSchema = z
  .object({
    defaultModel: z.string().optional(),
    toolsAllow: z.array(z.string()).optional(),
    toolsDeny: z.array(z.string()).optional(),
  })
  .partial()
  .passthrough()
  .superRefine((value, ctx) => {
    if (value && typeof value === 'object' && 'apiKey' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message:
          'Claude Provider 不应配置 apiKey（见 FEAT-002）— 订阅认证由 @anthropic-ai/claude-agent-sdk 自动处理',
      });
    }
  });

const channelBaseSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .partial()
  .passthrough();

export const haroConfigSchema = z
  .object({
    providers: z
      .object({
        claude: claudeProviderConfigSchema.optional(),
        codex: providerConfigSchema.optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    memory: z
      .object({
        path: z.string().optional(),
        primary: z
          .object({
            path: z.string(),
            globalSleep: z.boolean().optional(),
          })
          .optional(),
        backup: z
          .object({
            path: z.string(),
            globalSleep: z.boolean().optional(),
          })
          .optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    channels: z
      .object({
        cli: channelBaseSchema.optional(),
        feishu: channelBaseSchema
          .extend({
            appId: z.string().optional(),
            appSecret: z.string().optional(),
            mode: z.string().optional(),
            sessionScope: z.string().optional(),
          })
          .optional(),
        telegram: channelBaseSchema
          .extend({
            botToken: z.string().optional(),
            mode: z.string().optional(),
          })
          .optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    evolution: z
      .object({
        metabolism: z
          .object({
            shitInterval: z.string().optional(),
            shitAutoTrigger: z.boolean().optional(),
            eatAutoTrigger: z.boolean().optional(),
          })
          .partial()
          .passthrough()
          .optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    logging: z
      .object({
        level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
        stdout: z.boolean().optional(),
        file: z.string().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    defaultAgent: z.string().optional(),
  })
  .partial()
  .passthrough();

export type HaroConfig = z.infer<typeof haroConfigSchema>;

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export class HaroConfigValidationError extends Error {
  readonly source: string;
  readonly issues: ConfigValidationIssue[];

  constructor(source: string, issues: ConfigValidationIssue[]) {
    super(
      `Invalid Haro config (${source}):\n` +
        issues.map((i) => `  ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'HaroConfigValidationError';
    this.source = source;
    this.issues = issues;
  }
}

export function parseHaroConfig(source: string, data: unknown): HaroConfig {
  const result = haroConfigSchema.safeParse(data);
  if (result.success) return result.data;
  const issues: ConfigValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '<root>',
    message: issue.message,
  }));
  throw new HaroConfigValidationError(source, issues);
}
