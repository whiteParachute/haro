import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildHaroPaths, createMemoryFabric } from '@haro/core';
import type { InstalledSkillsManifest } from './types.js';

const EMPTY_INSTALLED: InstalledSkillsManifest = { version: 1, skills: {} };

export interface EatCommandInput {
  input: string;
  root: string;
  yes?: boolean;
  as?: 'url' | 'path' | 'text';
  deep?: boolean;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export interface ShitCommandInput {
  root: string;
  scope?: 'rules' | 'skills' | 'mcp' | 'memory' | 'all';
  days?: number;
  dryRun?: boolean;
  confirmHigh?: boolean;
}

export interface ShitRollbackInput {
  root: string;
  archiveId: string;
  item?: string;
}

export async function runEat(input: EatCommandInput): Promise<{ output: string }> {
  const stdout = input.stdout ?? process.stdout;
  const detected = detectEatInput(input.input, input.as);
  const content = await loadEatContent(detected, input.deep === true);
  const evaluation = evaluateEatContent(content);
  if (evaluation.rejected) {
    return { output: `eat rejected: ${evaluation.reason}` };
  }
  const buckets = buildEatBuckets(content);
  const preview = renderEatPreview(detected.kind, buckets, evaluation);
  stdout.write(`${preview}\n`);
  if (!input.yes) {
    const approved = await confirm(input.stdin ?? process.stdin, stdout, 'Apply eat changes? [y/N] ');
    if (!approved) {
      return { output: 'eat cancelled by user.' };
    }
  }
  const paths = buildHaroPaths(input.root);
  const memoryFabric = createMemoryFabric({ root: paths.dirs.memory });
  const bundleId = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleRoot = join(paths.dirs.archive, 'eat-proposals', bundleId);
  mkdirSync(bundleRoot, { recursive: true });
  writeFileSync(join(bundleRoot, 'memory-preview.md'), buckets.memoryPreview, 'utf8');
  const manifest: Record<string, unknown> = {
    sourceKind: detected.kind,
    createdAt: new Date().toISOString(),
    evaluation,
    memoryWrites: [],
    proposals: [],
    suggestions: [],
  };
  const memoryWrite = await memoryFabric.write({
    scope: 'agent',
    agentId: 'haro-assistant',
    topic: buckets.memoryTitle,
    content: buckets.memoryContent,
    source: 'skill:eat',
  });
  (manifest.memoryWrites as Array<unknown>).push(memoryWrite);

  for (const proposal of buckets.proposals) {
    const limit = proposal.type === 'claude' ? 200 : proposal.type === 'rules' ? 99 : 499;
    if (proposal.lines > limit) {
      (manifest.suggestions as Array<unknown>).push({
        type: proposal.type,
        reason: `proposal too large (${proposal.lines} lines > ${limit})`,
        suggestion: `split ${proposal.type} proposal into smaller files`,
      });
      continue;
    }
    const proposalFile = join(bundleRoot, proposal.type, proposal.path);
    mkdirSync(dirname(proposalFile), { recursive: true });
    writeFileSync(proposalFile, proposal.content, 'utf8');
    (manifest.proposals as Array<unknown>).push({ type: proposal.type, path: relative(bundleRoot, proposalFile) });
  }

  writeFileSync(join(bundleRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { output: `eat completed: memory updated, proposal bundle at ${bundleRoot}` };
}

export function runShit(input: ShitCommandInput): { output: string } {
  const paths = buildHaroPaths(input.root);
  const scope = input.scope ?? 'all';
  const days = input.days ?? 90;
  const now = Date.now();
  const candidates = collectShitCandidates(paths.root, scope, days, now);
  const filtered = candidates.filter((candidate) => !candidate.whitelisted);
  if (input.dryRun) {
    return { output: renderShitPreview(filtered, true) };
  }
  const high = filtered.filter((candidate) => candidate.risk === 'high');
  if (high.length > 0 && input.confirmHigh !== true) {
    return { output: 'shit blocked: high risk candidates require --confirm-high' };
  }
  const archiveId = `shit-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const archiveRoot = join(paths.dirs.archive, archiveId);
  mkdirSync(archiveRoot, { recursive: true });
  const moved: Array<Record<string, unknown>> = [];
  const installedFile = join(paths.dirs.skills, 'installed.json');
  const installed = existsSync(installedFile)
    ? (JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledSkillsManifest)
    : { ...EMPTY_INSTALLED };
  try {
    for (const candidate of filtered) {
      const target = join(archiveRoot, candidate.scope, relative(paths.root, candidate.path));
      mkdirSync(dirname(target), { recursive: true });
      renameSync(candidate.path, target);
      if (candidate.scope === 'skills' && candidate.skillId) {
        delete installed.skills[candidate.skillId];
      }
      moved.push({
        scope: candidate.scope,
        path: candidate.path,
        archivedPath: target,
        risk: candidate.risk,
        reason: candidate.reason,
        rollbackStep: `restore ${target} -> ${candidate.path}`,
        ...(candidate.skillEntry ? { skillEntry: candidate.skillEntry } : {}),
      });
    }
    writeFileSync(installedFile, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
    writeFileSync(join(archiveRoot, 'manifest.json'), `${JSON.stringify({ items: moved }, null, 2)}\n`, 'utf8');
    return { output: renderShitPreview(filtered, false) + `\narchived to ${archiveRoot}` };
  } catch (error) {
    for (const item of moved.reverse()) {
      mkdirSync(dirname(item.path as string), { recursive: true });
      renameSync(item.archivedPath as string, item.path as string);
      if ((item as { skillEntry?: unknown }).skillEntry) {
        const entry = (item as { skillEntry: Record<string, unknown> }).skillEntry;
        installed.skills[String(entry.id)] = entry as never;
      }
    }
    writeFileSync(installedFile, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
    throw error;
  }
}

export function rollbackShit(input: ShitRollbackInput): { output: string } {
  const paths = buildHaroPaths(input.root);
  const archiveRoot = join(paths.dirs.archive, input.archiveId);
  const manifestFile = join(archiveRoot, 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new Error(`Archive '${input.archiveId}' not found`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { items: Array<{ path: string; archivedPath: string; skillEntry?: Record<string, unknown> }> };
  const installedFile = join(paths.dirs.skills, 'installed.json');
  const installed = existsSync(installedFile)
    ? (JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledSkillsManifest)
    : { ...EMPTY_INSTALLED };
  const items = input.item ? manifest.items.filter((item) => item.path === resolve(input.item!)) : manifest.items;
  for (const item of items) {
    mkdirSync(dirname(item.path), { recursive: true });
    renameSync(item.archivedPath, item.path);
    if (item.skillEntry) {
      installed.skills[String(item.skillEntry.id)] = item.skillEntry as never;
    }
  }
  writeFileSync(installedFile, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
  return { output: `rollback restored ${items.length} item(s) from ${input.archiveId}` };
}

function detectEatInput(input: string, forced?: 'url' | 'path' | 'text') {
  if (forced) return { kind: forced, value: input } as const;
  if (/^https?:\/\//.test(input)) return { kind: 'url', value: input } as const;
  if (existsSync(input)) return { kind: 'path', value: resolve(input) } as const;
  if (input.includes('\n') || input.length > 256) return { kind: 'text', value: input } as const;
  throw new Error('eat input is ambiguous; use --as url|path|text');
}

async function loadEatContent(input: { kind: 'url' | 'path' | 'text'; value: string }, deep: boolean): Promise<string> {
  if (input.kind === 'text') return input.value;
  if (input.kind === 'path') {
    const stat = statSync(input.value);
    if (stat.isDirectory()) {
      const files = readdirSync(input.value).filter((name) => /^(README|readme|Readme)|\.md$/i.test(name));
      const chosen = files.slice(0, deep ? files.length : 1).map((name) => readFileSync(join(input.value, name), 'utf8'));
      return chosen.join('\n\n');
    }
    return readFileSync(input.value, 'utf8');
  }
  const githubRepo = parseGitHubRepoUrl(input.value);
  if (githubRepo) {
    return loadGitHubRepoText(githubRepo.owner, githubRepo.repo, deep);
  }
  const response = await fetch(input.value);
  const type = response.headers.get('content-type') ?? '';
  if (!/text\/(html|plain|markdown)|application\/json/.test(type)) {
    throw new Error(`eat rejects non-text content: ${type || 'unknown'}`);
  }
  const text = await response.text();
  return /text\/html/.test(type) ? stripHtml(text) : text;
}

function evaluateEatContent(content: string): { rejected: boolean; reason?: string; checks: Array<{ name: string; pass: boolean }> } {
  const lowered = content.toLowerCase();
  const checks = [
    { name: 'not-generic-knowledge', pass: !(lowered.includes('python') && (lowered.includes('syntax') || lowered.includes('hello world') || lowered.includes('基础语法'))) },
    { name: 'not-too-small', pass: content.trim().length >= 20 },
    { name: 'has-failure-backed-detail', pass: /must|always|because|workflow|rule|principle/i.test(content) },
    { name: 'has-triggerable-context', pass: /workflow|rule|principle|skill|步骤|场景/i.test(content) },
  ];
  const failed = checks.find((item) => !item.pass);
  return failed ? { rejected: true, reason: failed.name, checks } : { rejected: false, checks };
}

function buildEatBuckets(content: string) {
  const lines = content.split(/\r?\n/);
  const title = firstMeaningfulLine(lines) ?? 'eat-note';
  const summaryBlock = lines.slice(0, 8).join('\n').trim();
  const proposals: Array<{ type: 'claude' | 'rules' | 'skills'; path: string; content: string; lines: number }> = [];
  if (/principle|philosophy|原则/i.test(content)) {
    const body = `# ${title}\n\n${summaryBlock}\n`;
    proposals.push({ type: 'claude', path: 'principles.md', content: body, lines: body.split(/\r?\n/).length });
  }
  if (/rule:|policy|must|always/i.test(content)) {
    const body = `# ${title}\n\n${content.trim()}\n`;
    proposals.push({ type: 'rules', path: `${slug(title)}.md`, content: body, lines: body.split(/\r?\n/).length });
  }
  if (/workflow|skill|steps?:/i.test(content)) {
    const skillBody = `---\nname: ${slug(title)}\ndescription: "Imported proposal from eat"\n---\n\n${content.trim()}\n`;
    proposals.push({ type: 'skills', path: `${slug(title)}/SKILL.md`, content: skillBody, lines: skillBody.split(/\r?\n/).length });
  }
  return {
    memoryTitle: title,
    memoryContent: summaryBlock,
    memoryPreview: `# Memory Preview\n\n${summaryBlock}\n`,
    proposals,
  };
}

function collectShitCandidates(root: string, scope: ShitCommandInput['scope'], days: number, now: number) {
  const scopes = scope === 'all' ? ['skills', 'memory', 'rules', 'mcp'] : [scope ?? 'all'];
  const threshold = now - days * 24 * 60 * 60 * 1000;
  const paths = buildHaroPaths(root);
  const installedFile = join(paths.dirs.skills, 'installed.json');
  const installed = existsSync(installedFile)
    ? (JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledSkillsManifest)
    : { version: 1, skills: {} };
  const candidates: Array<{ scope: 'skills' | 'memory' | 'rules' | 'mcp'; path: string; risk: 'low' | 'medium' | 'high'; reason: string; whitelisted: boolean; skillId?: string; skillEntry?: Record<string, unknown> }> = [];
  if (scopes.includes('skills')) {
    for (const entry of Object.values(installed.skills)) {
      if (entry.isPreinstalled) continue;
      const stale = existsSync(entry.path) ? statSync(entry.path).mtimeMs < threshold : true;
      candidates.push({
        scope: 'skills',
        path: entry.path,
        risk: entry.enabled ? 'high' : 'low',
        reason: stale ? 'stale user skill' : 'enabled but selected for review',
        whitelisted: false,
        skillId: entry.id,
        skillEntry: entry as unknown as Record<string, unknown>,
      });
    }
  }
  if (scopes.includes('memory')) {
    const memoryRoot = paths.dirs.memory;
    if (existsSync(memoryRoot)) {
      for (const file of walk(memoryRoot)) {
        if (file.endsWith('platform/index.md')) continue;
        if (statSync(file).mtimeMs < threshold) {
          candidates.push({ scope: 'memory', path: file, risk: 'low', reason: 'stale memory file', whitelisted: false });
        }
      }
    }
  }
  if (scopes.includes('rules')) {
    const rulesRoot = join(root, 'rules');
    if (existsSync(rulesRoot)) {
      for (const file of walk(rulesRoot)) {
        const text = readFileSync(file, 'utf8');
        candidates.push({ scope: 'rules', path: file, risk: text.includes('@core') ? 'high' : 'low', reason: 'rule candidate', whitelisted: text.includes('@core') });
      }
    }
  }
  if (scopes.includes('mcp')) {
    const mcpRoot = join(root, 'mcp-servers');
    if (existsSync(mcpRoot)) {
      for (const file of walk(mcpRoot)) {
        candidates.push({ scope: 'mcp', path: file, risk: 'low', reason: 'mcp candidate', whitelisted: false });
      }
    }
  }
  return candidates;
}

function renderEatPreview(kind: string, buckets: ReturnType<typeof buildEatBuckets>, evaluation: ReturnType<typeof evaluateEatContent>): string {
  return [
    `eat preview (${kind})`,
    `memory: ${buckets.memoryTitle}`,
    `proposals: ${buckets.proposals.map((item) => `${item.type}:${item.path}`).join(', ') || 'none'}`,
    `checks: ${evaluation.checks.map((item) => `${item.name}=${item.pass ? 'pass' : 'fail'}`).join(', ')}`,
  ].join('\n');
}

function renderShitPreview(candidates: Array<{ scope: string; path: string; risk: string; reason: string }>, dryRun: boolean): string {
  const lines = candidates.map((candidate) => `${candidate.scope}\t${candidate.risk}\t${candidate.path}\t${candidate.reason}`);
  return `${dryRun ? 'shit dry-run' : 'shit execute'}\n${lines.join('\n')}`.trim();
}

async function confirm(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, prompt: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: false });
  try {
    stdout.write(prompt);
    const iter = rl[Symbol.asyncIterator]();
    const next = await iter.next();
    return !next.done && /^y(es)?$/i.test(next.value.trim());
  } finally {
    rl.close();
  }
}

function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function stripHtml(input: string): string {
  return input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseGitHubRepoUrl(value: string): { owner: string; repo: string } | undefined {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/.exec(value);
  if (!match) return undefined;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, '') };
}

async function loadGitHubRepoText(owner: string, repo: string, deep: boolean): Promise<string> {
  const candidates = [
    `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
  ];
  const texts: string[] = [];
  for (const candidate of candidates) {
    const response = await fetch(candidate);
    if (response.ok) {
      texts.push(await response.text());
      break;
    }
  }
  if (deep) {
    for (const candidate of [
      `https://raw.githubusercontent.com/${owner}/${repo}/main/docs/README.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/docs/README.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/src/index.ts`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/src/index.ts`,
    ]) {
      const response = await fetch(candidate);
      if (response.ok) {
        texts.push(await response.text());
      }
    }
  }
  if (texts.length === 0) {
    throw new Error(`Unable to load README for GitHub repo ${owner}/${repo}`);
  }
  return texts.join('\n\n');
}

function firstMeaningfulLine(lines: string[]): string | undefined {
  return lines.map((line) => line.trim()).find((line) => line.length > 0);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'proposal';
}
