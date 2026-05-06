import { basename } from 'node:path';

/**
 * FEAT-031 R5 — upload validation: size limits, mime allow-list,
 * filename safety (path traversal + dotfile/system-path blacklist).
 *
 * Defaults are inherited from happyclaw's tested values. Per-session quota
 * is enforced separately by the persistence layer.
 */

export const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_DOCUMENT_MAX_BYTES = 30 * 1024 * 1024; // 30 MB
export const DEFAULT_PER_SESSION_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB

export type UploadKind = 'image' | 'document';

export interface UploadValidationConfig {
  imageMaxBytes?: number;
  documentMaxBytes?: number;
  perSessionQuotaBytes?: number;
}

export interface ValidatedUpload {
  filename: string;
  size: number;
  kind: UploadKind;
  mimeType: string;
}

export interface UploadValidationError {
  code:
    | 'invalid_filename'
    | 'forbidden_path_segment'
    | 'forbidden_extension'
    | 'unsupported_mime'
    | 'too_large'
    | 'quota_exceeded'
    | 'empty_file';
  message: string;
}

/**
 * File extensions/folders that must never be uploaded. Mirrors happyclaw's
 * "system path" blacklist — protects against attempts to traffic credentials
 * through the upload route by encoding them as a "filename".
 */
const FORBIDDEN_NAME_SEGMENTS = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  '.docker',
  '.config',
  '.netrc',
  '.bash_history',
  '.zsh_history',
  '.psql_history',
  '.git-credentials',
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.env',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.keystore',
  '.jks',
]);

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
]);

/**
 * Document mime types are an explicit allow-list — we deliberately do NOT
 * accept arbitrary `application/*` since "application/*" is a junk drawer
 * (covers `application/x-msdownload`, `application/x-malware`, etc).
 * `text/*` is broad enough to cover plaintext variants we can't enumerate.
 */
const DOCUMENT_MIME_PREFIXES = ['text/'];

const DOCUMENT_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/json',
  'application/x-yaml',
  'application/xml',
]);

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  yml: 'application/x-yaml',
  yaml: 'application/x-yaml',
  xml: 'application/xml',
  log: 'text/plain',
  zip: 'application/zip',
};

export interface ValidateUploadInput {
  filename: string;
  size: number;
  mimeType?: string;
  /** Bytes already used by this session (excluding the new upload). */
  sessionUsageBytes?: number;
  config?: UploadValidationConfig;
}

export type ValidateUploadResult =
  | { ok: true; value: ValidatedUpload }
  | { ok: false; error: UploadValidationError };

export function validateUpload(input: ValidateUploadInput): ValidateUploadResult {
  const filename = sanitizeFilename(input.filename);
  if (!filename.ok) return { ok: false, error: filename.error };

  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, error: { code: 'empty_file', message: 'File is empty' } };
  }

  const ext = extensionOf(filename.value);
  if (ext && FORBIDDEN_EXTENSIONS.has(`.${ext}`)) {
    return {
      ok: false,
      error: {
        code: 'forbidden_extension',
        message: `Extension '.${ext}' is not allowed`,
      },
    };
  }

  const mimeType = (input.mimeType?.trim() || guessMimeFromExtension(ext) || 'application/octet-stream').toLowerCase();
  const kindResult = classifyMime(mimeType);
  if (!kindResult.ok) return { ok: false, error: kindResult.error };

  const limits = resolveLimits(input.config);
  const max = kindResult.kind === 'image' ? limits.imageMaxBytes : limits.documentMaxBytes;
  if (input.size > max) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `File exceeds ${kindResult.kind} size limit (${formatBytes(input.size)} > ${formatBytes(max)})`,
      },
    };
  }

  const usage = Math.max(0, input.sessionUsageBytes ?? 0);
  if (usage + input.size > limits.perSessionQuotaBytes) {
    return {
      ok: false,
      error: {
        code: 'quota_exceeded',
        message: `Per-session upload quota exceeded (${formatBytes(usage + input.size)} > ${formatBytes(
          limits.perSessionQuotaBytes,
        )})`,
      },
    };
  }

  return {
    ok: true,
    value: {
      filename: filename.value,
      size: input.size,
      kind: kindResult.kind,
      mimeType,
    },
  };
}

interface SanitizedFilename {
  ok: true;
  value: string;
}

interface SanitizeFailure {
  ok: false;
  error: UploadValidationError;
}

