import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface HaroPaths {
  root: string;
  configFile: string;
  logFile: string;
  dbFile: string;
  dirs: {
    agents: string;
    skills: string;
    channels: string;
    memory: string;
    assets: string;
    logs: string;
    evolutionContext: string;
    archive: string;
  };
}

const REQUIRED_SUBDIRS = [
  'agents',
  'skills',
  'channels',
  'memory',
  'assets',
  'logs',
  'evolution-context',
  'archive',
] as const;

export function resolveHaroRoot(override?: string): string {
  if (override) return resolve(override);
  const env = process.env.HARO_HOME;
  if (env && env.length > 0) return resolve(env);
  return join(homedir(), '.haro');
}

export function buildHaroPaths(override?: string): HaroPaths {
  const root = resolveHaroRoot(override);
  return {
    root,
    configFile: join(root, 'config.yaml'),
    logFile: join(root, 'logs', 'haro.log'),
    dbFile: join(root, 'haro.db'),
    dirs: {
      agents: join(root, 'agents'),
      skills: join(root, 'skills'),
      channels: join(root, 'channels'),
      memory: join(root, 'memory'),
      assets: join(root, 'assets'),
      logs: join(root, 'logs'),
      evolutionContext: join(root, 'evolution-context'),
      archive: join(root, 'archive'),
    },
  };
}

export const REQUIRED_HARO_SUBDIRS = REQUIRED_SUBDIRS;
