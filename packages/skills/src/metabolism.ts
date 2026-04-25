import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { buildHaroPaths, createEvolutionAssetRegistry, createMemoryFabric, hashEvolutionAssetContent } from '@haro/core';
import type { EvolutionAssetDraft, EvolutionAssetKind } from '@haro/core';
import type { InstalledSkillsManifest } from './types.js';

const EMPTY_INSTALLED: InstalledSkillsManifest = { version: 1, skills: {} };

interface ArchivedItem {
  scope: 'skills' | 'memory' | 'rules' | 'mcp';
  path: string;
  archivedPath: string;
  risk: 'low' | 'medium' | 'high';
  reason: string;
  rollbackStep: string;
  assetId: string;
  assetDraft: EvolutionAssetDraft;
  skillEntry?: Record<string, unknown>;
}

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
  const evaluation = evaluateEatContent(content, input.root);
  if (evaluation.rejected) {
    return { output: renderEatDecisionResult('eat rejected', evaluation) };
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
  const registry = createEvolutionAssetRegistry({ root: input.root });
  const bundleId = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleRoot = join(paths.dirs.archive, 'eat-proposals', bundleId);
  try {
    mkdirSync(bundleRoot, { recursive: true });
    const memoryPreviewFile = join(bundleRoot, 'memory-preview.md');
    writeFileSync(memoryPreviewFile, buckets.memoryPreview, 'utf8');
    const manifestFile = join(bundleRoot, 'manifest.json');
    const manifest: Record<string, unknown> = {
      sourceKind: detected.kind,
      createdAt: new Date().toISOString(),
      evaluation,
      memoryWrites: [],
      proposals: [],
      suggestions: [],
    };
    const memoryAsset = registry.recordEvent({
      type: 'promoted',
      actor: 'agent',
      asset: {
        kind: 'memory',
        name: buckets.memoryTitle,
        status: 'active',
        sourceRef: `eat:${detected.kind}`,
        contentRef: `memory:agent:haro-assistant:${slug(buckets.memoryTitle)}`,
        contentHash: hashEvolutionAssetContent(buckets.memoryContent),
        createdBy: 'eat',
      },
      evidenceRefs: [memoryPreviewFile],
      metadata: {
        action: 'eat-memory-write',
        bundleId,
        sourceKind: detected.kind,
      },
    });
    const memoryWrite = await memoryFabric.write({
      scope: 'agent',
      agentId: 'haro-assistant',
      topic: buckets.memoryTitle,
      content: buckets.memoryContent,
      source: 'skill:eat',
      assetRef: memoryAsset.assetId,
    });
    (manifest.memoryWrites as Array<unknown>).push({ ...memoryWrite, assetRef: memoryAsset.assetId, eventId: memoryAsset.id });

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
      const event = registry.recordEvent({
        type: 'proposed',
        actor: 'agent',
        asset: {
          kind: proposalAssetKind(proposal.type),
          name: proposalAssetName(proposal.path),
          sourceRef: `eat-proposal:${bundleId}`,
          contentRef: relative(paths.root, proposalFile),
          contentHash: hashEvolutionAssetContent(proposal.content),
          createdBy: 'eat',
        },
        evidenceRefs: [proposalFile, manifestFile],
        metadata: {
          action: 'eat-proposal',
          proposalType: proposal.type,
          bundleId,
          evaluation,
        },
      });
      (manifest.proposals as Array<unknown>).push({
        type: proposal.type,
        path: relative(bundleRoot, proposalFile),
        assetId: event.assetId,
        eventId: event.id,
        eventType: event.type,
      });
    }

    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { output: `eat completed: memory updated, proposal bundle at ${bundleRoot}` };
  } finally {
    registry.close();
  }
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
  const moved: ArchivedItem[] = [];
  const installedFile = join(paths.dirs.skills, 'installed.json');
  const installed = existsSync(installedFile)
    ? (JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledSkillsManifest)
    : { ...EMPTY_INSTALLED };
  const registry = createEvolutionAssetRegistry({ root: input.root });
  try {
    for (const candidate of filtered) {
      const assetDraft = candidateAssetDraft(candidate, paths.root);
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
        assetId: assetDraft.id!,
        assetDraft,
        ...(candidate.skillEntry ? { skillEntry: candidate.skillEntry } : {}),
      });
    }
    writeFileSync(installedFile, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
    const manifestFile = join(archiveRoot, 'manifest.json');
    writeFileSync(manifestFile, `${JSON.stringify({ items: moved }, null, 2)}\n`, 'utf8');
    const archiveAsset = registry.recordEvent({
      assetId: `archive:${archiveId}`,
      type: 'archived',
      actor: 'system',
      status: 'active',
      asset: {
        id: `archive:${archiveId}`,
        kind: 'archive',
        name: archiveId,
        status: 'active',
        sourceRef: `shit:${scope}`,
        contentRef: archiveRoot,
        contentHash: hashEvolutionAssetContent(JSON.stringify({ items: moved })),
        createdBy: 'shit',
      },
      evidenceRefs: [manifestFile],
      metadata: { action: 'archive-created', archiveId, itemCount: moved.length },
    });
    for (const item of moved) {
      registry.recordEvent({
        assetId: item.assetId,
        asset: item.assetDraft,
        type: 'archived',
        actor: 'system',
        contentRef: item.archivedPath,
        evidenceRefs: [manifestFile, item.archivedPath],
        metadata: {
          action: 'shit-archive',
          archiveId,
          archiveAssetId: archiveAsset.assetId,
          risk: item.risk,
          reason: item.reason,
          rollbackStep: item.rollbackStep,
        },
      });
    }
    return { output: renderShitPreview(filtered, false) + `\narchived to ${archiveRoot}` };
  } catch (error) {
    for (const item of moved.reverse()) {
      mkdirSync(dirname(item.path), { recursive: true });
      renameSync(item.archivedPath, item.path);
      if (item.skillEntry) {
        const entry = item.skillEntry;
        installed.skills[String(entry.id)] = entry as never;
      }
    }
    writeFileSync(installedFile, `${JSON.stringify(installed, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    registry.close();
  }
}

export function rollbackShit(input: ShitRollbackInput): { output: string } {
  const paths = buildHaroPaths(input.root);
  const archiveRoot = join(paths.dirs.archive, input.archiveId);
  const manifestFile = join(archiveRoot, 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new Error(`Archive '${input.archiveId}' not found`);
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { items: Array<ArchivedItem> };
  const installedFile = join(paths.dirs.skills, 'installed.json');
  const installed = existsSync(installedFile)
    ? (JSON.parse(readFileSync(installedFile, 'utf8')) as InstalledSkillsManifest)
    : { ...EMPTY_INSTALLED };
  const items = input.item ? manifest.items.filter((item) => item.path === resolve(input.item!)) : manifest.items;
  const registry = createEvolutionAssetRegistry({ root: input.root });
  try {
    for (const item of items) {
      mkdirSync(dirname(item.path), { recursive: true });
      renameSync(item.archivedPath, item.path);
      if (item.skillEntry) {
        installed.skills[String(item.skillEntry.id)] = item.skillEntry as never;
      }
      registry.recordEvent({
        assetId: item.assetId,
        asset: item.assetDraft,
        type: 'rollback',
        actor: 'user',
        contentRef: item.path,
        evidenceRefs: [manifestFile, item.path],
        metadata: {
          action: 'shit-rollback',
          archiveId: input.archiveId,
          restoredPath: item.path,
          archivedPath: item.archivedPath,
        },
      });
    }
  } finally {
    registry.close();
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

function evaluateEatContent(content: string, root: string): {
  rejected: boolean;
  reason?: string;
  qualityGate: Array<{ name: string; pass: boolean; reason: string }>;
  verification: Array<{ name: string; pass: boolean; reason: string }>;
} {
  const lowered = content.toLowerCase();
  const trimmed = content.trim();
  const policyStatements = extractPolicyStatements(content);
  const existingPolicies = collectExistingPolicies(root);
  const entertainmentHit = detectKeyword(lowered, ENTERTAINMENT_KEYWORDS);
  const oneOffHit = detectKeyword(lowered, ONE_OFF_KEYWORDS);
  const lowQualityHit = detectLowQualityContent(content);
  const genericKnowledgeHit = detectGenericKnowledge(lowered);
  const conflictHit = findMatchingPolicy(policyStatements, existingPolicies, 'conflict');
  const equivalentHit = findMatchingPolicy(policyStatements, existingPolicies, 'equivalent');
  const inferableHit = detectInferableFromCodebase(lowered, root);
  const failureBacked = /because|otherwise|avoid|prevents?|so that|failure|bug|incident|risk|rollback|否则|避免|防止|失败|出错|风险|因为/i.test(content);
  const toolEnforceable = /(eslint|prettier|format|formatter|lint|linter|ci check|typecheck|schema|compile|tsc|unit test|integration test|snapshot|eslint-disable|格式化|lint|类型检查|编译器|测试覆盖)/i.test(content);
  const decisionEncoded = /must|always|never|should|because|prefer|avoid|rule|principle|policy|decision|必须|总是|不要|禁止|原则|规则|决策/i.test(content);
  const triggerable = /workflow|rule|principle|policy|when|if|steps?:|场景|步骤|触发|规则|工作流|出现|遇到/i.test(content);

  const qualityGate = [
    {
      name: 'not-entertainment',
      pass: entertainmentHit === undefined,
      reason: entertainmentHit ? `matched entertainment marker '${entertainmentHit}'` : 'no entertainment-only marker detected',
    },
    {
      name: 'not-one-off',
      pass: oneOffHit === undefined,
      reason: oneOffHit ? `matched one-off marker '${oneOffHit}'` : 'no one-off marker detected',
    },
    {
      name: 'not-generic-knowledge',
      pass: genericKnowledgeHit === undefined,
      reason: genericKnowledgeHit ?? 'does not look like already-known generic knowledge',
    },
    {
      name: 'not-low-quality',
      pass: lowQualityHit === undefined,
      reason: lowQualityHit ?? 'content has enough signal for review',
    },
    {
      name: 'not-too-small',
      pass: trimmed.length >= 20,
      reason: trimmed.length >= 20 ? `content length ${trimmed.length} >= 20` : `content length ${trimmed.length} < 20`,
    },
    {
      name: 'not-conflicting-with-existing',
      pass: conflictHit === undefined,
      reason: conflictHit ? `conflicts with ${conflictHit.source}: ${conflictHit.text}` : 'no conflicting existing rule/skill detected',
    },
    {
      name: 'not-equivalent-to-existing',
      pass: equivalentHit === undefined,
      reason: equivalentHit ? `duplicates ${equivalentHit.source}: ${equivalentHit.text}` : 'no equivalent existing rule/skill detected',
    },
    {
      name: 'not-inferable-from-codebase',
      pass: inferableHit === undefined,
      reason: inferableHit ?? 'does not look directly inferable from repository structure/tooling',
    },
  ];

  const verification = [
    {
      name: 'Failure-backed?',
      pass: failureBacked,
      reason: failureBacked ? 'contains explicit failure/risk causality' : 'no concrete failure/risk consequence found',
    },
    {
      name: 'Tool-enforceable?',
      pass: !toolEnforceable,
      reason: toolEnforceable ? 'looks enforceable by linter/CI/type system' : 'not obviously tool-enforceable',
    },
    {
      name: 'Decision-encoding?',
      pass: decisionEncoded,
      reason: decisionEncoded ? 'encodes a non-trivial behavioral decision' : 'does not encode a clear decision beyond generic description',
    },
    {
      name: 'Triggerable?',
      pass: triggerable,
      reason: triggerable ? 'contains an explicit trigger/workflow context' : 'no clear trigger/workflow context found',
    },
  ];

  const failedGate = qualityGate.find((item) => !item.pass);
  if (failedGate) {
    return {
      rejected: true,
      reason: failedGate.name,
      qualityGate,
      verification,
    };
  }

  if (verification.every((item) => !item.pass)) {
    return {
      rejected: true,
      reason: 'four-questions-all-fail',
      qualityGate,
      verification,
    };
  }

  return {
    rejected: false,
    qualityGate,
    verification,
  };
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

function proposalAssetKind(type: 'claude' | 'rules' | 'skills'): EvolutionAssetKind {
  if (type === 'skills') return 'skill';
  if (type === 'rules') return 'routing-rule';
  return 'prompt';
}

function proposalAssetName(path: string): string {
  return path
    .replace(/[\\/]SKILL\.md$/, '')
    .replace(/\.md$/, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .join(':') || 'proposal';
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

function candidateAssetDraft(
  candidate: ReturnType<typeof collectShitCandidates>[number],
  root: string,
): EvolutionAssetDraft {
  const kind = candidateScopeToAssetKind(candidate.scope);
  const relativePath = relative(root, candidate.path);
  const name = candidate.skillId ?? relativePath;
  return {
    id: candidate.skillId ? `skill:${candidate.skillId}` : `${kind}:${stablePathId(relativePath)}`,
    kind,
    name,
    status: 'active',
    sourceRef: `shit-scan:${candidate.scope}`,
    contentRef: candidate.path,
    contentHash: hashFileOrPath(candidate.path),
    createdBy: 'migration',
  };
}

function candidateScopeToAssetKind(scope: 'skills' | 'memory' | 'rules' | 'mcp'): EvolutionAssetKind {
  switch (scope) {
    case 'skills':
      return 'skill';
    case 'memory':
      return 'memory';
    case 'rules':
      return 'routing-rule';
    case 'mcp':
      return 'mcp';
  }
}

function hashFileOrPath(path: string): string {
  if (!existsSync(path)) return hashEvolutionAssetContent(path);
  const stat = statSync(path);
  if (stat.isDirectory()) {
    const skillFile = join(path, 'SKILL.md');
    return hashEvolutionAssetContent(existsSync(skillFile) ? readFileSync(skillFile) : path);
  }
  return hashEvolutionAssetContent(readFileSync(path));
}

function stablePathId(path: string): string {
  const safe = path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'asset';
  return safe;
}

function renderEatPreview(kind: string, buckets: ReturnType<typeof buildEatBuckets>, evaluation: ReturnType<typeof evaluateEatContent>): string {
  return [
    `eat preview (${kind})`,
    `memory: ${buckets.memoryTitle}`,
    `proposals: ${buckets.proposals.map((item) => `${item.type}:${item.path}`).join(', ') || 'none'}`,
    'quality gate:',
    ...evaluation.qualityGate.map((item) => `- ${item.name}: ${item.pass ? 'pass' : 'fail'} — ${item.reason}`),
    'four questions:',
    ...evaluation.verification.map((item) => `- ${item.name}: ${item.pass ? 'pass' : 'fail'} — ${item.reason}`),
    `decision: ${evaluation.rejected ? `reject (${evaluation.reason})` : 'accept'}`,
  ].join('\n');
}

function renderEatDecisionResult(prefix: string, evaluation: ReturnType<typeof evaluateEatContent>): string {
  return [
    `${prefix}: ${evaluation.reason ?? 'unknown'}`,
    'quality gate:',
    ...evaluation.qualityGate.map((item) => `- ${item.name}: ${item.pass ? 'pass' : 'fail'} — ${item.reason}`),
    'four questions:',
    ...evaluation.verification.map((item) => `- ${item.name}: ${item.pass ? 'pass' : 'fail'} — ${item.reason}`),
    `decision: reject (${evaluation.reason ?? 'unknown'})`,
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

const ENTERTAINMENT_KEYWORDS = ['joke', 'meme', 'funny', 'entertainment', '娱乐', '搞笑', '段子', '梗图', '八卦', '玩笑'] as const;
const ONE_OFF_KEYWORDS = ['one-off', 'just this once', 'today only', 'temporary', 'for this ticket', '一次性', '临时', '仅这次', '只此一次', '今天先这样'] as const;
const MODAL_PATTERNS: Array<{ label: 'positive' | 'negative'; regex: RegExp }> = [
  { label: 'negative', regex: /\b(never|do not|don't|avoid|forbid|forbidden|禁止|不要|不可)\b/i },
  { label: 'positive', regex: /\b(must|always|should|require|required|必须|总是|应当|需要)\b/i },
];
const STRIP_POLICY_WORDS = /\b(rule|workflow|principle|policy|decision|must|always|never|should|because|if|when|avoid|do not|don't|require|required)\b|规则|工作流|原则|策略|决策|必须|总是|不要|禁止|因为|如果|当|避免|需要/gi;

function detectKeyword(content: string, keywords: readonly string[]): string | undefined {
  return keywords.find((keyword) => content.includes(keyword));
}

function detectLowQualityContent(content: string): string | undefined {
  const trimmed = content.trim();
  if (trimmed.length < 20) return 'too short to assess durable value';
  if (/lorem ipsum|todo|tbd|待补充|随便写写|差不多得了/i.test(content)) return 'contains placeholder / low-confidence wording';
  const uncertaintyMatches = content.match(/\?\?+|maybe|probably|可能|也许|大概/gi) ?? [];
  if (uncertaintyMatches.length >= 2) return 'contains repeated uncertainty without durable rule content';
  return undefined;
}

function detectGenericKnowledge(content: string): string | undefined {
  if (/(python|javascript|typescript|java|go|rust).*(syntax|hello world|variables?|loops?|conditions?|functions?|classes?|基础语法|hello world|变量|循环|条件|函数|类)/i.test(content)) {
    return 'matches language basics / hello-world style generic knowledge';
  }
  if (/(design pattern|oop|面向对象|设计模式|基础概念)/i.test(content) && !/(because|workflow|incident|must|always|必须|规则)/i.test(content)) {
    return 'matches generic concept without task-specific decision context';
  }
  return undefined;
}

function detectInferableFromCodebase(content: string, root: string): string | undefined {
  const hints: string[] = [];
  if (existsSync(join(root, 'package.json')) && /\b(node|javascript|typescript)\b/i.test(content)) hints.push('package.json');
  if (existsSync(join(root, 'pnpm-workspace.yaml')) && /\b(pnpm|workspace|monorepo)\b/i.test(content)) hints.push('pnpm-workspace.yaml');
  if (existsSync(join(root, 'packages')) && /(packages\/|目录结构|monorepo|workspace)/i.test(content)) hints.push('packages/');
  if (existsSync(join(root, 'vitest.config.ts')) && /\bvitest\b/i.test(content)) hints.push('vitest.config.ts');
  if ((existsSync(join(root, 'eslint.config.js')) || existsSync(join(root, '.eslintrc')) || existsSync(join(root, '.eslintrc.js'))) && /\b(eslint|lint|代码风格|linter)\b/i.test(content)) {
    hints.push('eslint config');
  }
  return hints.length > 0 ? `repo-visible convention/tooling matched (${hints.join(', ')})` : undefined;
}

function extractPolicyStatements(content: string): Array<{ text: string; signature: string; polarity: 'positive' | 'negative' | 'neutral' }> {
  return content
    .split(/\r?\n|[。！？.!?]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => /(must|always|never|should|because|avoid|rule|workflow|principle|policy|步骤|规则|工作流|原则|必须|不要|禁止)/i.test(line))
    .map((line) => ({
      text: line,
      signature: normalizePolicy(line),
      polarity: detectPolarity(line),
    }))
    .filter((line) => line.signature.length > 0);
}

function collectExistingPolicies(root: string): Array<{ source: string; text: string; signature: string; polarity: 'positive' | 'negative' | 'neutral' }> {
  const policies: Array<{ source: string; text: string; signature: string; polarity: 'positive' | 'negative' | 'neutral' }> = [];
  const rulesRoot = join(root, 'rules');
  if (existsSync(rulesRoot)) {
    for (const file of walk(rulesRoot)) {
      const text = readFileSync(file, 'utf8');
      for (const statement of extractPolicyStatements(text)) {
        policies.push({ source: relative(root, file), ...statement });
      }
    }
  }
  const skillsRoot = join(root, 'skills');
  if (existsSync(skillsRoot)) {
    for (const file of walk(skillsRoot)) {
      if (!file.endsWith('SKILL.md')) continue;
      const text = readFileSync(file, 'utf8');
      for (const statement of extractPolicyStatements(text)) {
        policies.push({ source: relative(root, file), ...statement });
      }
    }
  }
  return policies;
}

function findMatchingPolicy(
  candidates: Array<{ text: string; signature: string; polarity: 'positive' | 'negative' | 'neutral' }>,
  existing: Array<{ source: string; text: string; signature: string; polarity: 'positive' | 'negative' | 'neutral' }>,
  mode: 'conflict' | 'equivalent',
): { source: string; text: string } | undefined {
  for (const candidate of candidates) {
    for (const known of existing) {
      if (!samePolicySignature(candidate.signature, known.signature)) continue;
      if (mode === 'equivalent' && candidate.polarity === known.polarity) {
        return { source: known.source, text: known.text };
      }
      if (mode === 'conflict' && candidate.polarity !== 'neutral' && known.polarity !== 'neutral' && candidate.polarity !== known.polarity) {
        return { source: known.source, text: known.text };
      }
    }
  }
  return undefined;
}

function detectPolarity(line: string): 'positive' | 'negative' | 'neutral' {
  for (const pattern of MODAL_PATTERNS) {
    if (pattern.regex.test(line)) return pattern.label;
  }
  return 'neutral';
}

function normalizePolicy(line: string): string {
  return line
    .toLowerCase()
    .replace(STRIP_POLICY_WORDS, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function samePolicySignature(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length >= 12 && (left.includes(right) || right.includes(left))) return true;
  const leftTokens = left.split(' ').filter(Boolean);
  const rightTokens = right.split(' ').filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length) >= 0.7;
}
