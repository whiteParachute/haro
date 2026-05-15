import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve(__dirname, '..', 'bin', 'haro.js');
const dist = resolve(__dirname, '..', 'dist', 'index.js');

describe.skipIf(!existsSync(dist))('bin/haro.js [FEAT-006]', () => {
  it('shipped binary --version exits 0', () => {
    const res = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('0.1.0');
  });

  it('shipped binary exposes web command help', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-web-help-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'web', '--help'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Usage: haro web [options]');
      expect(res.stdout).toContain('--port <port>');
      expect(res.stdout).toContain('--host <host>');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shipped binary reports config validation paths on startup errors', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-bad-'));
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'config.yaml'), 'providers:\n  codex:\n    defaultModel: 123\n');
      const res = spawnSync(process.execPath, [bin, 'run', 'hello'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('providers.codex.defaultModel');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shipped binary status emits clean JSON without bootstrap log noise', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-status-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'status'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(() => JSON.parse(res.stdout)).not.toThrow();
      expect(res.stdout).not.toContain('Created default Agent');
      expect(res.stderr).toBe('');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('root pnpm script haro --version exits 0', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const res = spawnSync('pnpm', ['haro', '--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const lastLine = res.stdout.trim().split('\n').pop()?.trim();
    expect(lastLine).toBe('0.1.0');
  });

  it('shipped binary channel list includes optional adapters on a clean home', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-channel-list-'));
    try {
      // FEAT-039 R11: piped (non-TTY) stdout defaults to JSON envelope.
      // Force --human so the assertion can match the legacy text rows.
      const res = spawnSync(process.execPath, [bin, 'channel', 'list', '--human'], {
        env: { ...process.env, HARO_HOME: home },
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('cli\tenabled\tbuiltin');
      expect(res.stdout).toContain('feishu\tdisabled\tpackage');
      expect(res.stdout).toContain('telegram\tdisabled\tpackage');
      expect(res.stdout).not.toContain('web\tenabled\tbuiltin');
      expect(res.stdout).not.toContain('Created default Agent');
      expect(res.stderr).not.toContain('Created default Agent');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shipped binary mcp lists AgentDock sidecar default tools without gated write', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-mcp-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'mcp'], {
        env: { ...process.env, HARO_HOME: home },
        input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      const payload = JSON.parse(res.stdout) as { result: { tools: Array<{ name: string }> } };
      const names = payload.result.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        'haro_asset_query',
        'haro_observe',
        'haro_propose',
        'haro_run_daily_workflow',
        'haro_validate',
      ]);
      expect(names).not.toContain('haro_apply');
      expect(names).not.toContain('memory_query');
      expect(names).not.toContain('send_message');
      expect(existsSync(join(home, 'memory'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shipped binary mcp returns MCP-standard content blocks for tool calls', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-mcp-call-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'mcp'], {
        env: { ...process.env, HARO_HOME: home },
        input: [
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'haro_observe',
              arguments: { connectionId: 'fake-agentdock-test', limit: 1 },
            },
          }),
          '',
        ].join('\n'),
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      const payload = JSON.parse(res.stdout) as {
        result: {
          content: Array<{ type: string; text: string }>;
          isError: boolean;
          structuredContent: { connectionId: string; sessions: unknown[] };
        };
      };
      expect(payload.result.isError).toBe(false);
      expect(payload.result.content[0]).toMatchObject({ type: 'text' });
      expect(payload.result.content[0]!.text).toBe(
        JSON.stringify(payload.result.structuredContent, null, 2),
      );
      expect(payload.result.structuredContent.connectionId).toBe('fake-agentdock-test');
      expect(payload.result.structuredContent.sessions).toHaveLength(1);
      expect(existsSync(join(home, 'memory'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shipped binary mcp can run the AgentDock daily workflow without creating memory', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-mcp-daily-workflow-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'mcp'], {
        env: { ...process.env, HARO_HOME: home },
        input: [
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'haro_run_daily_workflow',
              arguments: {
                source: 'fake',
                since: 'none',
                proposalLimit: 1,
                validationLimit: 1,
                approvalRequestLimit: 1,
              },
            },
          }),
          '',
        ].join('\n'),
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      const payload = JSON.parse(res.stdout) as {
        result: {
          isError: boolean;
          structuredContent: {
            command: string;
            sidecarOnly: boolean;
            summary: {
              observationCount: number;
              proposalCount: number;
              validationCount: number;
              approvalRequestCount: number;
              approvalRequestIds: string[];
            };
            nextActions: string[];
          };
        };
      };
      expect(payload.result.isError).toBe(false);
      expect(payload.result.structuredContent).toMatchObject({
        command: 'agentdock-daily-workflow',
        sidecarOnly: true,
      });
      expect(payload.result.structuredContent.summary.observationCount).toBeGreaterThan(0);
      expect(payload.result.structuredContent.summary.proposalCount).toBe(1);
      expect(payload.result.structuredContent.summary.validationCount).toBe(1);
      expect(payload.result.structuredContent.summary.approvalRequestCount).toBe(1);
      expect(payload.result.structuredContent.summary.approvalRequestIds).toHaveLength(1);
      expect(payload.result.structuredContent.nextActions.join('\n')).toContain(
        'Present the approval request',
      );
      expect(existsSync(join(home, 'evolution', 'approval-requests'))).toBe(true);
      expect(existsSync(join(home, 'memory'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shipped binary mcp exposes gated-write tools only when explicitly enabled', () => {
    const home = mkdtempSync(join(tmpdir(), 'haro-bin-mcp-gated-write-'));
    try {
      const res = spawnSync(process.execPath, [bin, 'mcp', '--enable-gated-write'], {
        env: { ...process.env, HARO_HOME: home },
        input: [
          JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'haro_apply',
              arguments: { proposalId: 'proposal-missing' },
            },
          }),
          '',
        ].join('\n'),
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      const responses = res.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              result: {
                tools?: Array<{ name: string }>;
                isError?: boolean;
                structuredContent?: { command: string; gateStatus: string; gateCode: string };
              };
            },
        );
      const names = responses[0]!.result.tools!.map((tool) => tool.name).sort();
      expect(names).toEqual([
        'haro_apply',
        'haro_asset_query',
        'haro_observe',
        'haro_propose',
        'haro_rollback',
        'haro_run_daily_workflow',
        'haro_validate',
      ]);
      expect(responses[1]!.result.isError).toBe(false);
      expect(responses[1]!.result.structuredContent).toMatchObject({
        command: 'apply',
        gateStatus: 'blocked',
        gateCode: 'PROPOSAL_NOT_FOUND',
      });
      expect(existsSync(join(home, 'memory'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
