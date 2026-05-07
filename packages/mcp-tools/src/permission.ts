/**
 * Tool-level permission gate (FEAT-032 R3 / G3).
 *
 * Decisions follow the spec:
 *   - send_message: allow when caller is in the same channel as the target
 *     session; otherwise needs-approval ('external-service' style).
 *   - memory_remember:
 *       scope=agent  → allow
 *       scope=shared → needs-approval (write-shared)
 *       scope=platform → needs-approval (write-shared)
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
      return evaluateMemoryRemember(input);
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
  const params = (input.params ?? {}) as { channelId?: string };
  const target = typeof params.channelId === 'string' ? params.channelId : undefined;
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

function evaluateMemoryRemember(input: PermissionDecisionInput): PermissionDecisionOutput {
  const params = (input.params ?? {}) as { scope?: string };
  const scope = typeof params.scope === 'string' ? params.scope : 'agent';
  if (scope === 'agent') return { decision: 'allowed' };
  if (scope === 'shared' || scope === 'platform') {
    return {
      decision: 'needs-approval',
      reason: `write-shared (${scope}) requires operator approval`,
    };
  }
  return { decision: 'allowed' };
}
