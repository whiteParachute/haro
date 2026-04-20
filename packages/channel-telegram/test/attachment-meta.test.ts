import { describe, expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import { mapTelegramUpdate } from '../src/index.js';

describe('Telegram attachment meta extraction [FEAT-009]', () => {
  it('keeps stable file identifiers instead of temporary URLs', () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        date: 1710000000,
        chat: { id: 100, type: 'private' },
        from: { id: 200, is_bot: false, first_name: 'User' },
        caption: 'see file',
        document: {
          file_id: 'file-1',
          file_unique_id: 'uniq-1',
          file_name: 'report.pdf',
        },
      },
    } as unknown as Update;

    const event = mapTelegramUpdate(update);
    expect(event?.attachments).toEqual([
      {
        kind: 'document',
        file_id: 'file-1',
        file_unique_id: 'uniq-1',
        name: 'report.pdf',
      },
    ]);
    expect(JSON.stringify(event)).not.toContain('https://');
  });
});
