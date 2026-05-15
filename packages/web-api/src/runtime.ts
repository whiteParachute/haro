import type { WebLogger } from './types.js';
import type { DailyFrontierScheduler } from './daily-frontier.js';

export interface WebRuntime {
  /** HARO_HOME root that contains evolution/approval-requests and auth DB. */
  root?: string;
  /** Optional project root retained for host-level diagnostics/log context. */
  projectRoot?: string;
  /** Optional SQLite DB path used by the local Web auth store. */
  dbFile?: string;
  logger: WebLogger;
  startedAt: number;
  /** Optional hosted-service scheduler for daily frontier intake + proposal generation. */
  dailyFrontier?: DailyFrontierScheduler;
}
