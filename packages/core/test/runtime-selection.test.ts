import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/agent/index.js';
import { ProviderRegistry, type AgentProvider } from '../src/provider/index.js';
import { resolveSelection, SelectionResolutionError } from '../src/runtime/index.js';

class TestProvider implements AgentProvider {
  readonly id: string;
  private readonly models: ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }>;

  constructor(
    id: string,
    models: ReadonlyArray<{ id: string; created?: number; maxContextTokens?: number }> = [],
  ) {
    this.id = id;
    this.models = models;
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

  async *query(): AsyncGenerator<never, void, void> {
    return;
  }
}

describe('resolveSelection [FEAT-005 R1]', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('prefers project rules over global rules and resolves live model selection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-selection-root-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'haro-selection-project-'));
    tempRoots.push(root, projectRoot);

    writeFileSync(
      join(root, 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: global-spec-rule',
        '    priority: 10',
        '    match:',
        '      promptPattern: "spec"',
        '    select:',
        '      provider: global-provider',
        '      modelSelection: provider-default',
      ].join('\n'),
      'utf8',
    );
    mkdirSync(join(projectRoot, '.haro'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.haro', 'selection-rules.yaml'),
      [
        'rules:',
        '  - id: project-spec-rule',
        '    priority: 10',
        '    match:',
        '      promptPattern: "spec"',
        '    select:',
        '      provider: project-provider',
        '      modelSelection: largest-context',
        '    fallback:',
        '      - provider: project-provider',
        '        modelSelection: provider-default',
      ].join('\n'),
      'utf8',
    );

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: 'haro-assistant',
      name: 'Haro Assistant',
      systemPrompt: 'helpful',
    });

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(
      new TestProvider('project-provider', [
        { id: 'project-default', created: 1, maxContextTokens: 16_000 },
        { id: 'project-large', created: 2, maxContextTokens: 128_000 },
      ]),
    );
    providerRegistry.register(
      new TestProvider('global-provider', [{ id: 'global-default', created: 1, maxContextTokens: 8_000 }]),
    );

    const selection = await resolveSelection({
      task: '请根据 spec 生成执行建议',
      agent: agentRegistry.get('haro-assistant'),
      providerRegistry,
      root,
      projectRoot,
      config: {},
    });

    expect(selection.ruleId).toBe('project-spec-rule');
    expect(selection.primary).toMatchObject({
      provider: 'project-provider',
      model: 'project-large',
    });
    expect(selection.fallbacks).toEqual([
      expect.objectContaining({
        provider: 'project-provider',
        model: 'project-default',
      }),
    ]);
  });

  it('rejects defaultModel without defaultProvider instead of silently defaulting to codex', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: 'haro-assistant',
      name: 'Haro Assistant',
      systemPrompt: 'helpful',
      defaultModel: 'gpt-5.4',
    });

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(new TestProvider('codex', [{ id: 'gpt-5.4', created: 1 }]));

    await expect(
      resolveSelection({
        task: 'run with invalid defaults',
        agent: agentRegistry.get('haro-assistant'),
        providerRegistry,
        config: {},
      }),
    ).rejects.toMatchObject({
      name: 'SelectionResolutionError',
      message: expect.stringContaining('without a defaultProvider'),
    });
  });

  it('rejects provider-default selection when listModels returns no concrete models', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: 'haro-assistant',
      name: 'Haro Assistant',
      systemPrompt: 'helpful',
    });

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register(new TestProvider('codex', []));

    await expect(
      resolveSelection({
        task: '简单查询',
        agent: agentRegistry.get('haro-assistant'),
        providerRegistry,
        config: {},
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SelectionResolutionError>>({
        name: 'SelectionResolutionError',
        providerId: 'codex',
      }),
    );
  });
});
