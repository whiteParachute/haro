/** FEAT-004 R6 / AC4 — default example Agent bootstrap. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  DEFAULT_AGENT_FILE,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_SYSTEM_PROMPT,
  bootstrapDefaultAgentFile,
} from '../src/agent/index.js';

describe('bootstrapDefaultAgentFile [FEAT-004 R6]', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'haro-agent-bootstrap-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC4: creates haro-assistant.yaml when agents dir is empty', () => {
    const res = bootstrapDefaultAgentFile(dir);
    expect(res.created).toBe(true);
    expect(res.filePath).toBe(join(dir, DEFAULT_AGENT_FILE));
  });

  it('AC4: systemPrompt is byte-level aligned with §5 constant', () => {
    bootstrapDefaultAgentFile(dir);
    const yamlSource = readFileSync(join(dir, DEFAULT_AGENT_FILE), 'utf8');
    const parsed = parseYaml(yamlSource) as {
      id: string;
      name: string;
      systemPrompt: string;
    };
    expect(parsed.id).toBe(DEFAULT_AGENT_ID);
    expect(parsed.name).toBe(DEFAULT_AGENT_NAME);
    expect(parsed.systemPrompt).toBe(DEFAULT_AGENT_SYSTEM_PROMPT);
  });

  it('is idempotent: no overwrite when the default file already exists', () => {
    const first = bootstrapDefaultAgentFile(dir);
    expect(first.created).toBe(true);
    writeFileSync(first.filePath, '# user-edited\n');
    const second = bootstrapDefaultAgentFile(dir);
    expect(second.created).toBe(false);
    expect(readFileSync(first.filePath, 'utf8')).toBe('# user-edited\n');
  });

  it('does not seed when another yaml file is already present', () => {
    writeFileSync(join(dir, 'other.yaml'), 'id: other\nname: o\nsystemPrompt: p\n');
    const res = bootstrapDefaultAgentFile(dir);
    expect(res.created).toBe(false);
  });

  it('does not seed when any non-YAML marker file is present (.gitkeep, README, …)', () => {
    writeFileSync(join(dir, '.gitkeep'), '');
    const res = bootstrapDefaultAgentFile(dir);
    expect(res.created).toBe(false);
  });
});
