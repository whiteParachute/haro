/**
 * FEAT-003 — narrow re-export of `@openai/codex-sdk` shapes the provider needs.
 *
 * We deliberately depend only on a small structural subset of the SDK's
 * public types so test mocks can be assembled without spinning up the real
 * Codex CLI binary. Anything beyond what is referenced here is opaque and
 * stays in the SDK package.
 */
export type SdkThreadEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | {
      type: 'turn.completed';
      usage: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
      };
    }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: SdkThreadItem }
  | { type: 'item.updated'; item: SdkThreadItem }
  | { type: 'item.completed'; item: SdkThreadItem }
  | { type: 'error'; message: string };

export type SdkThreadItem =
  | {
      id: string;
      type: 'agent_message';
      text: string;
    }
  | {
      id: string;
      type: 'reasoning';
      text: string;
    }
  | {
      id: string;
      type: 'command_execution';
      command: string;
      aggregated_output: string;
      exit_code?: number;
      status: 'in_progress' | 'completed' | 'failed';
    }
  | {
      id: string;
      type: 'file_change';
      changes: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>;
      status: 'completed' | 'failed';
    }
  | {
      id: string;
      type: 'mcp_tool_call';
      server: string;
      tool: string;
      arguments: unknown;
      result?: unknown;
      error?: { message: string };
      status: 'in_progress' | 'completed' | 'failed';
    }
  | {
      id: string;
      type: 'web_search';
      query: string;
    }
  | {
      id: string;
      type: 'todo_list';
      items: Array<{ text: string; completed: boolean }>;
    }
  | {
      id: string;
      type: 'error';
      message: string;
    };

export interface SdkStreamedTurn {
  events: AsyncGenerator<SdkThreadEvent>;
}

export interface SdkTurnOptions {
  outputSchema?: unknown;
  signal?: AbortSignal;
}

export interface SdkThreadOptions {
  model?: string;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  networkAccessEnabled?: boolean;
  webSearchEnabled?: boolean;
}

export interface SdkThread {
  readonly id: string | null;
  runStreamed(input: string, options?: SdkTurnOptions): Promise<SdkStreamedTurn>;
}

export interface SdkCodexOptions {
  baseUrl?: string;
  apiKey?: string;
  codexPathOverride?: string;
}

export interface SdkCodex {
  startThread(options?: SdkThreadOptions): SdkThread;
  resumeThread(id: string, options?: SdkThreadOptions): SdkThread;
}

export type SdkCodexFactory = (options?: SdkCodexOptions) => SdkCodex;
