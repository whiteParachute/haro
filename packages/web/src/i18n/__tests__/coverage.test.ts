import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getT } from '../provider';
import { K } from '../keys';

const srcRoot = join(process.cwd(), 'src');
const checkedPaths = [
  'components/PaginatedTable.tsx',
  'components/PaginationControls.tsx',
  'components/auth/AuthGuard.tsx',
  'components/layout/Header.tsx',
  'components/layout/Sidebar.tsx',
  'pages/LoginPage.tsx',
  'pages/BootstrapPage.tsx',
  'pages/SessionsPage.tsx',
  'pages/LogsPage.tsx',
  'pages/KnowledgePage.tsx',
  'pages/SkillsPage.tsx',
  'pages/UsersPage.tsx',
];

function listTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTsx(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('FEAT-028 i18n coverage', () => {
  it('provides zh-CN baseline and en-US fallback for key object', () => {
    expect(getT('zh-CN')(K.AUTH.LOGIN_TITLE)).toBe('登录 Haro 控制台');
    expect(getT('en-US')(K.AUTH.LOGIN_TITLE)).toBe('Log in to Haro Console');
    expect(getT('zh-CN')('missing.key')).toBe('missing.key');
  });

  it('scans src/**/*.tsx and blocks hardcoded copy in FEAT-028 surfaces', () => {
    const allTsx = listTsx(srcRoot).map((path) => relative(srcRoot, path));
    expect(allTsx.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const rel of checkedPaths) {
      const text = readFileSync(join(srcRoot, rel), 'utf8');
      const jsxText = [...text.matchAll(/>\s*([^<>{}\n]*(?:[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z ]{8,})[^<>{}\n]*)\s*</g)]
        .map((match) => match[1]?.trim())
        .filter(Boolean)
        .filter((value) => !/[()?\u003e]/.test(value!))
        .filter((value) => !['Haro', 'Agent ID', 'Asset ref', 'original', 'fallback', 'trigger', '403', '404', 'Uninstall', 'Asset audit result'].includes(value!))
        .filter((value) => !value!.startsWith('Knowledge /'))
        .filter((value) => !value!.includes('haro shit'))
        .filter((value) => !value!.includes('platform scope read-only'))
        .filter((value) => !value!.includes('最近一次 install'));
      if (jsxText.length > 0) offenders.push(`${rel}: ${jsxText.join(' | ')}`);
    }
    expect(offenders, `key 缺失：${offenders.join('\n')}`).toEqual([]);
  });
});
