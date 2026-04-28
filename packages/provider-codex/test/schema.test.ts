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

  it('accepts only env|chatgpt|auto for authMode', () => {
    expect(codexProviderOptionsSchema.parse({ authMode: 'env' }).authMode).toBe('env');
    expect(codexProviderOptionsSchema.parse({ authMode: 'chatgpt' }).authMode).toBe('chatgpt');
    expect(codexProviderOptionsSchema.parse({ authMode: 'auto' }).authMode).toBe('auto');
    expect(() => codexProviderOptionsSchema.parse({ authMode: 'oauth' })).toThrow(/Invalid enum value/);
  });

  it.each(['access_token', 'refresh_token', 'id_token'])('rejects tokens.%s in provider options', (tokenField) => {
    expect(() =>
      codexProviderOptionsSchema.parse({ tokens: { [tokenField]: 'secret-token-value' } }),
    ).toThrow(/tokens/);
  });
});
