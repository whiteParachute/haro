import {
  AUTH_API_KEY_STORAGE_KEY,
  readPersistedApiKey,
  useAuthStore,
} from '@/stores/auth';
import type {
  ApiResponse,
  MemoryMaintenanceTask,
  MemoryQueryFilters,
  MemoryQueryResponse,
  MemoryStats,
  MemoryWriteInput,
  MemoryEntry,
  SkillListResponse,
  SkillMutationResponse,
  SkillDetail,
  WorkflowDebugDetail,
  WorkflowListResponse,
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
  const error = response.status === 401
    ? new Error(
      `${message ?? 'Unauthorized'}: Dashboard API key is missing or invalid. ` +
        `Set the key in the Dashboard auth card or localStorage key "${AUTH_API_KEY_STORAGE_KEY}" ` +
        'to match HARO_WEB_API_KEY.',
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
  });

  const payload = await readPayload<T>(response);

  if (!response.ok) {
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

export function put<T>(path: string, body?: unknown, init?: RequestInit) {
  return request<T>(path, {
    ...init,
    method: 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function del<T>(path: string, init?: RequestInit) {
  return request<T>(path, {
    ...init,
    method: 'DELETE',
  });
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

export function listWorkflows(filters: { limit?: number } = {}, init?: RequestInit) {
  const searchParams = new URLSearchParams();
  if (filters.limit !== undefined) {
    searchParams.set('limit', String(filters.limit));
  }
  const query = searchParams.toString();
  return get<WorkflowListResponse>(`/v1/workflows${query ? `?${query}` : ''}`, init);
}

export function getWorkflow(workflowId: string, init?: RequestInit) {
  return get<WorkflowDebugDetail>(`/v1/workflows/${encodePathSegment(workflowId)}`, init);
}

export function getWorkflowCheckpoints<T>(
  workflowId: string,
  options: { checkpointId?: string } = {},
  init?: RequestInit,
) {
  const searchParams = new URLSearchParams();
  if (options.checkpointId) {
    searchParams.set('checkpointId', options.checkpointId);
  }
  const query = searchParams.toString();
  const path = `/v1/workflows/${encodePathSegment(workflowId)}/checkpoints${query ? `?${query}` : ''}`;
  return get<T>(path, init);
}

export function queryMemory(filters: MemoryQueryFilters = {}, init?: RequestInit) {
  const searchParams = new URLSearchParams();
  if (filters.keyword) searchParams.set('keyword', filters.keyword);
  if (filters.scope) searchParams.set('scope', filters.scope);
  if (filters.agentId) searchParams.set('agentId', filters.agentId);
  if (filters.layer) searchParams.set('layer', filters.layer);
  if (filters.verificationStatus) searchParams.set('verificationStatus', filters.verificationStatus);
  if (filters.limit !== undefined) searchParams.set('limit', String(filters.limit));
  const query = searchParams.toString();
  return get<MemoryQueryResponse>(`/v1/memory/query${query ? `?${query}` : ''}`, init);
}

export function writeMemory(input: MemoryWriteInput, init?: RequestInit) {
  return post<MemoryEntry>('/v1/memory/write', input, init);
}

export function getMemoryStats(init?: RequestInit) {
  return get<MemoryStats>('/v1/memory/stats', init);
}

export function runMemoryMaintenance(input: { scope?: string; agentId?: string } = {}, init?: RequestInit) {
  return post<MemoryMaintenanceTask>('/v1/memory/maintenance', input, init);
}

export function listSkills(init?: RequestInit) {
  return get<SkillListResponse>('/v1/skills', init);
}

export function getSkill(id: string, init?: RequestInit) {
  return get<SkillDetail>(`/v1/skills/${encodePathSegment(id)}`, init);
}

export function enableSkill(id: string, init?: RequestInit) {
  return post<SkillMutationResponse>(`/v1/skills/${encodePathSegment(id)}/enable`, undefined, init);
}

export function disableSkill(id: string, init?: RequestInit) {
  return post<SkillMutationResponse>(`/v1/skills/${encodePathSegment(id)}/disable`, undefined, init);
}

export function installSkill(source: string, init?: RequestInit) {
  return post<SkillMutationResponse>('/v1/skills/install', { source }, init);
}

export function uninstallSkill(id: string, init?: RequestInit) {
  return del<SkillMutationResponse>(`/v1/skills/${encodePathSegment(id)}`, init);
}
