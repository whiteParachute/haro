import { AUTH_API_KEY_STORAGE_KEY, readPersistedApiKey, useAuthStore } from '@/stores/auth';
import type {
  ApiResponse,
  ApprovalConversationRecord,
  ApprovalDecisionOption,
  ApprovalRequestView,
} from '@/types';

interface ErrorPayload {
  error?: string;
  message?: string;
  issues?: unknown[];
}

const DEFAULT_API_BASE_URL = '/api';

function normalizePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  return configuredBaseUrl && configuredBaseUrl.length > 0
    ? configuredBaseUrl.replace(/\/$/, '')
    : DEFAULT_API_BASE_URL;
}

function resolveApiKey(): string | null {
  const storeApiKey = useAuthStore.getState().apiKey?.trim();
  return storeApiKey && storeApiKey.length > 0 ? storeApiKey : readPersistedApiKey();
}

function createHeaders(init?: HeadersInit, body?: BodyInit | null): Headers {
  const headers = new Headers(init);
  if (!headers.has('Content-Type') && body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const apiKey = resolveApiKey();
  if (apiKey && !headers.has('x-api-key')) {
    headers.set('x-api-key', apiKey);
  }
  return headers;
}

async function readPayload<T>(response: Response): Promise<ApiResponse<T> | ErrorPayload> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as ApiResponse<T> | ErrorPayload;
  }
  return {
    success: response.ok,
    data: null as T,
    message: response.statusText,
  } satisfies ApiResponse<T>;
}

function createRequestError(
  response: Response,
  payload: ApiResponse<unknown> | ErrorPayload,
): Error {
  const message = payload.message ?? ('error' in payload ? payload.error : undefined);
  const error =
    response.status === 401
      ? new Error(
          `${message ?? 'Unauthorized'}: Haro Web API key is missing or invalid. ` +
            `Set localStorage key "${AUTH_API_KEY_STORAGE_KEY}" to match HARO_WEB_API_KEY, or log in with a Web user.`,
        )
      : new Error(message ?? `Request failed with status ${response.status}`);
  if ('issues' in payload && Array.isArray(payload.issues)) {
    Object.assign(error, { issues: payload.issues });
  }
  return error;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const headers = createHeaders(init.headers, init.body);
  const response = await fetch(`${resolveApiBaseUrl()}${normalizePath(path)}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const payload = await readPayload<T>(response);

  if (!response.ok) {
    if (response.status === 401 && !normalizePath(path).startsWith('/v1/auth/')) {
      void useAuthStore.getState().checkAuth();
    }
    throw createRequestError(response, payload);
  }

  return payload as ApiResponse<T>;
}

export function get<T>(path: string, init?: RequestInit) {
  return request<T>(path, {
    ...init,
    method: 'GET',
  });
}

export function post<T>(path: string, body?: unknown, init?: RequestInit) {
  return request<T>(path, {
    ...init,
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function listApprovalRequests(
  status: 'pending' | 'decided' | 'all' = 'pending',
  init?: RequestInit,
) {
  const query = new URLSearchParams({ status }).toString();
  return get<{ items: ApprovalRequestView[]; total: number }>(
    `/v1/approval-requests?${query}`,
    init,
  );
}

export function getApprovalRequest(id: string, init?: RequestInit) {
  return get<ApprovalRequestView>(`/v1/approval-requests/${encodeURIComponent(id)}`, init);
}

export function decideApprovalRequest(
  id: string,
  input: { decision: ApprovalDecisionOption; direction?: string; conversationId?: string },
  init?: RequestInit,
) {
  return post<{
    request: ApprovalRequestView['request'];
    decision: ApprovalRequestView['latestDecision'];
    proposalUpdated: boolean;
  }>(`/v1/approval-requests/${encodeURIComponent(id)}/decision`, input, init);
}

export function listApprovalConversations(id: string, init?: RequestInit) {
  return get<{ items: ApprovalConversationRecord[]; total: number }>(
    `/v1/approval-requests/${encodeURIComponent(id)}/conversations`,
    init,
  );
}

export function createApprovalConversation(id: string, init?: RequestInit) {
  return post<ApprovalConversationRecord>(
    `/v1/approval-requests/${encodeURIComponent(id)}/conversations`,
    undefined,
    init,
  );
}

export function appendApprovalConversationMessage(
  id: string,
  conversationId: string,
  content: string,
  init?: RequestInit,
) {
  return post<ApprovalConversationRecord>(
    `/v1/approval-requests/${encodeURIComponent(id)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    { content },
    init,
  );
}

export async function streamApprovalConversationAgentReply(
  id: string,
  conversationId: string,
  handlers: {
    onDelta?: (chunk: string) => void;
    onDone?: (conversation: ApprovalConversationRecord) => void;
  } = {},
  init?: RequestInit,
): Promise<ApprovalConversationRecord | null> {
  const response = await fetch(
    `${resolveApiBaseUrl()}${normalizePath(
      `/v1/approval-requests/${encodeURIComponent(id)}/conversations/${encodeURIComponent(conversationId)}/agent-reply`,
    )}`,
    {
      ...init,
      method: 'POST',
      headers: createHeaders(init?.headers),
      credentials: 'include',
    },
  );
  if (!response.ok) {
    const payload = await readPayload<unknown>(response);
    throw createRequestError(response, payload);
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buffer = '';
  let doneRecord: ApprovalConversationRecord | null = null;
  let reading = true;
  while (reading) {
    const result = await reader.read();
    buffer += decoder.decode(result.value, { stream: !result.done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = parseServerSentEvent(frame);
      if (!event) continue;
      if (event.event === 'delta' && typeof event.data.content === 'string') {
        handlers.onDelta?.(event.data.content);
      }
      if (event.event === 'done' && event.data.conversation) {
        doneRecord = event.data.conversation as ApprovalConversationRecord;
        handlers.onDone?.(doneRecord);
      }
      if (event.event === 'error') {
        throw new Error(String(event.data.error ?? 'Review conversation agent failed'));
      }
    }
    reading = !result.done;
  }
  return doneRecord;
}

function parseServerSentEvent(frame: string): { event: string; data: Record<string, unknown> } | null {
  const lines = frame.split('\n');
  const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length).trim();
  const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length);
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return null;
  }
}
