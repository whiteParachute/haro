import { serve, type ServerType } from '@hono/node-server';
import { getWebSocketManager } from './index.js';
import type { WebApp, WebServerOptions } from './types.js';

export interface WebServerHandle {
  server: ServerType;
  url: string;
  ready: Promise<void>;
  stop: () => Promise<void>;
}

export function startWebServer(app: WebApp, options: WebServerOptions): WebServerHandle {
  const { port, host } = options;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const onStartupError = (error: Error): void => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(error);
  };
  const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
    if (readySettled) return;
    readySettled = true;
    server.off('error', onStartupError);
    resolveReady();
  });
  let stopped = false;

  const websocketManager = getWebSocketManager(app);
  if (websocketManager) {
    server.on('upgrade', (request, socket, head) => {
      websocketManager.handleUpgrade(request, socket, head);
    });
  }

  server.once('error', onStartupError);

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error?: Error) => {
        if (error) {
          rejectClose(error);
          return;
        }
        resolveClose();
      });
    });
  };

  const onSignal = (): void => {
    void stop().catch(() => undefined);
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return { server, url: formatWebServerUrl(options), ready, stop };
}

function formatWebServerUrl(options: WebServerOptions): string {
  const displayHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  return `http://${displayHost}:${options.port}`;
}
