import { z } from 'zod';

/**
 * Codex Provider config slot (FEAT-003 R5). Credentials are NOT taken from
 * YAML — the OPENAI_API_KEY env var is read at provider construction time.
 * The YAML side only carries non-credential overrides (e.g. `baseUrl` for
 * enterprise endpoints). We refuse `apiKey` here so a mistakenly-pasted key
 * fails loud rather than silently bypassing the env-only auth path.
 */
const codexProviderConfigSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    defaultModel: z.string().optional(),
  })
  .partial()
  .passthrough()
  .superRefine((value, ctx) => {
    if (value && typeof value === 'object' && 'apiKey' in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message:
          'Codex Provider 不接受 YAML 配置中的 apiKey（见 FEAT-003 R5）— 请通过 OPENAI_API_KEY 环境变量传递凭证',
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
        codex: codexProviderConfigSchema.optional(),
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
    runtime: z
      .object({
        taskTimeoutMs: z.number().int().positive().optional(),
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
