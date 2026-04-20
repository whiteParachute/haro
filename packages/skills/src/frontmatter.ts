import type { SkillDescriptor } from './types.js';

export function parseSkillFile(content: string, fallbackId: string): SkillDescriptor {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(content);
  const meta = match ? parseSimpleYaml(match[1] ?? '') : {};
  return {
    id: typeof meta.name === 'string' && meta.name.length > 0 ? meta.name : fallbackId,
    description: typeof meta.description === 'string' ? meta.description : '',
    content,
  };
}

function parseSimpleYaml(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    out[match[1]] = stripQuotes(match[2]);
  }
  return out;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
