import type { AgentRunner, RunAgentInput, RunAgentResult } from '@haro/core';
import type { WebLogger } from '../types.js';
import type { WebSocketManager } from './manager.js';

export async function streamAgentRun(input: {
  runner: AgentRunner;
  manager?: WebSocketManager;
  logger: WebLogger;
  input: RunAgentInput;
}): Promise<RunAgentResult> {
  const result = await input.runner.run({
    ...input.input,
    onEvent: (event, sessionId) => {
      input.input.onEvent?.(event, sessionId);
      input.manager?.publishEvent(sessionId, event);
      input.logger.info?.({ eventType: event.type, sessionId }, 'websocket agent event streamed');
    },
  });

  input.manager?.publishResult(result.sessionId, result);
  input.manager?.publishSessionUpdate(
    result.sessionId,
    result.finalEvent.type === 'result' ? 'completed' : 'failed',
  );
  return result;
}
