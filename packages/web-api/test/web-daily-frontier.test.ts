import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readDailyFrontierConfig,
  runDailyFrontierOnce,
  type DailyFrontierCommandRunner,
} from '../src/daily-frontier.js';
import type { WebLogger } from '../src/types.js';

const logger: WebLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

let root: string;
let projectRoot: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'haro-daily-frontier-'));
  projectRoot = await mkdtemp(path.join(os.tmpdir(), 'haro-daily-project-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
});

describe('daily frontier scheduler runner', () => {
  it('runs the sidecar CLI chain against an existing source config', async () => {
    const sourceConfig = path.join(root, 'frontier-sources.json');
    mkdirSync(path.dirname(sourceConfig), { recursive: true });
    writeFileSync(sourceConfig, '{"signals":[]}\n', 'utf8');
    const calls: string[] = [];
    const runCommand: DailyFrontierCommandRunner = async (spec) => {
      calls.push(spec.display);
      return { exitCode: 0, stdout: '{"ok":true}\n', stderr: '' };
    };

    const config = readDailyFrontierConfig(root, {
      HARO_DAILY_FRONTIER_ENABLED: '1',
      HARO_DAILY_FRONTIER_SOURCE_CONFIG: sourceConfig,
      HARO_DAILY_FRONTIER_HARO_CMD: 'haro',
    } as NodeJS.ProcessEnv);

    const record = await runDailyFrontierOnce({
      root,
      projectRoot,
      config,
      logger,
      env: process.env,
      now: () => new Date('2026-05-15T02:00:00.000Z'),
      runCommand,
    });

    expect(record.status).toBe('success');
    expect(record.steps.map((step) => step.name)).toEqual([
      'intake-frontier',
      'observe',
      'propose',
      'validate',
      'approval-request',
    ]);
    expect(calls[0]).toContain("'intake' 'frontier'");
    expect(calls[2]).toContain('propose');
    expect(calls[2]).toContain('--include-frontier');

    const persisted = JSON.parse(
      readFileSync(
        path.join(root, 'evolution/daily-frontier-runs/daily_frontier_20260515T020000000Z.json'),
        'utf8',
      ),
    );
    expect(persisted.status).toBe('success');
  });

  it('accepts a collector command and writes generated source config before intake', async () => {
    const calls: string[] = [];
    const runCommand: DailyFrontierCommandRunner = async (spec) => {
      calls.push(spec.display);
      if (spec.display === 'collect-frontier') {
        return { exitCode: 0, stdout: '{"signals":[]}\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '{"ok":true}\n', stderr: '' };
    };
    const config = readDailyFrontierConfig(root, {
      HARO_DAILY_FRONTIER_ENABLED: '1',
      HARO_DAILY_FRONTIER_COLLECT_COMMAND: 'collect-frontier',
      HARO_DAILY_FRONTIER_HARO_CMD: 'haro',
    } as NodeJS.ProcessEnv);

    const record = await runDailyFrontierOnce({
      root,
      projectRoot,
      config,
      logger,
      now: () => new Date('2026-05-15T02:00:00.000Z'),
      runCommand,
    });

    expect(record.status).toBe('success');
    expect(record.generatedSourceConfigPath).toContain('generated-frontier-sources');
    expect(readFileSync(record.generatedSourceConfigPath!, 'utf8')).toBe('{"signals":[]}\n');
    expect(calls[0]).toBe('collect-frontier');
    expect(calls[1]).toContain(record.generatedSourceConfigPath);
  });

  it('records an error when one step fails', async () => {
    const config = readDailyFrontierConfig(root, {
      HARO_DAILY_FRONTIER_ENABLED: '1',
      HARO_DAILY_FRONTIER_HARO_CMD: 'haro',
    } as NodeJS.ProcessEnv);
    const runCommand: DailyFrontierCommandRunner = async (spec) => ({
      exitCode: spec.display.includes('observe') ? 2 : 0,
      stdout: '{}',
      stderr: spec.display.includes('observe') ? 'observe failed' : '',
    });

    const record = await runDailyFrontierOnce({
      root,
      projectRoot,
      config,
      logger,
      now: () => new Date('2026-05-15T02:00:00.000Z'),
      runCommand,
    });

    expect(record.status).toBe('error');
    expect(record.error).toContain('observe failed with exit code 2');
  });
});
