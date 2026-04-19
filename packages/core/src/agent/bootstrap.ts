import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_AGENT_FILE,
  DEFAULT_AGENT_YAML,
} from './default-agent.js';

/**
 * FEAT-004 R6 / AC4 — seed the default `haro-assistant.yaml` the very first
 * time Haro runs against an empty `~/.haro/agents/` directory. Idempotent:
 * when there is already any `.yaml` / `.yml` file, we do NOT overwrite
 * anything (we respect user edits). When we create the file, the contents
 * are the exact block defined in `default-agent.ts` (which itself mirrors
 * spec §5 — AC4 demands byte-level alignment).
 */
export interface BootstrapDefaultAgentResult {
  created: boolean;
  filePath: string;
}

export function bootstrapDefaultAgentFile(
  agentsDir: string,
): BootstrapDefaultAgentResult {
  mkdirSync(agentsDir, { recursive: true });
  const entries = readdirSync(agentsDir);
  const filePath = join(agentsDir, DEFAULT_AGENT_FILE);
  // R6 / AC4 trigger is "目录为空" — strictly empty. If ANYTHING is present
  // (including dotfiles like .gitkeep) we refuse to seed, under the
  // assumption that a non-empty directory reflects user intent we must not
  // overwrite. `existsSync` re-guards against a race where another writer
  // dropped the file between the readdir and the seed.
  if (entries.length > 0) {
    return { created: false, filePath };
  }
  if (existsSync(filePath)) {
    return { created: false, filePath };
  }
  writeFileSync(filePath, DEFAULT_AGENT_YAML, { encoding: 'utf8' });
  return { created: true, filePath };
}
