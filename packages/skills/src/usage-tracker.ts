import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { SkillManifestEntry, SkillUsageRow } from './types.js';

export class SkillUsageTracker {
  private readonly db: Database.Database;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_usage (
        skill_id TEXT PRIMARY KEY,
        install_source TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        last_used_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        is_preinstalled INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  record(entry: SkillManifestEntry, usedAt = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT INTO skill_usage (skill_id, install_source, installed_at, last_used_at, use_count, is_preinstalled)
         VALUES (@skillId, @installSource, @installedAt, @lastUsedAt, 1, @isPreinstalled)
         ON CONFLICT(skill_id) DO UPDATE SET
           last_used_at = excluded.last_used_at,
           use_count = skill_usage.use_count + 1,
           install_source = excluded.install_source,
           installed_at = excluded.installed_at,
           is_preinstalled = excluded.is_preinstalled`,
      )
      .run({
        skillId: entry.id,
        installSource: entry.source,
        installedAt: entry.installedAt,
        lastUsedAt: usedAt,
        isPreinstalled: entry.isPreinstalled ? 1 : 0,
      });
  }

  get(skillId: string): SkillUsageRow | undefined {
    const row = this.db.prepare('SELECT * FROM skill_usage WHERE skill_id = ?').get(skillId) as
      | {
          skill_id: string;
          install_source: string;
          installed_at: string;
          last_used_at: string | null;
          use_count: number;
          is_preinstalled: number;
        }
      | undefined;
    if (!row) return undefined;
    return {
      skillId: row.skill_id,
      installSource: row.install_source,
      installedAt: row.installed_at,
      ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
      useCount: row.use_count,
      isPreinstalled: row.is_preinstalled === 1,
    };
  }

  close(): void {
    this.db.close();
  }
}
