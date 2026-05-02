/**
 * FEAT-039 §7 — end-to-end self-use flow.
 *
 * Drives a single haro home through the full daily lifecycle the spec
 * promises: create user → create agent → chat → session list → memory
 * remember → memory query → logs show → workflow list → budget show →
 * config set/get/unset. Each step asserts exit code 0 + a key signal in
 * the JSON envelope. This is the smoking-gun test that the CLI surface
 * actually composes — individual command tests can pass while the flow
 * still breaks.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '@haro/core';
import type { AgentEvent, AgentProvider, AgentQueryParams } from '@haro/core/provider';
import { runCli } from '../src/index.js';

class StubProvider implements AgentProvider {
  readonly id = 'codex';
  capabilities() {
    return { streaming: false, toolLoop: false, contextCompaction: false, contextContinuation: true } as const;
  }
  async healthCheck(): Promise<boolean> { return true; }
  async listModels(): Promise<readonly { id: string }[]> { return [{ id: 'codex-primary' }]; }
  async *query(params: AgentQueryParams): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'result', content: `e2e:${params.prompt}`, responseId: 'resp-1' };
  }
}

function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new StubProvider());
  return registry;
}

interface CapStream { stream: NodeJS.WritableStream; read: () => string }
function captureStream(): CapStream {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk) => chunks.push(String(chunk)));
  return { stream, read: () => chunks.join('') };
}

interface RunOpts { argv: string[]; root: string }
interface RunResult { exitCode: number; stdout: string; stderr: string; lines: string[] }

async function run(opts: RunOpts): Promise<RunResult> {
  const stdout = captureStream();
  const stderr = captureStream();
  const result = await runCli({
    argv: opts.argv,
    root: opts.root,
    stdout: stdout.stream,
    stderr: stderr.stream,
    createProviderRegistry: async () => createProviderRegistry(),
    // Intentionally omit loadAgentRegistry so the disk-based default loader
    // picks up agents/*.yaml that earlier steps wrote (e.g. agent create).
    createAdditionalChannels: async () => [],
  });
  const out = stdout.read();
  return {
    exitCode: result.exitCode,
    stdout: out,
    stderr: stderr.read(),
    lines: out.split('\n').filter(Boolean),
  };
}

describe('FEAT-039 §7 — end-to-end self-use flow', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'haro-feat039-e2e-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('completes the daily flow end-to-end across one haro home', async () => {
    // 1. user create alice (owner) — needs --password to skip prompt.
    const userCreate = await run({ argv: ['user', 'create', 'alice', '--role', 'owner', '--password', 'alice-pass-1234'], root });
    expect(userCreate.exitCode).toBe(0);
    expect(userCreate.stdout).toContain("user 'alice' created");

    // 2. user list --json — alice should appear.
    const userList = await run({ argv: ['user', 'list', '--json'], root });
    expect(userList.exitCode).toBe(0);
    const userSummary = JSON.parse(userList.lines.at(-1)!);
    expect(userSummary).toMatchObject({ ok: true });

    // 3. agent create my-agent --from-template default.
    const agentCreate = await run({ argv: ['agent', 'create', 'my-agent', '--from-template', 'default'], root });
    expect(agentCreate.exitCode).toBe(0);
    expect(agentCreate.stdout).toContain("agent 'my-agent' created");

    // 4. agent list --json — my-agent should appear.
    const agentList = await run({ argv: ['agent', 'list', '--json'], root });
    expect(agentList.exitCode).toBe(0);
    const agentIds = agentList.lines.map((line) => JSON.parse(line))
      .filter((parsed) => parsed.ok === true && parsed.data?.id)
      .map((parsed) => parsed.data.id);
    expect(agentIds).toContain('my-agent');

    // 5. chat --send "hello" --agent my-agent — single turn, no REPL.
    const chat = await run({ argv: ['chat', '--send', 'hello', '--agent', 'my-agent'], root });
    expect(chat.exitCode).toBe(0);
    expect(chat.stdout).toContain('e2e:hello');

    // 6. session list --json — at least one record.
    const sessionList = await run({ argv: ['session', 'list', '--json'], root });
    expect(sessionList.exitCode).toBe(0);
    const sessionRecords = sessionList.lines.map((line) => JSON.parse(line))
      .filter((parsed) => parsed.ok === true && parsed.data?.sessionId);
    expect(sessionRecords.length).toBeGreaterThanOrEqual(1);
    const firstSessionId = sessionRecords[0]!.data.sessionId as string;

    // 7. memory remember --scope shared.
    const memoryRemember = await run({ argv: ['memory', 'remember', 'pineapple is allowed', '--scope', 'shared'], root });
    expect(memoryRemember.exitCode).toBe(0);
    expect(memoryRemember.stdout).toContain('memory entry created');

    // 8. memory query "pineapple" --json.
    const memoryQuery = await run({ argv: ['memory', 'query', 'pineapple', '--json'], root });
    expect(memoryQuery.exitCode).toBe(0);
    const memoryHits = memoryQuery.lines.map((line) => JSON.parse(line))
      .filter((parsed) => parsed.ok === true && parsed.data?.entry);
    expect(memoryHits.length).toBeGreaterThan(0);

    // 9. logs show --session <id> --json.
    const logsShow = await run({ argv: ['logs', 'show', '--session', firstSessionId, '--json'], root });
    expect(logsShow.exitCode).toBe(0);
    const logsLast = JSON.parse(logsShow.lines.at(-1)!);
    expect(logsLast.ok).toBe(true);

    // 10. workflow list --json.
    const workflowList = await run({ argv: ['workflow', 'list', '--json'], root });
    expect(workflowList.exitCode).toBe(0);
    const workflowSummary = JSON.parse(workflowList.lines.at(-1)!);
    expect(workflowSummary).toMatchObject({ ok: true, summary: { total: expect.any(Number) } });

    // 11. budget show --json.
    const budgetShow = await run({ argv: ['budget', 'show', '--json'], root });
    expect(budgetShow.exitCode).toBe(0);
    const budgetSummary = JSON.parse(budgetShow.lines.at(-1)!);
    expect(budgetSummary).toMatchObject({ ok: true });

    // 12. config set defaultAgent my-agent --scope project.
    const configSet = await run({ argv: ['config', 'set', 'defaultAgent', 'my-agent', '--scope', 'project'], root });
    expect(configSet.exitCode).toBe(0);
    expect(configSet.stdout).toContain('defaultAgent =');

    // 13. config get defaultAgent --json.
    const configGet = await run({ argv: ['config', 'get', 'defaultAgent', '--json'], root });
    expect(configGet.exitCode).toBe(0);
    const cfgRecord = JSON.parse(configGet.lines.at(-1)!);
    expect(cfgRecord).toMatchObject({ ok: true });
    expect(cfgRecord.data.value).toBe('my-agent');

    // 14. config unset defaultAgent --scope project.
    const configUnset = await run({ argv: ['config', 'unset', 'defaultAgent', '--scope', 'project'], root });
    expect(configUnset.exitCode).toBe(0);
    expect(configUnset.stdout).toMatch(/defaultAgent: (removed|not present)/);
  }, 30_000);
});
