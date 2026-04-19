/**
 * Minimal YAML-ish frontmatter read/write. We only serialize the fields that
 * Memory Fabric itself writes (strings, arrays of strings, numbers, bools).
 * Deliberately narrow: pulling in `yaml` for this trivial case would pay a
 * parse cost we do not need.
 */

export interface Frontmatter {
  [key: string]: string | number | boolean | readonly string[] | null | undefined;
}

export function serializeFrontmatter(data: Frontmatter): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else lines.push(`${key}:\n${value.map((v) => `  - ${yamlString(String(v))}`).join('\n')}`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlString(String(value))}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

export interface SplitResult {
  frontmatter: Frontmatter;
  body: string;
}

export function splitFrontmatter(text: string): SplitResult {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { frontmatter: {}, body: text };
  }
  const rest = text.slice(4);
  const terminator = rest.indexOf('\n---');
  if (terminator === -1) return { frontmatter: {}, body: text };
  const head = rest.slice(0, terminator);
  const body = rest.slice(terminator + 4).replace(/^\r?\n/, '');
  return { frontmatter: parseFrontmatter(head), body };
}

function parseFrontmatter(head: string): Frontmatter {
  const data: Record<string, string | readonly string[]> = {};
  const lines = head.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentArr: string[] | null = null;
  for (const raw of lines) {
    if (raw.length === 0) continue;
    if (currentArr && /^\s+-\s/.test(raw)) {
      currentArr.push(raw.replace(/^\s+-\s/, '').trim().replace(/^"|"$/g, ''));
      continue;
    }
    if (currentKey && currentArr) {
      data[currentKey] = currentArr;
      currentKey = null;
      currentArr = null;
    }
    const m = /^([A-Za-z0-9_\-]+):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const [, key, value] = m;
    if (!key) continue;
    if (value === '' || value === undefined) {
      currentKey = key;
      currentArr = [];
    } else if (value === '[]') {
      data[key] = [];
    } else {
      data[key] = value.replace(/^"|"$/g, '');
    }
  }
  if (currentKey && currentArr) data[currentKey] = currentArr;
  return data as Frontmatter;
}

function yamlString(s: string): string {
  if (/[:#\-\n"']/.test(s)) return JSON.stringify(s);
  return s;
}
