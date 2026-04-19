import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { buildHaroPaths } from '../paths.js';
import type { SelectionContext, SelectionRule, SelectionTarget, ResolvedSelection, ResolvedSelectionCandidate } from './types.js';

const selectionTargetSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    modelSelection: z
      .enum([
        'provider-default',
        'quality-priority',
        'cost-priority',
        'largest-context',
      ])
      .optional(),
  })
  .strict();

const selectionRuleSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    priority: z.number().int(),
    match: z
      .object({
        tags: z.array(z.string()).optional(),
        promptPattern: z.string().optional(),
        estimatedTokens: z
          .object({
            min: z.number().int().positive().optional(),
            max: z.number().int().positive().optional(),
          })
          .partial()
          .optional(),
        agentId: z.string().optional(),
      })
      .partial()
      .default({}),
    select: selectionTargetSchema,
    fallback: z.array(selectionTargetSchema).optional(),
  })
  .strict();

const selectionRulesFileSchema = z
  .object({
    rules: z.array(selectionRuleSchema),
  })
  .strict();

type ModelInfo = {
  id: string;
  created?: number;
  maxContextTokens?: number;
};

interface ProviderWithModels {
  listModels?: () => Promise<readonly ModelInfo[]>;
}

export const DEFAULT_SELECTION_RULES: readonly SelectionRule[] = Object.freeze([
  {
    id: 'code-generation',
    description: '代码生成任务优先使用 Codex 的默认代码模型',
    priority: 10,
    match: {
      tags: ['code', 'coding', 'programming', 'debug', 'refactor'],
      promptPattern: '(写|生成|实现|重构|修复).*(代码|函数|类|模块|脚本)',
    },
    select: {
      provider: 'codex',
      modelSelection: 'provider-default',
    },
    fallback: [{ provider: 'codex', modelSelection: 'largest-context' }],
  },
  {
    id: 'complex-reasoning',
    description: '复杂分析/设计任务优先使用高质量默认模型',
    priority: 20,
    match: {
      tags: ['reasoning', 'analysis', 'design', 'architecture', 'spec'],
      estimatedTokens: { min: 10_000 },
    },
    select: {
      provider: 'codex',
      modelSelection: 'quality-priority',
    },
    fallback: [
      { provider: 'codex', modelSelection: 'largest-context' },
      { provider: 'codex', modelSelection: 'provider-default' },
    ],
  },
  {
    id: 'quick-task',
    description: '快速简单任务优先使用低成本 live 模型',
    priority: 30,
    match: {
      tags: ['quick', 'simple', 'lookup'],
      estimatedTokens: { max: 2_000 },
    },
    select: {
      provider: 'codex',
      modelSelection: 'cost-priority',
    },
    fallback: [{ provider: 'codex', modelSelection: 'provider-default' }],
  },
  {
    id: 'default',
    description: '默认规则：使用 Provider 默认 live 模型',
    priority: 9_999,
    match: {},
    select: {
      provider: 'codex',
      modelSelection: 'provider-default',
    },
    fallback: [{ provider: 'codex', modelSelection: 'largest-context' }],
  },
]);

export async function resolveSelection(
  context: SelectionContext,
): Promise<ResolvedSelection> {
  if (context.agent.defaultProvider || context.agent.defaultModel) {
    return resolveAgentDefaults(context);
  }

  const rules = loadSelectionRules({
    root: context.root,
    projectRoot: context.projectRoot,
  });
  const estimatedTokens = estimateTokens(context.task);
  const tags = inferTaskTags(context.task);
  const chosen =
    rules.find((rule) =>
      ruleMatches(rule, {
        agentId: context.agent.id,
        task: context.task,
        tags,
        estimatedTokens,
      }),
    ) ?? DEFAULT_SELECTION_RULES[DEFAULT_SELECTION_RULES.length - 1];

  const primary = await resolveTarget(chosen.select, context);
  const fallbacks = await resolveFallbacks(chosen.fallback ?? [], context, [primary]);
  return {
    ruleId: chosen.id,
    primary,
    fallbacks,
  };
}

export function loadSelectionRules(input: {
  root?: string;
  projectRoot?: string;
}): readonly SelectionRule[] {
  const globalFile = join(buildHaroPaths(input.root).root, 'selection-rules.yaml');
  const projectFile = input.projectRoot
    ? join(input.projectRoot, '.haro', 'selection-rules.yaml')
    : undefined;
  const globalRules = readRulesFile(globalFile);
  const projectRules = projectFile ? readRulesFile(projectFile) : [];
  return [...projectRules, ...globalRules, ...DEFAULT_SELECTION_RULES].sort(
    (a, b) => a.priority - b.priority,
  );
}

function readRulesFile(path: string): readonly SelectionRule[] {
  if (!existsSync(path)) return [];
  const raw = parseYaml(readFileSync(path, 'utf8'));
  const parsed = selectionRulesFileSchema.parse(raw);
  return parsed.rules;
}

function estimateTokens(task: string): number {
  return Math.max(1, Math.ceil(task.length / 4));
}

