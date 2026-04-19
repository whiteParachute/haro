/** AC2 — the R6 "no raw Anthropic API" grep constraint. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';

const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '..', '..');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && full.endsWith('.ts')) yield full;
  }
}

describe('FEAT-002 R6 raw-API guard', () => {
  it('AC2 source tree contains zero raw Anthropic imports or direct API calls', () => {
    const offenders: string[] = [];
    const forbidden = [
      "from '@anthropic-ai/sdk'",
      'from "@anthropic-ai/sdk"',
      'anthropic.messages.create',
    ];
    for (const file of walk(join(pkgRoot, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (text.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('AC2 ESLint bans @anthropic-ai/sdk anywhere and bans claude-agent-sdk outside provider-claude', async () => {
    const eslint = new ESLint({ cwd: repoRoot });

    const rawImport = await eslint.lintText(
      `import { Anthropic } from '@anthropic-ai/sdk';\nconst a = new Anthropic();\n`,
      { filePath: resolve(repoRoot, 'packages/provider-claude/src/_fixture-raw.ts') },
    );
    const rawMessages = rawImport.flatMap((r) => r.messages);
    const rawBan = rawMessages.find((m) => m.ruleId === 'no-restricted-imports');
    expect(rawBan, JSON.stringify(rawMessages, null, 2)).toBeDefined();
    expect(rawBan?.message).toMatch(/FEAT-002 R6/);

    const agentSdkInCore = await eslint.lintText(
      `import { query } from '@anthropic-ai/claude-agent-sdk';\nconst q = query;\n`,
      { filePath: resolve(repoRoot, 'packages/core/src/_fixture-agent-sdk.ts') },
    );
    const coreMsgs = agentSdkInCore.flatMap((r) => r.messages);
    const coreBan = coreMsgs.find((m) => m.ruleId === 'no-restricted-imports');
    expect(coreBan, JSON.stringify(coreMsgs, null, 2)).toBeDefined();
    expect(coreBan?.message).toMatch(/only allowed inside @haro\/provider-claude/);
  });
});
