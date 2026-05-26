/**
 * send_message tool (FEAT-032 R4 / AC1, FEAT-081K).
 *
 * Routes outbound text/markdown to AgentDock's external messaging contract.
 * Haro no longer owns channel adapters or a ChannelRegistry in this MCP path;
 * actual Feishu/Telegram/Web delivery is handled by the AgentDock host after it
 * consumes the IPC/API payload exposed through ToolDependencies.messaging.
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

export const SendMessageInputSchema = z
  .object({
    // Legacy Haro MCP shape kept as aliases for callers that still pass
    // channelId/sessionId/content. FEAT-081K maps channelId -> AgentDock channel
    // and content -> AgentDock text; sessionId is no longer used for routing.
    channelId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    content: z.string().min(1, 'content must be non-empty').optional(),
    // AgentDock-style aliases.
    channel: z.string().min(1).optional(),
    text: z.string().min(1, 'text must be non-empty').optional(),
    contentType: z.enum(['text', 'markdown']).optional(),
    urgent: z.boolean().optional(),
    replyToMessageId: z.string().min(1).optional(),
    reply_to_message_id: z.string().min(1).optional(),
    attachments: z.array(AttachmentRefSchema).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    if (!resolveTargetChannel(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channelId'],
        message: 'channelId or channel is required',
      });
    }
    if (!resolveText(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content or text is required',
      });
    }
  });

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export interface SendMessageOutput {
  channelId: string;
  channelSessionId: string;
  sentAt: string;
  gateway: 'agentdock-messaging';
  targetChannel?: string;
  messageId?: string;
  ipcFile?: string;
}

export const sendMessageTool: ToolDefinition<typeof SendMessageInputSchema, SendMessageOutput> = {
  name: 'send_message',
  description:
    'Send a text/markdown message through AgentDock messaging. channel/channelId should be an AgentDock target such as feishu:oc_xxx, telegram:123, or web:... Attachments are not yet supported in v1; pass an empty array or omit.',
  inputSchema: SendMessageInputSchema,
  timeoutMs: 30_000,
  async execute(params, ctx): Promise<SendMessageOutput> {
    const targetChannel = resolveTargetChannel(params);
    const text = resolveText(params);
    if (!targetChannel || !text) {
      throw new McpToolError(
        'INVALID_PARAMS',
        'send_message requires channel/channelId and text/content',
      );
    }
    if (params.attachments && params.attachments.length > 0) {
      throw new McpToolError(
        'INVALID_PARAMS',
        'attachments are not supported in send_message v1',
        'Inline links into the markdown content; native attachment delivery is owned by AgentDock messaging follow-up work.',
      );
    }
    const gateway = ctx.deps.messaging;
    if (!gateway) {
      throw new McpToolError(
        'TARGET_NOT_FOUND',
        'AgentDock messaging gateway is not configured',
        'Run under AgentDock with HAPPYCLAW_WORKSPACE_IPC and HAPPYCLAW_CHAT_JID, or pass ToolDependencies.messaging; Haro channel registry fallback has been removed.',
      );
    }
    try {
      const result = await gateway.sendMessage({
        channel: targetChannel,
        text,
        urgent: params.urgent ?? false,
        replyToMessageId: params.replyToMessageId ?? params.reply_to_message_id,
      });
      return {
        channelId: targetChannel,
        channelSessionId: params.sessionId ?? targetChannel,
        sentAt: ctx.now().toISOString(),
        gateway: 'agentdock-messaging',
        targetChannel: result.targetChannel ?? targetChannel,
        ...(result.messageId ? { messageId: result.messageId } : {}),
        ...(result.ipcFile ? { ipcFile: result.ipcFile } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new McpToolError('INTERNAL_ERROR', `AgentDock messaging gateway failed: ${message}`);
    }
  },
};

function resolveTargetChannel(input: { channelId?: string; channel?: string }): string | undefined {
  return typeof input.channel === 'string' && input.channel.trim()
    ? input.channel.trim()
    : typeof input.channelId === 'string' && input.channelId.trim()
      ? input.channelId.trim()
      : undefined;
}

function resolveText(input: { content?: string; text?: string }): string | undefined {
  return typeof input.text === 'string' && input.text.trim()
    ? input.text
    : typeof input.content === 'string' && input.content.trim()
      ? input.content
      : undefined;
}

// re-export for tests / dev tooling
export type SendMessageContext = ToolExecutionContext;