function inferTaskTags(task: string): readonly string[] {
  const text = task.toLowerCase();
  const tags = new Set<string>();
  if (/(代码|函数|类|模块|脚本|debug|bug|refactor|fix|implement|code|typescript|python|javascript)/i.test(task)) {
    tags.add('code');
    tags.add('coding');
    tags.add('programming');
    tags.add('debug');
    tags.add('refactor');
  }
  if (/(design|architecture|spec|analy|reason|设计|架构|分析|需求|文档|协议)/i.test(text)) {
    tags.add('reasoning');
    tags.add('analysis');
    tags.add('design');
    tags.add('architecture');
    tags.add('spec');
  }
  if (/(quick|simple|lookup|small|brief|简单|快速|查一下|列出|看看)/i.test(task)) {
    tags.add('quick');
    tags.add('simple');
    tags.add('lookup');
  }
  return [...tags];
}

function ruleMatches(
  rule: SelectionRule,
  input: {
    task: string;
    tags: readonly string[];
    estimatedTokens: number;
    agentId: string;
  },
): boolean {
  const match = rule.match;
  if (match.agentId && match.agentId !== input.agentId) return false;
  if (match.tags && match.tags.length > 0) {
    const tagSet = new Set(input.tags);
    if (!match.tags.some((tag) => tagSet.has(tag))) return false;
  }
  if (match.promptPattern) {
    const pattern = new RegExp(match.promptPattern, 'i');
    if (!pattern.test(input.task)) return false;
  }
  if (match.estimatedTokens?.min !== undefined && input.estimatedTokens < match.estimatedTokens.min) {
    return false;
  }
  if (match.estimatedTokens?.max !== undefined && input.estimatedTokens > match.estimatedTokens.max) {
    return false;
  }
  return true;
}

async function resolveAgentDefaults(
  context: SelectionContext,
): Promise<ResolvedSelection> {
  const source: SelectionTarget = {
    provider: context.agent.defaultProvider ?? 'codex',
  };
  if (context.agent.defaultModel) {
    source.model = context.agent.defaultModel;
  } else {
    source.modelSelection = 'provider-default';
  }
  const primary = await resolveTarget(source, context);
  const fallbacks = await resolveFallbacks(
    [{ provider: source.provider, modelSelection: 'largest-context' }],
    context,
    [primary],
  );
  return {
    ruleId: 'agent-default',
    primary,
    fallbacks,
  };
}

async function resolveFallbacks(
  targets: readonly SelectionTarget[],
  context: SelectionContext,
  seen: readonly ResolvedSelectionCandidate[],
): Promise<readonly ResolvedSelectionCandidate[]> {
  const out: ResolvedSelectionCandidate[] = [];
  const seenKeys = new Set(seen.map(candidateKey));
  for (const target of targets) {
    const candidate = await resolveTarget(target, context);
    const key = candidateKey(candidate);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    out.push(candidate);
  }
  return out;
}

async function resolveTarget(
  target: SelectionTarget,
  context: SelectionContext,
): Promise<ResolvedSelectionCandidate> {
  const provider = context.providerRegistry.get(target.provider);
  const model = await resolveModel(provider as ProviderWithModels, target);
  return {
    provider: target.provider,
    model,
    source: target,
  };
}

async function resolveModel(
  provider: ProviderWithModels,
  target: SelectionTarget,
): Promise<string> {
  if (target.model) return target.model;
  const models = typeof provider.listModels === 'function' ? await provider.listModels() : [];
  if (models.length === 0) {
    return target.modelSelection ?? 'provider-default';
  }
  const strategy = target.modelSelection ?? 'provider-default';
  switch (strategy) {
    case 'largest-context':
      return [...models].sort(compareLargestContext)[0]?.id ?? models[0]!.id;
    case 'quality-priority':
      return [...models].sort(compareQuality)[0]?.id ?? models[0]!.id;
    case 'cost-priority':
      return [...models].sort(compareCost)[0]?.id ?? models[0]!.id;
    case 'provider-default':
    default:
      return models[0]!.id;
  }
}

function compareLargestContext(a: ModelInfo, b: ModelInfo): number {
  const aCtx = a.maxContextTokens ?? -1;
  const bCtx = b.maxContextTokens ?? -1;
  if (aCtx !== bCtx) return bCtx - aCtx;
  return (b.created ?? 0) - (a.created ?? 0);
}

function compareQuality(a: ModelInfo, b: ModelInfo): number {
  const created = (b.created ?? 0) - (a.created ?? 0);
  if (created !== 0) return created;
  return compareLargestContext(a, b);
}

function compareCost(a: ModelInfo, b: ModelInfo): number {
  const aCtx = a.maxContextTokens ?? Number.MAX_SAFE_INTEGER;
  const bCtx = b.maxContextTokens ?? Number.MAX_SAFE_INTEGER;
  if (aCtx !== bCtx) return aCtx - bCtx;
  return (a.created ?? Number.MAX_SAFE_INTEGER) - (b.created ?? Number.MAX_SAFE_INTEGER);
}

function candidateKey(candidate: ResolvedSelectionCandidate): string {
  return `${candidate.provider}::${candidate.model}`;
}
