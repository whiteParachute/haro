import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATION_POLICIES,
  OPERATION_CLASSES,
  PermissionBudgetStore,
  classifyOperation,
  createWorkflowBudgetEstimate,
  resolveOperationPolicy,
  resolveStrictestPermissionDecision,
} from '../src/index.js';

describe('PermissionBudgetGuard [FEAT-023]', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('AC1 resolves default operation policies and denies delete/credential', () => {
    for (const operationClass of OPERATION_CLASSES) {
      const decision = resolveOperationPolicy({ operationClass });
      expect(decision.policy).toBe(DEFAULT_OPERATION_POLICIES[operationClass]);
    }

    expect(resolveOperationPolicy({ operationClass: 'delete' }).policy).toBe('deny');
    expect(resolveOperationPolicy({ operationClass: 'credential' }).policy).toBe('deny');
    expect(resolveOperationPolicy({ operationClass: 'archive' }).policy).toBe('needs-approval');
    expect(resolveOperationPolicy({ operationClass: 'budget-increase' }).policy).toBe('needs-approval');
  });

  it('classifies write-local target scope as workspace, haro-state, or outside-workspace', () => {
    const workspaceRoot = '/tmp/haro-workspace';
    const haroRoot = '/tmp/haro-home';

    expect(
      classifyOperation({
        targetPath: '/tmp/haro-workspace/src/index.ts',
        workspaceRoot,
        haroRoot,
      }),
    ).toMatchObject({ operationClass: 'write-local', targetScope: 'workspace' });
    expect(
      classifyOperation({
        targetPath: '/tmp/haro-home/channels/cli/state.json',
        workspaceRoot,
        haroRoot,
      }),
    ).toMatchObject({ operationClass: 'write-local', targetScope: 'haro-state' });
    expect(
      classifyOperation({
        targetPath: '/etc/passwd',
        workspaceRoot,
        haroRoot,
      }),
    ).toMatchObject({ operationClass: 'write-local', targetScope: 'outside-workspace' });
    expect(
      classifyOperation({
        targetPaths: [
          '/tmp/haro-workspace/src/index.ts',
          '/tmp/haro-home/channels/cli/state.json',
          '/etc/passwd',
        ],
        workspaceRoot,
        haroRoot,
      }),
    ).toMatchObject({
      operationClass: 'write-local',
      targetScope: 'outside-workspace',
      targetRef: '/tmp/haro-workspace/src/index.ts,/tmp/haro-home/channels/cli/state.json,/etc/passwd',
    });
  });

  it('preserves write-local target scope in audit records', () => {
    const root = freshRoot(tempRoots);
    const store = new PermissionBudgetStore({
      root,
      createId: createIdFactory(['audit-write-scope']),
    });
    const classification = classifyOperation({
      operationClass: 'write-local',
      targetPath: '/etc/passwd',
      workspaceRoot: '/tmp/haro-workspace',
      haroRoot: root,
    });
    const decision = resolveOperationPolicy({
      classification,
      minimumPolicy: 'needs-approval',
    });

    store.recordPermissionDecision({
      workflowId: 'workflow-write-scope',
      decision,
      targetRef: classification.targetRef,
    });
    const summary = store.readWorkflowPermissionBudgetSummary('workflow-write-scope');

    expect(summary.audit.events[0]).toMatchObject({
      targetScope: 'outside-workspace',
      targetRef: '/etc/passwd',
      outcome: 'needs-approval',
    });
    store.close();
  });

  it('AC7 keeps shit archive confirmation stricter than a generic allow decision', () => {
    const guardDecision = resolveOperationPolicy({
      operationClass: 'archive',
      approvalRef: 'cli:--confirm-high',
    });

    const finalDecision = resolveStrictestPermissionDecision(guardDecision, 'needs-approval');

    expect(guardDecision.policy).toBe('allow');
    expect(finalDecision.policy).toBe('needs-approval');
    expect(finalDecision.reason).toContain('stricter runtime policy');
  });

  it('AC8 writes audit and skips execution for unapproved external-service writes', () => {
    const root = freshRoot(tempRoots);
    const store = new PermissionBudgetStore({
      root,
      createId: createIdFactory(['audit-external']),
    });
    let executed = false;
    const classification = classifyOperation({
      externalService: 'feishu',
      intent: 'write message',
    });
    const decision = resolveOperationPolicy({ classification });
    store.recordPermissionDecision({
      workflowId: 'workflow-permission',
      decision,
      targetRef: classification.targetRef,
    });
    if (decision.policy === 'allow') executed = true;

    const summary = store.readWorkflowPermissionBudgetSummary('workflow-permission');

    expect(decision.policy).toBe('needs-approval');
    expect(executed).toBe(false);
    expect(summary.permissions.needsApproval).toBe(1);
    expect(summary.audit.events[0]).toMatchObject({
      eventType: 'permission-decision',
      operationClass: 'external-service',
      outcome: 'needs-approval',
      targetRef: 'feishu',
    });
    store.close();
  });

  it('tracks budget soft limit, hard limit, and ledger summary', () => {
    const root = freshRoot(tempRoots);
    const store = new PermissionBudgetStore({
      root,
      createId: createIdFactory(['ledger-1', 'audit-near', 'ledger-2', 'audit-exceeded', 'audit-check']),
    });
    const estimate = createWorkflowBudgetEstimate({
      workflowId: 'workflow-budget',
      decision: { executionMode: 'team', workflowTemplateId: 'parallel-research' },
      sceneDescriptor: { complexity: 'complex' },
      limitTokens: 100,
      softLimitRatio: 0.5,
    });

    store.ensureWorkflowBudget({ workflowId: 'workflow-budget', estimate });
    store.recordTokenUsage({
      workflowId: 'workflow-budget',
      budgetId: estimate.budgetId,
      branchId: 'branch-a',
      agentId: 'agent-a',
      provider: 'codex',
      model: 'gpt-test',
      inputTokens: 30,
      outputTokens: 25,
    });
    const near = store.checkBeforeBudgetedAction({
      workflowId: 'workflow-budget',
      budgetId: estimate.budgetId,
      branchId: 'branch-b',
      action: 'branch-attempt',
    });
    store.recordTokenUsage({
      workflowId: 'workflow-budget',
      budgetId: estimate.budgetId,
      branchId: 'branch-b',
      agentId: 'agent-b',
      provider: 'codex',
      model: 'gpt-test',
      inputTokens: 50,
      outputTokens: 0,
    });
    const hard = store.checkBeforeBudgetedAction({
      workflowId: 'workflow-budget',
      budgetId: estimate.budgetId,
      branchId: 'branch-c',
      action: 'retry',
    });
    const summary = store.readWorkflowPermissionBudgetSummary('workflow-budget');

    expect(near.allowed).toBe(true);
    expect(near.state).toBe('near-limit');
    expect(hard.allowed).toBe(false);
    expect(hard.state).toBe('exceeded');
    expect(summary.ledger.entries.map((entry) => entry.branchId)).toEqual(['branch-a', 'branch-b']);
    expect(summary.ledger.totalTokens).toBe(105);
    expect(summary.budgetExceeded).toBe(true);
    expect(summary.blockedReason).toContain('token budget exceeded');
    expect(summary.audit.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['budget-near-limit', 'budget-exceeded']),
    );
    store.close();
  });
});

function freshRoot(tempRoots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'haro-permission-budget-'));
  tempRoots.push(root);
  return root;
}

function createIdFactory(ids: string[]) {
  let index = 0;
  return () => ids[index++] ?? `generated-${index}`;
}
