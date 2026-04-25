import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildHaroPaths, createMemoryFabric } from '@haro/core';
import type { MemoryFabric } from '@haro/core';
import { parseSkillFile } from './frontmatter.js';
import { rollbackShit, runEat, runShit, type EatCommandInput, type ShitCommandInput, type ShitRollbackInput } from './metabolism.js';
import { SkillUsageTracker } from './usage-tracker.js';
import type {
  InstalledSkillsManifest,
  RuntimeSkillSyncItem,
  RuntimeSkillSyncOptions,
  RuntimeSkillSyncResult,
  RuntimeSkillSyncRuntime,
  SkillCommandResult,
  SkillDescriptor,
  SkillManifestEntry,
  SkillPrepareResult,
  SkillResolution,
} from './types.js';

const RESOURCE_ROOT = resolve(__dirname, '..', 'resources');
const PREINSTALLED_ROOT = join(RESOURCE_ROOT, 'preinstalled');
const PREINSTALLED_MANIFEST = join(RESOURCE_ROOT, 'preinstalled-manifest.json');

export interface SkillsManagerOptions {
  root: string;
  now?: () => Date;
}

export class SkillsManager {
  readonly root: string;
  readonly paths: ReturnType<typeof buildHaroPaths>;
  readonly skillsRoot: string;
  readonly preinstalledRoot: string;
  readonly userRoot: string;
  readonly installedFile: string;
  readonly usageFile: string;
  readonly preinstalledManifestFile: string;
  private readonly now: () => Date;
  private readonly usage: SkillUsageTracker;
  private readonly memoryFabric: MemoryFabric;

  constructor(options: SkillsManagerOptions) {
    this.root = options.root;
    this.paths = buildHaroPaths(options.root);
    this.skillsRoot = this.paths.dirs.skills;
    this.preinstalledRoot = join(this.skillsRoot, 'preinstalled');
    this.userRoot = join(this.skillsRoot, 'user');
    this.installedFile = join(this.skillsRoot, 'installed.json');
    this.usageFile = join(this.skillsRoot, 'usage.sqlite');
    this.preinstalledManifestFile = join(this.skillsRoot, 'preinstalled-manifest.json');
    this.now = options.now ?? (() => new Date());
    mkdirSync(this.preinstalledRoot, { recursive: true });
    mkdirSync(this.userRoot, { recursive: true });
    this.usage = new SkillUsageTracker(this.usageFile);
    this.memoryFabric = createMemoryFabric({ root: this.paths.dirs.memory });
  }

  ensureInitialized(): void {
    const preinstalled = this.readBundledPreinstalledManifest();
    for (const entry of Object.values(preinstalled.skills)) {
      const target = join(this.preinstalledRoot, entry.id);
      if (!existsSync(target)) {
        cpSync(join(PREINSTALLED_ROOT, entry.id), target, { recursive: true });
      }
    }
    writeFileSync(this.preinstalledManifestFile, `${JSON.stringify(preinstalled, null, 2)}\n`, 'utf8');
    const manifest = this.readInstalledManifest();
    for (const entry of Object.values(preinstalled.skills)) {
      manifest.skills[entry.id] = {
        ...entry,
        path: join(this.preinstalledRoot, entry.id),
        installedAt: manifest.skills[entry.id]?.installedAt ?? this.now().toISOString(),
        enabled: manifest.skills[entry.id]?.enabled ?? true,
      };
    }
    this.writeInstalledManifest(manifest);
  }

  list(): SkillManifestEntry[] {
    this.ensureInitialized();
    return Object.values(this.readInstalledManifest().skills).sort((a, b) => a.id.localeCompare(b.id));
  }

  info(skillId: string): SkillManifestEntry & { descriptor: SkillDescriptor } {
    this.ensureInitialized();
    const entry = this.requireEntry(skillId);
    return {
      ...entry,
      descriptor: this.readDescriptor(entry.path, entry.id),
    };
  }

  enable(skillId: string): SkillManifestEntry {
    this.ensureInitialized();
    const manifest = this.readInstalledManifest();
    const entry = manifest.skills[skillId];
    if (!entry) throw new Error(`Skill '${skillId}' not installed`);
    entry.enabled = true;
    this.writeInstalledManifest(manifest);
    return entry;
  }

