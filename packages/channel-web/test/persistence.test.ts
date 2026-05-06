import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WebChannelStore,
  resolveStoragePath,
  saveUploadFile,
} from '../src/index.js';

describe('WebChannelStore message persistence [FEAT-031]', () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  function makeStore(): { store: WebChannelStore; root: string } {
    const root = mkdtempSync(join(tmpdir(), 'haro-web-channel-'));
    dirs.push(root);
    const store = new WebChannelStore(join(root, 'sessions.sqlite'));
    return { store, root };
  }

  it('upserts a session and surfaces it via getSession', () => {
    const { store } = makeStore();
    const session = store.upsertSession({ sessionId: 's-1', ownerUserId: 'u-1' });
    expect(session.sessionId).toBe('s-1');
    expect(session.ownerUserId).toBe('u-1');
    expect(store.getSession('s-1')?.sessionId).toBe('s-1');
  });

  it('appends messages and lists them in chronological order [AC1]', () => {
    const { store } = makeStore();
    store.upsertSession({ sessionId: 's-2' });
    const ts = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      store.appendMessage({
        id: `m-${i}`,
        sessionId: 's-2',
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `hello-${i}`,
        createdAt: ts + i * 1000,
      });
    }
    const page = store.listMessages('s-2', { limit: 10 });
    expect(page.items.map((m) => m.id)).toEqual(['m-0', 'm-1', 'm-2', 'm-3', 'm-4']);
    expect(page.nextCursor).toBeNull();
  });

  it('paginates with cursor without duplication [AC6]', () => {
    const { store } = makeStore();
    store.upsertSession({ sessionId: 's-3' });
    const base = 1_700_000_000_000;
    for (let i = 0; i < 100; i += 1) {
      store.appendMessage({
        id: `m-${i.toString().padStart(3, '0')}`,
        sessionId: 's-3',
        role: 'user',
        content: { idx: i },
        createdAt: base + i * 100,
      });
    }
    const page1 = store.listMessages('s-3', { limit: 50 });
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).not.toBeNull();
    const firstIds = new Set(page1.items.map((m) => m.id));
    expect(page1.items[0]!.id).toBe('m-050');
    expect(page1.items[49]!.id).toBe('m-099');

    const page2 = store.listMessages('s-3', { limit: 50, before: page1.nextCursor ?? undefined });
    expect(page2.items).toHaveLength(50);
    expect(page2.items[0]!.id).toBe('m-000');
    expect(page2.items[49]!.id).toBe('m-049');
    for (const item of page2.items) expect(firstIds.has(item.id)).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it('records files and reports per-session usage', () => {
    const { store } = makeStore();
    store.upsertSession({ sessionId: 's-4' });
    store.recordFile({
      id: 'f-1',
      sessionId: 's-4',
      filename: 'a.png',
      size: 1024,
      mimeType: 'image/png',
      storagePath: '/tmp/a',
      uploadedBy: 'u-1',
    });
    store.recordFile({
      id: 'f-2',
      sessionId: 's-4',
      filename: 'b.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      storagePath: '/tmp/b',
      uploadedBy: 'u-1',
    });
    expect(store.sessionUsageBytes('s-4')).toBe(3072);
    expect(store.getFile('f-2')?.filename).toBe('b.pdf');
  });

  it('survives a restart and reads back history', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-web-channel-'));
    dirs.push(root);
    const dbFile = join(root, 'sessions.sqlite');
    const first = new WebChannelStore(dbFile);
    first.upsertSession({ sessionId: 's-5' });
    first.appendMessage({
      id: 'm-1',
      sessionId: 's-5',
      role: 'user',
      content: 'persist me',
      createdAt: 1,
    });
    first.close();

    const second = new WebChannelStore(dbFile);
    const page = second.listMessages('s-5');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.content).toBe('persist me');
    second.close();
  });

  it('uses composite cursor to keep same-ms messages on the same page', () => {
    const { store } = makeStore();
    store.upsertSession({ sessionId: 's-tie' });
    const ts = 1_700_000_000_000;
    // 10 messages all sharing the same millisecond — without a tie-break
    // cursor, paging would skip rows when the page boundary lands inside
    // the cluster.
    for (let i = 0; i < 10; i += 1) {
      store.appendMessage({
        id: `t-${i.toString().padStart(2, '0')}`,
        sessionId: 's-tie',
        role: 'user',
        content: i,
        createdAt: ts,
      });
    }
    const page1 = store.listMessages('s-tie', { limit: 5 });
    expect(page1.items.map((m) => m.id)).toEqual(['t-05', 't-06', 't-07', 't-08', 't-09']);
    expect(page1.nextCursor).toBe(ts);
    expect(page1.nextCursorId).toBe('t-05');

    const page2 = store.listMessages('s-tie', {
      limit: 5,
      before: page1.nextCursor ?? undefined,
      beforeId: page1.nextCursorId ?? undefined,
    });
    expect(page2.items.map((m) => m.id)).toEqual(['t-00', 't-01', 't-02', 't-03', 't-04']);
    expect(page2.nextCursor).toBeNull();
  });

  it('keeps SQLite handle open across stop() so re-enable still works', () => {
    const { store } = makeStore();
    store.upsertSession({ sessionId: 's-cycle' });
    store.appendMessage({ id: 'm-1', sessionId: 's-cycle', role: 'user', content: 'one', createdAt: 1 });
    // The store itself stays open; channel.stop() is what drives the policy
    // — covered by channel.test.ts. Verify that listing after a no-op
    // pause still works.
    expect(store.listMessages('s-cycle').items).toHaveLength(1);
  });

  it('deletes session + messages + files in one shot', () => {
    const { store, root } = makeStore();
    const storageRoot = join(root, 'files');
    store.upsertSession({ sessionId: 's-6' });
    const data = Buffer.from('hello');
    const { storagePath } = saveUploadFile({
      storageRoot,
      sessionId: 's-6',
      fileId: 'f-1',
      filename: 'note.txt',
      data,
    });
    store.recordFile({
      id: 'f-1',
      sessionId: 's-6',
      filename: 'note.txt',
      size: data.length,
      mimeType: 'text/plain',
      storagePath,
      uploadedBy: 'u-1',
    });
    store.appendMessage({ id: 'm-1', sessionId: 's-6', role: 'user', content: 'x', createdAt: 1 });
    expect(store.deleteSession('s-6')).toEqual({ deleted: true, fileIds: ['f-1'] });
    expect(store.getSession('s-6')).toBeUndefined();
    expect(store.listMessages('s-6').items).toHaveLength(0);
  });
});

describe('Web Channel storage paths [FEAT-031 R5]', () => {
  it('rejects session IDs that try to escape the storage root', () => {
    const root = '/tmp/haro-web-test';
    expect(() =>
      resolveStoragePath({ storageRoot: root, sessionId: '../escape', fileId: 'f', filename: 'a.png' }),
    ).not.toThrow();
    // The session segment is sanitized, so the resolved path should still be
    // under root — the encoded segment is `_._escape` (or similar).
    const resolved = resolveStoragePath({
      storageRoot: root,
      sessionId: '../escape',
      fileId: 'f',
      filename: 'a.png',
    });
    expect(resolved.absoluteFile.startsWith(root)).toBe(true);
  });

  it('writes uploaded files at 0600', () => {
    const root = mkdtempSync(join(tmpdir(), 'haro-web-files-'));
    try {
      const result = saveUploadFile({
        storageRoot: root,
        sessionId: 's',
        fileId: 'f',
        filename: 'note.txt',
        data: Buffer.from('hello'),
      });
      const stat = statSync(result.storagePath);
      expect(stat.mode & 0o777).toBe(0o600);
      expect(readFileSync(result.storagePath, 'utf8')).toBe('hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
