import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/agent/index.js';
import { ProviderRegistry, type AgentProvider, type AgentEvent } from '../src/provider/index.js';
import { resolveSelection } from '../src/runtime/index.js';

class MockSelectionProvider implements AgentProvider {
  readonly id = 'codex';

  constructor(
    private readonly models: ReadonlyArray<{
      id: string;
      created?: number;
      maxContextTokens?: number;
    }>,
  ) {}

  async *query(): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: 'unused in selection test' };
  }

  capabilities() {
    return {
      streaming: false,
      toolLoop: false,
      contextCompaction: false,
      contextContinuation: true,
    } as const;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async listModels(): Promise<
    ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>
  > {
    return this.models;
  }
}

function registerTestAgent() {
  const registry = new AgentRegistry();
  registry.register({
    id: 'haro-assistant',
    name: 'Haro Assistant',
    systemPrompt: 'You are helpful.',
  });
  return registry;
}

function registerProvider(
  models: ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>,
) {
  const registry = new ProviderRegistry();
  registry.register(new MockSelectionProvider(models));
  return registry;
}

function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'haro-selection-'));
}

describe('resolveSelection [FEAT-005 R1]', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers project rules over global/default rules and resolves live models', async () => {
    const root = makeTempRoot();
    roots.push(root);
    const projectRoot = join(root, 'workspace');
    mkdirSync(join(projectRoot, '.haro'), { recursive: true });

    writeFileSync(
      join(root, 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: global-default',
        '    priority: 10',
        '    match: {}',
        '    select:',
        '      provider: codex',
        '      modelSelection: provider-default',
        '',
      ].join('\n'),
      'utf8',
    );

    writeFileSync(
      join(projectRoot, '.haro', 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: project-design',
        '    priority: 1',
        '    match:',
        '      tags: [design]',
        '    select:',
        '      provider: codex',
        '      modelSelection: largest-context',
        '',
      ].join('\n'),
      'utf8',
    );

    const selection = await resolveSelection({
      task: '请分析这个系统 design tradeoff 并给出文档建议',
      agent: registerTestAgent().get('haro-assistant'),
      providerRegistry: registerProvider([
        { id: 'codex-small', created: 1, maxContextTokens: 8_000 },
        { id: 'codex-large', created: 2, maxContextTokens: 128_000 },
      ]),
      root,
      projectRoot,
    });

    expect(selection.ruleId).toBe('project-design');
    expect(selection.primary.provider).toBe('codex');
    expect(selection.primary.model).toBe('codex-large');
  });

  it('lets agent defaults override rules and keep explicit model pins', async () => {
    const root = makeTempRoot();
    roots.push(root);

    const selection = await resolveSelection({
      task: '实现一个 helper 函数',
      agent: {
        id: 'specialist',
        name: 'Specialist',
        systemPrompt: 'Pinned provider/model',
        defaultProvider: 'codex',
        defaultModel: 'codex-pinned',
      },
      providerRegistry: registerProvider([
        { id: 'codex-small', created: 1, maxContextTokens: 8_000 },
        { id: 'codex-large', created: 2, maxContextTokens: 128_000 },
      ]),
      root,
    });

    expect(selection.ruleId).toBe('agent-default');
    expect(selection.primary).toMatchObject({
      provider: 'codex',
      model: 'codex-pinned',
    });
    expect(selection.fallbacks[0]).toMatchObject({
      provider: 'codex',
      model: 'codex-large',
    });
  });
});