  disable(skillId: string): SkillManifestEntry {
    this.ensureInitialized();
    const manifest = this.readInstalledManifest();
    const entry = manifest.skills[skillId];
    if (!entry) throw new Error(`Skill '${skillId}' not installed`);
    entry.enabled = false;
    this.writeInstalledManifest(manifest);
    return entry;
  }

  uninstall(skillId: string): SkillManifestEntry {
    this.ensureInitialized();
    const manifest = this.readInstalledManifest();
    const entry = manifest.skills[skillId];
    if (!entry) throw new Error(`Skill '${skillId}' not installed`);
    if (entry.isPreinstalled) {
      throw new Error('预装 skill 不可卸载');
    }
    rmSync(entry.path, { recursive: true, force: true });
    delete manifest.skills[skillId];
    this.writeInstalledManifest(manifest);
    return entry;
  }

  install(source: string): SkillManifestEntry {
    this.ensureInitialized();
    if (source.startsWith('marketplace:')) {
      throw new Error('Phase 0 仅保留 marketplace:<name> 命令框架，尚未接入实际 marketplace 下载');
    }
    if (looksLikeGitUrl(source)) {
      return this.installFromGit(source);
    }
    return this.installFromPath(source);
  }

  installFromPath(sourcePath: string): SkillManifestEntry {
    const originalPath = resolve(sourcePath);
    const realPath = realpathSync(originalPath);
    const descriptor = this.readDescriptor(realPath, basenameId(realPath));
    const manifest = this.readInstalledManifest();
    const target = join(this.userRoot, descriptor.id);
    rmSync(target, { recursive: true, force: true });
    cpSync(realPath, target, { recursive: true });
    const next: SkillManifestEntry = {
      id: descriptor.id,
      source: 'user',
      originalSource: originalPath,
      pinnedCommit: 'local-path',
      license: 'unknown',
      installedAt: this.now().toISOString(),
      isPreinstalled: false,
      enabled: true,
      path: target,
      description: descriptor.description,
      ...(lstatSync(originalPath).isSymbolicLink() ? { resolvedFrom: realPath } : {}),
    };
    manifest.skills[descriptor.id] = next;
    this.writeInstalledManifest(manifest);
    return next;
  }

