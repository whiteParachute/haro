import { join } from 'node:path';
import type { MemoryScope } from './types.js';

export interface ScopeRootLayout {
  scopeRoot: string;
  index: string;
  impressions: string;
  impressionsArchived: string;
  knowledge: string;
  pending: string;
  meta: string;
  personality: string;
  changelog: string;
  lastSleepAt: string;
}

/**
 * Per-scope filesystem layout. Mirrors aria-memory (spec §5.1) so a pre-existing
 * aria-memory directory can be dropped into `memory.path` without migration.
 */
export function buildScopeLayout(root: string, scope: MemoryScope, agentId?: string): ScopeRootLayout {
  const scopeRoot = resolveScopeRoot(root, scope, agentId);
  return {
    scopeRoot,
    index: join(scopeRoot, 'index.md'),
    impressions: join(scopeRoot, 'impressions'),
    impressionsArchived: join(scopeRoot, 'impressions', 'archived'),
    knowledge: join(scopeRoot, 'knowledge'),
    pending: join(scopeRoot, 'knowledge', '.pending'),
    meta: join(scopeRoot, 'meta.json'),
    personality: join(scopeRoot, 'personality.md'),
    changelog: join(scopeRoot, 'changelog.md'),
    lastSleepAt: join(scopeRoot, '.last-sleep-at'),
  };
}

export function resolveScopeRoot(root: string, scope: MemoryScope, agentId?: string): string {
  switch (scope) {
    case 'platform':
      return join(root, 'platform');
    case 'agent':
      if (!agentId) throw new Error('MemoryFabric: agent scope requires agentId');
      return join(root, 'agents', agentId);
    case 'shared':
      return join(root, 'shared');
    default: {
      // TS exhaustiveness guard — narrows to `never`.
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}
