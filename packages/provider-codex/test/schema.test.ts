/** FEAT-003 R5 — schema rejects apiKey, accepts baseUrl. */
import { describe, it, expect } from 'vitest';
import { codexProviderOptionsSchema } from '../src/schema.js';
import { createCodexProvider } from '../src/index.js';

describe('codexProviderOptionsSchema [FEAT-003 R5]', () => {
  it('accepts baseUrl + defaultModel', () => {
    const parsed = codexProviderOptionsSchema.parse({
      baseUrl: 'https://example.com/v1',
      defaultModel: 'gpt-5-codex',
    });
    expect(parsed.baseUrl).toBe('https://example.com/v1');
    expect(parsed.defaultModel).toBe('gpt-5-codex');
  });

  it('rejects apiKey (Codex Provider reads OPENAI_API_KEY from env)', () => {
    expect(() =>
      codexProviderOptionsSchema.parse({ apiKey: 'sk-leaked' }),
    ).toThrow(/apiKey/);
  });

  it('createCodexProvider rejects apiKey at construction time', () => {
    expect(() =>
      createCodexProvider({ apiKey: 'sk-x' } as never, { readApiKey: () => 'sk-real' }),
    ).toThrow(/apiKey/);
  });
});