/**
 * Reduce filename to a safe basename and reject path traversal / system paths.
 * Returns the cleaned basename (no directory component, no leading dot stack).
 */
export function sanitizeFilename(input: string): SanitizedFilename | SanitizeFailure {
  if (typeof input !== 'string') {
    return { ok: false, error: { code: 'invalid_filename', message: 'Filename must be a string' } };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { code: 'invalid_filename', message: 'Filename is empty' } };
  }
  if (trimmed.length > 255) {
    return { ok: false, error: { code: 'invalid_filename', message: 'Filename is too long' } };
  }
  if (trimmed.includes('\0')) {
    return { ok: false, error: { code: 'invalid_filename', message: 'Filename contains null byte' } };
  }

  // Decode percent-encoding once and Unicode-normalize so blacklist matching
  // sees the canonical form. Catches `%2e%2e%2fetc%2fpasswd` and
  // `%2essh%2fid_rsa` style payloads that survive the layer above
  // (Codex review §A).
  const decoded = safeDecodeURIComponent(trimmed).normalize('NFKC');
  if (decoded !== trimmed) {
    if (/[\\/]/.test(decoded) || decoded.includes('..')) {
      return {
        ok: false,
        error: {
          code: 'forbidden_path_segment',
          message: 'Filename contains encoded path separators',
        },
      };
    }
  }

  // Detect path separators (forward AND back slash) before splitting — Linux
  // basename() ignores backslashes, so we can't rely on it alone.
  if (/[\\/]/.test(trimmed)) {
    const segments = trimmed.split(/[\\/]/);
    for (const segment of segments) {
      if (segment === '..' || segment === '.') {
        return {
          ok: false,
          error: {
            code: 'forbidden_path_segment',
            message: `Path segment '${segment}' is not allowed`,
          },
        };
      }
      if (FORBIDDEN_NAME_SEGMENTS.has(segment.toLowerCase())) {
        return {
          ok: false,
          error: {
            code: 'forbidden_path_segment',
            message: `Path segment '${segment}' is not allowed`,
          },
        };
      }
    }
    return {
      ok: false,
      error: {
        code: 'forbidden_path_segment',
        message: 'Filename must not contain path separators',
      },
    };
  }

  if (FORBIDDEN_NAME_SEGMENTS.has(trimmed.toLowerCase())) {
    return {
      ok: false,
      error: {
        code: 'forbidden_path_segment',
        message: `Path segment '${trimmed}' is not allowed`,
      },
    };
  }

  // basename() is mostly redundant here since we already rejected separators,
  // but keeps the contract clear: callers always get a single safe segment.
  let cleaned = basename(trimmed);

  // Strip leading dots fully so dotfiles can't masquerade as innocuous names.
  while (cleaned.startsWith('.')) cleaned = cleaned.slice(1);
  if (cleaned.length === 0) {
    return { ok: false, error: { code: 'invalid_filename', message: 'Filename is empty after sanitization' } };
  }
  return { ok: true, value: cleaned };
}

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function guessMimeFromExtension(extension: string): string | undefined {
  return EXTENSION_MIME[extension.toLowerCase()];
}

function classifyMime(mime: string):
  | { ok: true; kind: UploadKind }
  | { ok: false; error: UploadValidationError } {
  if (IMAGE_MIME_TYPES.has(mime)) return { ok: true, kind: 'image' };
  if (DOCUMENT_MIME_TYPES.has(mime)) return { ok: true, kind: 'document' };
  if (DOCUMENT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return { ok: true, kind: 'document' };
  }
  return {
    ok: false,
    error: {
      code: 'unsupported_mime',
      message: `Mime type '${mime}' is not supported`,
    },
  };
}

interface ResolvedLimits {
  imageMaxBytes: number;
  documentMaxBytes: number;
  perSessionQuotaBytes: number;
}

export function resolveLimits(config: UploadValidationConfig | undefined): ResolvedLimits {
  return {
    imageMaxBytes: config?.imageMaxBytes ?? DEFAULT_IMAGE_MAX_BYTES,
    documentMaxBytes: config?.documentMaxBytes ?? DEFAULT_DOCUMENT_MAX_BYTES,
    perSessionQuotaBytes: config?.perSessionQuotaBytes ?? DEFAULT_PER_SESSION_QUOTA_BYTES,
  };
}

function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
