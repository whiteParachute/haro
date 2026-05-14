import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalRequestsPage } from '../ApprovalRequestsPage';

describe('ApprovalRequestsPage', () => {
  it('renders proposal review workbench shell', () => {
    const html = renderToString(<ApprovalRequestsPage />);
    expect(html).toContain('Haro 改动提案');
    expect(html).toContain('待人工审阅');
    expect(html).toContain('只负责人审决策');
  });
});
