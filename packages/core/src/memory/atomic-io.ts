import { mkdirSync, renameSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Promise-chain serialization: every write routes through this queue so
 * concurrent `write()` / `deposit()` calls never clobber one another (R6).
 * Single-process scope — multi-process setups rely on .pending merge logic
 * (R5) to reconcile at sleep time.
 */
export class SerialWriter {
  private chain: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async drain(): Promise<void> {
    const current = this.chain;
    await current.catch(() => undefined);
  }
}

export function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
  writeFileSync(tmp, content, { encoding: 'utf8' });
  renameSync(tmp, path);
}

export function readFileIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
