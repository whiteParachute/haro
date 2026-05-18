import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalRequestsPage } from '../ApprovalRequestsPage';

describe('ApprovalRequestsPage', () => {
  it('renders proposal review workbench shell', () => {
    const html = renderToString(<ApprovalRequestsPage />);
    expect(html).toContain('Haro 提案审阅工作台');
    expect(html).toContain('待人工审阅');
    expect(html).toContain('只做人审');
  });
});
