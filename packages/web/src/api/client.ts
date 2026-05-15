import { AUTH_API_KEY_STORAGE_KEY, readPersistedApiKey, useAuthStore } from '@/stores/auth';
import type {
  ApiResponse,
  ApprovalDecisionOption,
  ApprovalRequestView,
  DailyFrontierStatus,
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
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const apiKey = resolveApiKey();
  if (apiKey && !headers.has('x-api-key')) {
    headers.set('x-api-key', apiKey);
  }

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

export function getDailyFrontierStatus(init?: RequestInit) {
  return get<DailyFrontierStatus>('/v1/daily-frontier/status', init);
}

export function getApprovalRequest(id: string, init?: RequestInit) {
  return get<ApprovalRequestView>(`/v1/approval-requests/${encodeURIComponent(id)}`, init);
}

export function decideApprovalRequest(
  id: string,
  input: { decision: ApprovalDecisionOption; direction?: string },
  init?: RequestInit,
) {
  return post<{
    request: ApprovalRequestView['request'];
    decision: ApprovalRequestView['latestDecision'];
    proposalUpdated: boolean;
  }>(`/v1/approval-requests/${encodeURIComponent(id)}/decision`, input, init);
}
