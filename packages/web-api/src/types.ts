import type { Hono } from 'hono';
import type { HaroLogger } from '@haro/core';

export interface WebServerOptions {
  port: number;
  host: string;
}

export type WebLogger = Pick<HaroLogger, 'info' | 'warn' | 'error' | 'debug'>;

export type WebUserRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type WebUserStatus = 'active' | 'disabled';

export type WebOperationClass =
  | 'read-only'
  | 'local-write'
  | 'config-write'
  | 'token-reset'
  | 'user-disable'
  | 'owner-transfer'
  | 'bootstrap-reset';

export interface AuthenticatedWebUser {
  id: string;
  username: string;
  displayName: string;
  role: WebUserRole;
  status: WebUserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export type WebAuthContext =
  | {
      kind: 'session';
      authenticated: true;
      user: AuthenticatedWebUser;
      role: WebUserRole;
      sessionId: string;
      expiresAt: string;
    }
  | {
      kind: 'legacy-api-key';
      authenticated: true;
      role: 'owner';
    }
  | {
      kind: 'anonymous-legacy';
      authenticated: false;
      role: 'owner';
    };

export type ApiKeyAuthEnv = {
  Variables: {
    logger?: WebLogger;
    auth?: WebAuthContext;
  };
};

export type WebApp = Hono<ApiKeyAuthEnv>;
