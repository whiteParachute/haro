import { describe, expect, it } from 'vitest';
import {
  AgentDockConnectionSchema,
  ObservationBatchSchema,
  createFakeAgentDockSource,
} from '../src/index.js';

describe('FakeAgentDockSource [FEAT-043]', () => {
  it('creates a schema-valid fake connection', () => {
    const source = createFakeAgentDockSource({ connectionId: 'local-dev' });

    const connection = AgentDockConnectionSchema.parse(source.connection);

    expect(connection.id).toBe('local-dev');
    expect(connection.observationSources[0]?.kind).toBe('fake');
    expect(connection.observationSources[0]?.readOnly).toBe(true);
  });

  it('creates a deterministic observation batch for contract tests', () => {
    const source = createFakeAgentDockSource({ connectionId: 'local-dev' });

    const first = ObservationBatchSchema.parse(source.collectObservationBatch());
    const second = ObservationBatchSchema.parse(source.collectObservationBatch());

    expect(first).toEqual(second);
    expect(first.id).toBe('obs-local-dev-001');
    expect(first.runnerErrors[0]?.recoverable).toBe(true);
    expect(first.usageRecords[0]?.inputTokens).toBeGreaterThan(0);
  });
});
