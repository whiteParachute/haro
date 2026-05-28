/**
 * Tool-level permission gate (FEAT-032 R3 / G3).
 *
 * Decisions follow the spec:
 *   - send_message: allow when caller is in the same channel as the target
 *     session; otherwise needs-approval ('external-service' style).
 *   - memory_remember: allow the retired tool to execute so it can fail
 *     closed with TARGET_DISABLED instead of entering approval flow.
 *   - memory_query / schedule_task: allow.
 *
 * The gate is intentionally a small in-package policy table rather than
 * delegating to PermissionBudgetStore: the spec guard surface is per-workflow
 * token budgeting, while tool calls are per-session. Audit writes still record
 * every decision so operators retain full visibility (R8).
 */

import type {
  PermissionDecisionInput,
  PermissionDecisionOutput,
  ToolDecision,
} from './types.js';

export type PermissionEvaluator = (input: PermissionDecisionInput) => PermissionDecisionOutput;

export const evaluatePermission: PermissionEvaluator = (input) => {
  switch (input.toolName) {
    case 'send_message':
      return evaluateSendMessage(input);
    case 'memory_query':
      return { decision: 'allowed' };
    case 'memory_remember':
      return { decision: 'allowed' };
    case 'schedule_task':
      return { decision: 'allowed' };
    default:
      return {
        decision: 'denied' as ToolDecision,
        reason: `unknown tool '${input.toolName}'`,
      };
  }
};

function evaluateSendMessage(input: PermissionDecisionInput): PermissionDecisionOutput {
  const params = (input.params ?? {}) as { channelId?: string; channel?: string };
  const target = typeof params.channel === 'string' && params.channel.trim()
    ? params.channel
    : typeof params.channelId === 'string' && params.channelId.trim()
      ? params.channelId
      : undefined;
  if (!target) {
    return { decision: 'allowed' };
  }
  const callerChannel = input.session.channelId;
  if (!callerChannel || callerChannel === target) {
    return { decision: 'allowed' };
  }
  return {
    decision: 'needs-approval',
    reason: `cross-channel send (${callerChannel} → ${target}) is external-service class`,
  };
}
