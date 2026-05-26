/**
 * AgentDock-facing messaging bridge for Haro MCP tools (FEAT-081K).
 *
 * This intentionally mirrors AgentDock's existing external IPC contract used by
 * `agentdock-tool send-message` and `MessagingPlugin.send_message`: write a JSON
 * file into `${HAPPYCLAW_WORKSPACE_IPC}/messages`. Haro does not own channel
 * adapters here; the AgentDock host consumes the IPC payload and performs the
 * actual Feishu/Telegram/Web delivery.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { AgentDockMessageGateway, AgentDockSendMessageInput, AgentDockSendMessageResult } from './types.js';

export interface AgentDockIpcMessageGatewayOptions {
  ipcDir: string;
  chatJid: string;
  groupFolder?: string;
  now?: () => Date;
  randomSuffix?: () => string;
}

export interface AgentDockIpcMessageGatewayEnvOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function createAgentDockIpcMessageGateway(
  options: AgentDockIpcMessageGatewayOptions,
): AgentDockMessageGateway {
  const now = options.now ?? (() => new Date());
  const randomSuffix = options.randomSuffix ?? (() => randomBytes(4).toString('hex'));
  return {
    async sendMessage(input: AgentDockSendMessageInput): Promise<AgentDockSendMessageResult> {
      const dir = join(options.ipcDir, 'messages');
      mkdirSync(dir, { recursive: true });
      const suffix = `${Date.now()}-${randomSuffix()}.json`;
      const tmp = join(dir, `${suffix}.tmp`);
      const dst = join(dir, suffix);
      const payload = {
        type: 'message',
        chatJid: options.chatJid,
        text: input.text,
        targetChannel: input.channel,
        urgent: input.urgent ?? false,
        replyToMsgId: input.replyToMessageId,
        groupFolder: options.groupFolder,
        timestamp: now().toISOString(),
      };
      writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      renameSync(tmp, dst);
      return {
        status: 'queued',
        targetChannel: input.channel,
        ipcFile: dst,
      };
    },
  };
}

export function createAgentDockIpcMessageGatewayFromEnv(
  options: AgentDockIpcMessageGatewayEnvOptions = {},
): AgentDockMessageGateway | undefined {
  const env = options.env ?? process.env;
  const ipcDir = env.HAPPYCLAW_WORKSPACE_IPC;
  const chatJid = env.HAPPYCLAW_CHAT_JID;
  if (!ipcDir || !chatJid) return undefined;
  return createAgentDockIpcMessageGateway({
    ipcDir,
    chatJid,
    ...(env.HAPPYCLAW_GROUP_FOLDER ? { groupFolder: env.HAPPYCLAW_GROUP_FOLDER } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
