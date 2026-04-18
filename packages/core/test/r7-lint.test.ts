/**
 * R7 — verify the no-restricted-syntax placeholder rule fires on
 * provider/channel hard-coded comparisons inside packages/core/src/**.
 * The rule lives in /.eslintrc.cjs (overrides for that file glob).
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');

describe('R7 no-provider-hardcode lint placeholder [FEAT-001]', () => {
  it('flags providerId === <literal> as a violation in core source', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintText(
      'const providerId: string = "claude";\nif (providerId === "claude") { /* hardcoded */ }\n',
      { filePath: resolve(repoRoot, 'packages/core/src/_r7-fixture-provider.ts') },
    );
    const messages = results.flatMap((r) => r.messages);
    const violation = messages.find((m) => m.ruleId === 'no-restricted-syntax');
    expect(violation, JSON.stringify(messages, null, 2)).toBeDefined();
    expect(violation?.message).toMatch(/providerId/);
  });

  it('flags ctx.channelId === <literal> (member form) in core source', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintText(
      'const ctx: { channelId: string } = { channelId: "feishu" };\nif (ctx.channelId === "feishu") { /* hardcoded */ }\n',
      { filePath: resolve(repoRoot, 'packages/core/src/_r7-fixture-channel.ts') },
    );
    const messages = results.flatMap((r) => r.messages);
    const violation = messages.find((m) => m.ruleId === 'no-restricted-syntax');
    expect(violation, JSON.stringify(messages, null, 2)).toBeDefined();
    expect(violation?.message).toMatch(/channelId/);
  });

  it('does NOT flag identical patterns outside core (e.g. packages/cli/src)', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintText(
      'const providerId: string = "claude";\nif (providerId === "claude") { /* allowed outside core */ }\n',
      { filePath: resolve(repoRoot, 'packages/cli/src/_r7-fixture.ts') },
    );
    const messages = results.flatMap((r) => r.messages);
    const violations = messages.filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(violations).toEqual([]);
  });
});
