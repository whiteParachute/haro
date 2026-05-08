import { describe, expect, it } from 'vitest';
import {
  AssetEventSchema,
  EvolutionProposalSchema,
  ValidationReportSchema,
  createFakeAgentDockSource,
} from '../src/index.js';

const now = '2026-05-08T04:00:00.000Z';

const validRef = { id: 'ref-001', kind: 'observation', uri: 'fake://ref/001' };

const validProposal = {
  id: 'proposal-001',
  title: 'Tune sidecar prompt wording',
  status: 'dry-run',
  level: 'L0',
  targetKind: 'prompt',
  riskLevel: 'low',
  sourceObservationRefs: [validRef],
  changeSet: [
    {
      op: 'update',
      targetRef: { id: 'prompt-default', kind: 'prompt' },
      contentRef: 'file://proposal/prompt-default.md',
      contentHash: 'sha256:abc123',
      summary: 'Clarify Haro sidecar boundary',
    },
  ],
  testPlan: {
    requiredCommands: ['git diff --check'],
    manualChecks: ['Review wording'],
    regressionRisks: ['Docs drift'],
  },
  rollbackPlan: {
    strategy: 'restore previous prompt content',
    snapshotRequired: true,
    rollbackRefs: [{ id: 'snapshot-001', kind: 'snapshot' }],
  },
  createdAt: now,
  updatedAt: now,
};

describe('AgentDock sidecar contract schemas [FEAT-043]', () => {
  it('accepts observation batches from the fake AgentDock source', () => {
    const source = createFakeAgentDockSource();

    const batch = source.collectObservationBatch();

    expect(batch.connectionId).toBe('fake-agentdock');
    expect(batch.sessions).toHaveLength(1);
    expect(batch.toolCalls[0]?.toolName).toBe('send_message');
  });

  it('rejects an evolution proposal without a rollback plan', () => {
    const { rollbackPlan: _rollbackPlan, ...withoutRollback } = validProposal;

    const result = EvolutionProposalSchema.safeParse(withoutRollback);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'rollbackPlan')).toBe(true);
    }
  });

  it('rejects applyEligible validation reports when rollback is not ready', () => {
    const result = ValidationReportSchema.safeParse({
      id: 'validation-001',
      proposalId: 'proposal-001',
      riskVerdict: 'low',
      requiredTests: ['git diff --check'],
      rollbackReady: false,
      applyEligible: true,
      blockingReasons: [],
      evidenceRefs: [],
      createdAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('rollbackReady');
    }
  });

  it('rejects asset events with an empty content hash', () => {
    const result = AssetEventSchema.safeParse({
      id: 'event-001',
      assetId: 'asset-001',
      kind: 'skill',
      version: '1.0.0',
      sourceRef: { id: 'proposal-001', kind: 'proposal' },
      contentRef: { id: 'skill-001', kind: 'file', uri: 'file://skill.md' },
      contentHash: '',
      status: 'proposed',
      eventType: 'proposed',
      actor: 'haro',
      createdAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'contentHash')).toBe(true);
    }
  });

  it('accepts a valid dry-run proposal fixture', () => {
    expect(EvolutionProposalSchema.parse(validProposal).id).toBe('proposal-001');
  });

  it('rejects memory as a Haro-owned proposal target', () => {
    const result = EvolutionProposalSchema.safeParse({
      ...validProposal,
      targetKind: 'memory',
      changeSet: [
        {
          op: 'update',
          targetRef: { id: 'memory-entry-001', kind: 'memory' },
          contentRef: 'agentdock://memory/entry-001',
          contentHash: 'sha256:memory',
          summary: 'Attempt to mutate AgentDock-owned memory',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'targetKind')).toBe(true);
    }
  });
});
