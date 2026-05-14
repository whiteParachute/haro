import { describe, expect, it } from 'vitest';
import {
  ApplicationRecordSchema,
  AssetEventSchema,
  EvolutionProposalSchema,
  FrontierSignalSchema,
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

  it('accepts a ready L0/L1 application gate record without applying content', () => {
    const record = ApplicationRecordSchema.parse({
      id: 'application-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'ready',
      gateCode: 'READY',
      level: 'L0',
      targetKind: 'prompt',
      applied: false,
      snapshotRef: { id: 'snapshot-001', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback-001', kind: 'rollback-ref' },
      assetEventRefs: [],
      evidenceRefs: [{ id: 'proposal-001', kind: 'evolution-proposal' }],
      blockingReasons: [],
      createdAt: now,
      updatedAt: now,
    });

    expect(record.applied).toBe(false);
    expect(record.gateCode).toBe('READY');
  });

  it('rejects ready application records with blocking reasons', () => {
    const result = ApplicationRecordSchema.safeParse({
      id: 'application-001',
      proposalId: 'proposal-001',
      validationId: 'validation-001',
      status: 'ready',
      gateCode: 'READY',
      level: 'L0',
      targetKind: 'prompt',
      applied: false,
      snapshotRef: { id: 'snapshot-001', kind: 'asset-snapshot' },
      rollbackRef: { id: 'rollback-001', kind: 'rollback-ref' },
      blockingReasons: ['not ready'],
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'blockingReasons')).toBe(true);
    }
  });

  it('accepts a valid frontier signal fixture', () => {
    const signal = FrontierSignalSchema.parse({
      id: 'frontier-signal-001',
      sourceType: 'official-doc',
      sourceRef: {
        id: 'mcp-2026-05-08',
        kind: 'official-doc',
        uri: 'https://modelcontextprotocol.io/changelog',
      },
      title: 'MCP changelog for agent tool capabilities',
      publishedAt: now,
      collectedAt: now,
      summary: 'Official MCP changelog item relevant to tool orchestration.',
      claims: ['Tool annotations can improve orchestration safety.'],
      targetDomains: ['mcp-tools', 'agentdock-kernel'],
      confidence: 'high',
      rawRef: {
        id: 'mcp-raw-2026-05-08',
        kind: 'html',
        uri: 'https://modelcontextprotocol.io/changelog',
      },
      status: 'active',
    });

    expect(signal.sourceType).toBe('official-doc');
    expect(signal.targetDomains).toContain('mcp-tools');
  });

  it('rejects frontier signals without sourceRef or summary', () => {
    const result = FrontierSignalSchema.safeParse({
      id: 'frontier-signal-missing-fields',
      sourceType: 'paper',
      title: 'Incomplete signal',
      collectedAt: now,
      claims: [],
      targetDomains: ['runner'],
      confidence: 'medium',
      status: 'active',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'sourceRef')).toBe(true);
      expect(result.error.issues.some((issue) => issue.path[0] === 'summary')).toBe(true);
    }
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
