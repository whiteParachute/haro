/**
 * Public entry point for @haro/mcp-tools (FEAT-032).
 */

export { ToolRegistry } from './registry.js';
export { ToolInvocationAuditWriter, hashParams } from './audit.js';
export { McpServer } from './server.js';
export {
  StdioTransport,
  InMemoryTransport,
  jsonRpcCodeFor,
  type Transport,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type JsonRpcSuccessResponse,
  type JsonRpcErrorResponse,
  type JsonRpcMessage,
} from './transport.js';
export { McpToolError, isMcpToolError, toErrorPayload } from './error.js';
export { evaluatePermission, type PermissionEvaluator } from './permission.js';
export { zodToJsonSchema, type JsonSchema } from './json-schema.js';

export {
  sendMessageTool,
  SendMessageInputSchema,
  type SendMessageInput,
  type SendMessageOutput,
} from './tools/send-message.js';
export {
  memoryQueryTool,
  MemoryQueryInputSchema,
  type MemoryQueryInput,
  type MemoryQueryOutput,
  type MemoryQueryHitDto,
} from './tools/memory-query.js';
export {
  memoryRememberTool,
  MemoryRememberInputSchema,
  type MemoryRememberInput,
  type MemoryRememberOutput,
} from './tools/memory-remember.js';
export {
  scheduleTaskTool,
  ScheduleTaskInputSchema,
  type ScheduleTaskInput,
  type ScheduleTaskOutput,
} from './tools/schedule-task.js';
export {
  allowSidecarReadOnlyTools,
  createSidecarRegistry,
  haroAssetQueryTool,
  haroObserveTool,
  haroProposeTool,
  haroValidateTool,
  HaroAssetQueryInputSchema,
  HaroAssetQueryOutputSchema,
  HaroObserveInputSchema,
  HaroProposeInputSchema,
  HaroValidateInputSchema,
  type HaroAssetQueryInput,
  type HaroAssetQueryOutput,
  type HaroObserveInput,
  type HaroProposeInput,
  type HaroValidateInput,
} from './sidecar-tools.js';

export {
  SidecarAssetManifestSchema,
  SidecarAssetRegistry,
  createSidecarAssetRegistry,
  type SidecarAssetManifest,
  type SidecarAssetQuery,
} from './sidecar-asset-registry.js';

export type {
  SessionContext,
  ToolDependencies,
  ToolDescriptor,
  ToolDecision,
  ToolResultStatus,
  ToolResult,
  ToolErrorCode,
  ToolErrorPayload,
  ToolDefinition,
  ToolExecutionContext,
  PermissionDecisionInput,
  PermissionDecisionOutput,
  ToolInvocationAudit,
} from './types.js';

import { ToolRegistry, type RegistryOptions } from './registry.js';
import { sendMessageTool } from './tools/send-message.js';
import { memoryQueryTool } from './tools/memory-query.js';
import { memoryRememberTool } from './tools/memory-remember.js';
import { scheduleTaskTool } from './tools/schedule-task.js';

/**
 * Build a registry pre-loaded with the four FEAT-032 builtin tools. Callers
 * that want to extend the surface (Phase 2.0+) should call `register()` on the
 * returned registry directly.
 */
export function createDefaultRegistry(options: RegistryOptions): ToolRegistry {
  const registry = new ToolRegistry(options);
  registry.register(sendMessageTool);
  registry.register(memoryQueryTool);
  registry.register(memoryRememberTool);
  registry.register(scheduleTaskTool);
  return registry;
}
