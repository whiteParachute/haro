import { createLogger } from '@haro/core';
import type { WebLogger } from './types.js';

export function createWebLogger(name: string): WebLogger {
  try {
    return createLogger({ name, stdout: false });
  } catch {
    return createLogger({ name, stdout: false, file: null });
  }
}
