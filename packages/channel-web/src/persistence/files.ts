import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative as pathRelative, resolve, sep } from 'node:path';

/**
 * Filesystem layout for Web Channel uploads:
 *   <root>/<sessionId>/<fileId>-<safeFilename>
 *
 * `safeFilename` is the already-sanitized filename returned by `validateUpload`.
 * Files are written with mode 0600; directories get 0700.
 */

export interface SaveUploadInput {
  storageRoot: string;
  sessionId: string;
  fileId: string;
  filename: string;
  data: Buffer;
}

export interface SaveUploadResult {
  storagePath: string;
}

export function saveUploadFile(input: SaveUploadInput): SaveUploadResult {
  const { absoluteSessionDir, absoluteFile } = resolveStoragePath({
    storageRoot: input.storageRoot,
    sessionId: input.sessionId,
    fileId: input.fileId,
    filename: input.filename,
  });
  mkdirSync(absoluteSessionDir, { recursive: true, mode: 0o700 });
  writeFileSync(absoluteFile, input.data, { mode: 0o600 });
  // mode arg to writeFileSync is honored on creation but on some systems
  // umask still alters the result; chmod to be safe.
  try {
    chmodSync(absoluteFile, 0o600);
  } catch {
    // Best-effort — Windows or restricted filesystems may reject chmod.
  }
  return { storagePath: absoluteFile };
}

export function deleteUploadFile(storagePath: string): void {
  rmSync(storagePath, { force: true });
}

export function deleteSessionUploadDir(input: { storageRoot: string; sessionId: string }): void {
  const dir = sessionDirectory(input.storageRoot, input.sessionId);
  rmSync(dir, { recursive: true, force: true });
}

export function sessionDirectory(storageRoot: string, sessionId: string): string {
  return resolve(storageRoot, encodePathSegment(sessionId));
}

interface ResolvedStorage {
  absoluteSessionDir: string;
  absoluteFile: string;
}

export function resolveStoragePath(input: {
  storageRoot: string;
  sessionId: string;
  fileId: string;
  filename: string;
}): ResolvedStorage {
  const root = resolve(input.storageRoot);
  const sessionDir = resolve(root, encodePathSegment(input.sessionId));
  if (!isWithin(root, sessionDir)) {
    throw new Error(`session directory escapes storage root: ${sessionDir}`);
  }
  const safeName = `${encodePathSegment(input.fileId)}-${encodePathSegment(input.filename)}`;
  const absoluteFile = resolve(sessionDir, safeName);
  if (!isWithin(sessionDir, absoluteFile)) {
    throw new Error(`storage path escapes session directory: ${absoluteFile}`);
  }
  return { absoluteSessionDir: dirname(absoluteFile), absoluteFile };
}

/**
 * Verify that `target` lives under `root` (defense-in-depth against
 * path-traversal exploits that survive earlier sanitization). Uses Node's
 * `path.relative` so we get cross-platform-correct segment-aware comparison
 * — naïve string `startsWith('..')` matches innocuous filenames like
 * `.._escape` and produces false positives.
 */
export function isWithin(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  if (r === t) return true;
  const rel = pathRelative(r, t);
  if (rel === '' || rel === '.') return true;
  if (rel === '..') return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return true;
}

/**
 * Reduce an arbitrary identifier (sessionId / fileId / filename) into a single
 * path-safe segment. Lets us safely build paths even if upstream layers ever
 * relax their sanitization. Also rewrites pure-dot segments (`.`, `..`, ...)
 * so a malicious sessionId can't escape via path resolution.
 */
function encodePathSegment(input: string): string {
  const stripped = input.replace(/[\\/\0]+/g, '_');
  if (/^\.+$/.test(stripped)) return `_${stripped}`;
  return stripped;
}

// Convenience helper for callers that want both path resolution and the
// directory creation in one call (e.g. tests).
export function ensureSessionDir(storageRoot: string, sessionId: string): string {
  const dir = sessionDirectory(storageRoot, sessionId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir);
}