  installFromGit(gitUrl: string): SkillManifestEntry {
    const tempDir = mkdtempSync(join(tmpdir(), 'haro-skill-git-'));
    try {
      execFileSync('git', ['clone', '--depth', '1', gitUrl, tempDir], { stdio: 'ignore' });
      const entry = this.installFromPath(tempDir);
      const manifest = this.readInstalledManifest();
      manifest.skills[entry.id] = {
        ...manifest.skills[entry.id]!,
        originalSource: gitUrl,
        pinnedCommit: safeGitRev(tempDir) ?? safeGitRemoteHead(gitUrl) ?? 'git-head',
      };
      this.writeInstalledManifest(manifest);
      return manifest.skills[entry.id]!;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  syncRuntimeSkills(options: RuntimeSkillSyncOptions = {}): RuntimeSkillSyncResult {
    this.ensureInitialized();
    const runtimes = options.runtimes ?? ['codex'];
    const skillIds = expandRuntimeSkillSelection(options.skill ?? 'metabolism');
    const items: RuntimeSkillSyncItem[] = [];

    for (const runtime of runtimes) {
      const runtimeHome = options.homes?.[runtime] ?? defaultRuntimeHome();
      for (const skillId of skillIds) {
        const sourcePath = join(PREINSTALLED_ROOT, skillId);
        if (!existsSync(sourcePath)) {
          throw new Error(`Bundled preinstalled skill '${skillId}' not found`);
        }
        const targetPath = join(runtimeHome, 'skills', skillId);
        items.push(syncRuntimeSkillDirectory({ runtime, skillId, sourcePath, targetPath, overwrite: options.overwrite ?? false, now: this.now }));
      }
    }

    return { items, hasConflicts: items.some((item) => item.status === 'conflict') };
  }

  resolveSkill(task: string): SkillResolution | undefined {
    this.ensureInitialized();
    const explicit = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(task.trim());
    const manifest = this.readInstalledManifest();
    if (explicit) {
      const skillId = explicit[1]!;
      const entry = manifest.skills[skillId];
      if (!entry || !entry.enabled) return undefined;
      return { skillId, args: explicit[2] ?? '', trigger: 'explicit' };
    }

    const normalized = task.trim();
    let best: { entry: SkillManifestEntry; score: number } | undefined;
    for (const entry of Object.values(manifest.skills)) {
      if (!entry.enabled) continue;
      const score = (entry.keywords ?? []).reduce((count, keyword) => count + (normalized.includes(keyword) ? 1 : 0), 0);
      if (!best || score > best.score) {
        best = { entry, score };
      }
    }
    if (!best || best.score === 0) return undefined;
    return { skillId: best.entry.id, args: normalized, trigger: 'description' };
  }

  async prepareTask(task: string, context: { agentId: string }): Promise<SkillPrepareResult> {
    const resolved = this.resolveSkill(task);
    if (!resolved) {
      return { finalTask: task };
    }
    const entry = this.requireEntry(resolved.skillId);
    this.usage.record(entry, this.now().toISOString());
    const descriptor = this.readDescriptor(entry.path, entry.id);
    const skillArgs = resolved.args.trim();
    switch (entry.handler) {
      case 'memory-remember': {
        await this.memoryFabric.write({ scope: 'agent', agentId: context.agentId, topic: firstLine(skillArgs || 'remembered-note'), content: skillArgs || task, source: 'skill:remember' });
        if (resolved.trigger === 'description') {
          return { matchedSkillId: entry.id, trigger: resolved.trigger, finalTask: task };
        }
        return { matchedSkillId: entry.id, trigger: resolved.trigger, directOutput: `已记录到 memory：${skillArgs || task}` };
      }
      case 'memory-query': {
        const result = this.memoryFabric.query({ scope: 'agent', agentId: context.agentId, query: skillArgs || task, limit: 5 });
        return {
          matchedSkillId: entry.id,
          trigger: resolved.trigger,
          directOutput: result.hits.length === 0 ? 'memory 中没有匹配结果。' : result.hits.map((hit, index) => `${index + 1}. ${hit.summary}`).join('\n'),
        };
      }
      case 'memory-status': {
        const stats = this.memoryFabric.stats();
        return { matchedSkillId: entry.id, trigger: resolved.trigger, directOutput: JSON.stringify(stats, null, 2) };
      }
      case 'memory-maintain': {
        const report = await this.memoryFabric.maintenance({});
        return { matchedSkillId: entry.id, trigger: resolved.trigger, directOutput: JSON.stringify(report, null, 2) };
      }
      case 'memory-wrapup': {
        await this.memoryFabric.deposit({ scope: 'agent', agentId: context.agentId, content: skillArgs || task, source: 'skill:memory-wrapup', wrapupId: this.now().toISOString(), summary: firstLine(skillArgs || task) });
        return { matchedSkillId: entry.id, trigger: resolved.trigger, directOutput: '已生成 memory wrapup 存档。' };
      }
      default: {
        const stripped = resolved.trigger === 'explicit' ? skillArgs : task;
        const instruction = [descriptor.content, '', '---', '', stripped].join('\n');
        return { matchedSkillId: entry.id, trigger: resolved.trigger, finalTask: instruction };
      }
    }
  }

  getUsage(skillId: string) {
    return this.usage.get(skillId);
  }

  async invokeCommandSkill(
    skillId: 'eat' | 'shit',
    input: Omit<EatCommandInput, 'root'> | Omit<ShitCommandInput, 'root'> | Omit<ShitRollbackInput, 'root'>,
  ): Promise<SkillCommandResult> {
    this.ensureInitialized();
    const entry = this.requireEntry(skillId);
    this.usage.record(entry, this.now().toISOString());
    if (skillId === 'eat') {
      return runEat({ ...(input as Omit<EatCommandInput, 'root'>), root: this.root });
    }
    if ('archiveId' in input) {
      return rollbackShit({ ...(input as Omit<ShitRollbackInput, 'root'>), root: this.root });
    }
    return runShit({ ...(input as Omit<ShitCommandInput, 'root'>), root: this.root });
  }

  close(): void {
    this.usage.close();
  }

  private requireEntry(skillId: string): SkillManifestEntry {
    const manifest = this.readInstalledManifest();
    const entry = manifest.skills[skillId];
    if (!entry) throw new Error(`Skill '${skillId}' not installed`);
    return entry;
  }

  private readDescriptor(skillPath: string, fallbackId: string): SkillDescriptor {
    const file = join(skillPath, 'SKILL.md');
    const content = readFileSync(file, 'utf8');
    return parseSkillFile(content, fallbackId);
  }

  private readInstalledManifest(): InstalledSkillsManifest {
    if (!existsSync(this.installedFile)) {
      return { version: 1, skills: {} };
    }
    return JSON.parse(readFileSync(this.installedFile, 'utf8')) as InstalledSkillsManifest;
  }

  private writeInstalledManifest(manifest: InstalledSkillsManifest): void {
    mkdirSync(dirname(this.installedFile), { recursive: true });
    writeFileSync(this.installedFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  private readBundledPreinstalledManifest(): InstalledSkillsManifest {
    return JSON.parse(readFileSync(PREINSTALLED_MANIFEST, 'utf8')) as InstalledSkillsManifest;
  }
}

function basenameId(skillPath: string): string {
  return skillPath.split(/[\\/]/).filter(Boolean).at(-1) ?? 'skill';
}

function expandRuntimeSkillSelection(skill: RuntimeSkillSyncOptions['skill']): Array<'eat' | 'shit'> {
  if (skill === 'shit') return ['shit'];
  return ['eat', 'shit'];
}

function defaultRuntimeHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

function syncRuntimeSkillDirectory(input: {
  runtime: RuntimeSkillSyncRuntime;
  skillId: 'eat' | 'shit';
  sourcePath: string;
  targetPath: string;
  overwrite: boolean;
  now: () => Date;
}): RuntimeSkillSyncItem {
  const expectedFiles = listRelativeFiles(input.sourcePath);
  const conflictingFiles = existsSync(input.targetPath)
    ? expectedFiles.filter((file) => {
        const sourceFile = join(input.sourcePath, file);
        const targetFile = join(input.targetPath, file);
        return existsSync(targetFile) && readFileSync(targetFile, 'utf8') !== readFileSync(sourceFile, 'utf8');
      })
    : [];

  if (conflictingFiles.length > 0 && !input.overwrite) {
    return {
      runtime: input.runtime,
      skillId: input.skillId,
      status: 'conflict',
      targetPath: input.targetPath,
      message: `Target skill differs from canonical source: ${conflictingFiles.join(', ')}`,
    };
  }

  let backupPath: string | undefined;
  if (conflictingFiles.length > 0 && input.overwrite) {
    backupPath = uniqueBackupPath(input.targetPath, input.now);
    mkdirSync(dirname(backupPath), { recursive: true });
    renameSync(input.targetPath, backupPath);
  }

  const unchanged =
    existsSync(input.targetPath) &&
    expectedFiles.every((file) => {
      const targetFile = join(input.targetPath, file);
      return existsSync(targetFile) && readFileSync(targetFile, 'utf8') === readFileSync(join(input.sourcePath, file), 'utf8');
    });

  if (unchanged) {
    return { runtime: input.runtime, skillId: input.skillId, status: 'unchanged', targetPath: input.targetPath };
  }

  mkdirSync(dirname(input.targetPath), { recursive: true });
  cpSync(input.sourcePath, input.targetPath, { recursive: true });
  return { runtime: input.runtime, skillId: input.skillId, status: 'synced', targetPath: input.targetPath, ...(backupPath ? { backupPath } : {}) };
}

function listRelativeFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      for (const nested of listRelativeFiles(absolute)) {
        files.push(join(entry, nested));
      }
    } else {
      files.push(entry);
    }
  }
  return files.sort();
}

function uniqueBackupPath(targetPath: string, now: () => Date): string {
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  let candidate = `${targetPath}.backup-${stamp}`;
  let index = 1;
  while (existsSync(candidate)) {
    candidate = `${targetPath}.backup-${stamp}-${index}`;
    index += 1;
  }
  return candidate;
}

function looksLikeGitUrl(source: string): boolean {
  return /^https?:\/\//.test(source) || source.startsWith('git@') || source.startsWith('file://');
}

function safeGitRev(directory: string): string | undefined {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}

function safeGitRemoteHead(gitUrl: string): string | undefined {
  const result = spawnSync('git', ['ls-remote', gitUrl, 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return undefined;
  }
  const [sha] = result.stdout.trim().split(/\s+/);
  return sha && sha.length > 0 ? sha : undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0) ?? 'memory-entry';
}
