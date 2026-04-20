import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HaroConfig, LoadedConfig } from '@haro/core/config';
import type { HaroPaths, ProviderRegistry } from '@haro/core';

export interface SetupRunDeps {
  nodeVersion?: string;
  env?: NodeJS.ProcessEnv;
  runCommand?: (
    command: string,
    args: readonly string[],
  ) => { status: number | null; stdout?: string | null; stderr?: string | null; error?: Error };
}

export interface SetupReport {
  ok: boolean;
  text: string;
  persisted: boolean;
}

export async function runSetup(input: {
  paths: HaroPaths;
  loaded: LoadedConfig;
  providerRegistry: ProviderRegistry;
  deps?: SetupRunDeps;
}): Promise<SetupReport> {
  const deps = input.deps ?? {};
  const nodeVersion = deps.nodeVersion ?? process.version;
  const env = deps.env ?? process.env;
  const runCommand =
    deps.runCommand ??
    ((command: string, args: readonly string[]) =>
      spawnSync(command, args, { encoding: 'utf8' }));

  const nodeOk = isSupportedNode(nodeVersion);
  const pnpmCheck = runCommand('pnpm', ['--version']);
  const pnpmVersion = pnpmCheck.stdout?.trim() ?? '';
  const pnpmOk = pnpmCheck.status === 0 && pnpmVersion.length > 0;
  const rootWritable = await isWritable(input.paths.root);
  const apiKeyPresent = typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 0;

  const existingModel = input.loaded.config.providers?.codex?.defaultModel;
  const selectedModel =
    existingModel ??
    (apiKeyPresent ? await resolveDefaultModel(input.providerRegistry).catch(() => undefined) : undefined);

  let persisted = false;
  if (rootWritable) {
    persisted = persistSetupConfig({
      paths: input.paths,
      config: input.loaded.config,
      selectedModel,
    });
  }

  const blockers: string[] = [];
  if (!nodeOk) blockers.push(`Node.js 版本不满足要求（当前 ${nodeVersion}，需要 >= 22）`);
  if (!pnpmOk) blockers.push('未检测到可用的 pnpm');
  if (!rootWritable) blockers.push(`数据目录不可写：${input.paths.root}`);
  if (!apiKeyPresent) blockers.push('未检测到 OPENAI_API_KEY');

  const checks = [
    renderCheck('Node.js >= 22', nodeOk, nodeVersion),
    renderCheck('pnpm 可用', pnpmOk, pnpmVersion || '未检测到版本'),
    renderCheck('Haro 数据目录可写', rootWritable, input.paths.root),
    renderCheck('OPENAI_API_KEY 已设置', apiKeyPresent, apiKeyPresent ? '已检测到环境变量' : '缺失'),
    renderCheck(
      '默认 Provider',
      true,
      'codex（Phase 0 当前唯一正式实现的 Provider）',
    ),
    renderCheck(
      '默认 Model',
      selectedModel !== undefined,
      selectedModel ?? '保留为空；待补齐 OPENAI_API_KEY 后可再次执行 setup',
    ),
  ];

  const nextSteps = [
    `node packages/cli/bin/haro.js doctor`,
    `node packages/cli/bin/haro.js run "列出当前目录下的 TypeScript 文件"`,
    `node packages/cli/bin/haro.js channel setup feishu`,
  ];

  const lines = [
    'Haro setup / onboard',
    '',
    '检查结果：',
    ...checks.map((item) => `- ${item}`),
    '',
    `配置文件：${input.paths.configFile}`,
    persisted
      ? '- 已写入非敏感默认配置'
      : '- 未写入配置（请先修复数据目录可写性）',
  ];

  if (blockers.length > 0) {
    lines.push('', '阻塞项：', ...blockers.map((item) => `- ${item}`));
    if (!apiKeyPresent) {
      lines.push('- 修复示例：export OPENAI_API_KEY=<your-key>');
    }
  }

  lines.push('', '下一步：', ...nextSteps.map((item, index) => `${index + 1}. ${item}`));

  return {
    ok: blockers.length === 0,
    text: `${lines.join('\n')}\n`,
    persisted,
  };
}

async function resolveDefaultModel(
  providerRegistry: ProviderRegistry,
): Promise<string | undefined> {
  const provider = providerRegistry.get('codex') as {
    listModels?: () => Promise<readonly { id: string }[]>;
  };
  if (typeof provider.listModels !== 'function') return undefined;
  const models = await provider.listModels();
  return models[0]?.id;
}

function persistSetupConfig(input: {
  paths: HaroPaths;
  config: HaroConfig;
  selectedModel?: string;
}): boolean {
  input.config.providers ??= {};
  input.config.providers.codex ??= {};
  if (input.selectedModel) {
    input.config.providers.codex.defaultModel = input.selectedModel;
  }

  mkdirSync(dirname(input.paths.configFile), { recursive: true });
  const text = `${JSON.stringify(input.config, null, 2)}\n`;
  writeFileSync(input.paths.configFile, text, 'utf8');
  return true;
}

function renderCheck(label: string, ok: boolean, detail: string): string {
  return `${ok ? 'OK' : 'FAIL'} ${label} — ${detail}`;
}

function isSupportedNode(version: string): boolean {
  const match = /^v?(\d+)/.exec(version);
  const major = match ? Number.parseInt(match[1] ?? '0', 10) : 0;
  return major >= 22;
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
