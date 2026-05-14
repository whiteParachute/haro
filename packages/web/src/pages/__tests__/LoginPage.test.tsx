import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LoginPage, redirectTarget, validateLoginForm } from '../LoginPage';

describe('LoginPage', () => {
  it('validates form and renders proposal review copy', () => {
    expect(validateLoginForm({ username: '', password: '' })).toBe('请输入用户名');
    expect(validateLoginForm({ username: 'owner', password: '' })).toBe('请输入密码');
    expect(validateLoginForm({ username: 'owner', password: 'password' })).toBeNull();
    const html = renderToString(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(html).toContain('登录 Haro 提案 Review');
    expect(html).toContain('用户名');
  });

  it('redirects login fallback to proposal review workbench', () => {
    expect(redirectTarget({ from: { pathname: '/', search: '' } })).toBe('/');
    expect(redirectTarget({ from: { pathname: '/sessions', search: '?page=2' } })).toBe('/');
  });
});
