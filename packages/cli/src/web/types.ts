import type { Hono } from 'hono';
import type { HaroLogger } from '@haro/core';

export interface WebServerOptions {
  port: number;
  host: string;
}

export type WebLogger = Pick<HaroLogger, 'info' | 'warn' | 'error' | 'debug'>;

export type ApiKeyAuthEnv = {
  Variables: {
    logger?: WebLogger;
  };
};

export type WebApp = Hono<ApiKeyAuthEnv>;
