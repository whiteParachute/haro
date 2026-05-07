/**
 * send_message tool (FEAT-032 R4 / AC1).
 *
 * Routes outbound text/markdown to a channel session via ChannelRegistry. The
 * spec disallows attachments in v1 — schema accepts the field for forward
 * compatibility but a non-empty attachments array returns INVALID_PARAMS so
 * callers don't silently drop content. Cross-channel sends are gated upstream
 * (registry.permission) before this `execute` runs.
 */

import { z } from 'zod';
import { McpToolError } from '../error.js';
import type { ToolDefinition, ToolExecutionContext } from '../types.js';

const AttachmentRefSchema = z.object({
  url: z.string().min(1),
  contentType: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  bytes: z.number().int().positive().optional(),
});

export const SendMessageInputSchema = z.object({
  channelId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, 'channelId must be kebab/snake lowercase'),
  sessionId: z.string().min(1),
  content: z.string().min(1, 'content must be non-empty'),
  contentType: z.enum(['text', 'markdown']).optional(),
  attachments: z.array(AttachmentRefSchema).max(10).optional(),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export interface SendMessageOutput {
  channelId: string;
  channelSessionId: string;
  sentAt: string;
}

export const sendMessageTool: ToolDefinition<typeof SendMessageInputSchema, SendMessageOutput> = {
  name: 'send_message',
  description:
    'Send a text/markdown message to a channel session. Cross-channel sends require operator approval (external-service). Attachments are not yet supported in v1; pass an empty array or omit.',
  inputSchema: SendMessageInputSchema,
  timeoutMs: 30_000,
  async execute(params, ctx): Promise<SendMessageOutput> {
    const { channelId, sessionId, content } = params;
    if (params.attachments && params.attachments.length > 0) {
      throw new McpToolError(
        'INVALID_PARAMS',
        'attachments are not supported in send_message v1',
        'Inline links into the markdown content; native attachment delivery will land in a later FEAT.',
      );
    }
    const registry = ctx.deps.channels;
    if (!registry.has(channelId)) {
      throw new McpToolError(
        'TARGET_NOT_FOUND',
        `channel '${channelId}' is not registered`,
      );
    }
    const entry = registry.getEntry(channelId);
    if (!entry.enabled) {
      throw new McpToolError(
        'TARGET_DISABLED',
        `channel '${channelId}' is registered but disabled`,
        `Run 'haro channel enable ${channelId}' or POST /api/v1/channels/${channelId}/enable.`,
      );
    }
    try {
      await entry.channel.send(sessionId, {
        type: params.contentType ?? 'text',
        content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new McpToolError('INTERNAL_ERROR', `channel.send failed: ${message}`);
    }
    return {
      channelId,
      channelSessionId: sessionId,
      sentAt: ctx.now().toISOString(),
    };
  },
};

// re-export for tests / dev tooling
export type SendMessageContext = ToolExecutionContext;
