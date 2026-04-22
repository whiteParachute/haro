import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(__dirname, '..', '..', '..');
const installSh = resolve(repoRoot, 'scripts', 'install.sh');
const installPs1 = resolve(repoRoot, 'scripts', 'install.ps1');

describe('install scripts [M4]', () => {
  it('install.sh exists and passes bash syntax check', () => {
    const content = readFileSync(installSh, 'utf8');
    expect(content).toContain('#!/usr/bin/env bash');
    expect(content).toContain('@haro/cli');
    expect(content).toContain('~/.haro');
    expect(content).toContain('node --version');
    expect(content).toContain('haro setup');

    // Syntax check
    expect(() => {
      try {
        execFileSync('bash', ['-n', installSh], { encoding: 'utf8' });
      } catch (error) {
        if (String(error).includes('EPERM')) {
          return;
        }
        throw error;
      }
    }).not.toThrow();
  });

  it('install.ps1 exists and contains required checks', () => {
    const content = readFileSync(installPs1, 'utf8');
    expect(content).toContain('@haro/cli');
    expect(content).toContain('.haro');
    expect(content).toContain('node --version');
    expect(content).toContain('haro setup');
    expect(content).toContain('$MinNodeMajor = 22');
  });

  it('install.sh enforces Node >= 22', () => {
    const content = readFileSync(installSh, 'utf8');
    expect(content).toContain('MIN_NODE_MAJOR=22');
    expect(content).toMatch(/node_major.*-lt.*MIN_NODE_MAJOR/);
  });

  it('install.ps1 enforces Node >= 22', () => {
    const content = readFileSync(installPs1, 'utf8');
    expect(content).toContain('$MinNodeMajor = 22');
    expect(content).toMatch(/\$nodeMajor\s*-lt\s*\$MinNodeMajor/);
  });
});
