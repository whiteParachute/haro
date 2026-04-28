import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { I18nProvider, getT } from '@/i18n/provider';
import { K } from '@/i18n/keys';
import { LoginPage, redirectTarget, validateLoginForm } from '../LoginPage';

describe('FEAT-028 LoginPage', () => {
  it('validates form and renders localized copy', () => {
    const t = getT('zh-CN');
    expect(validateLoginForm({ username: '', password: '' }, t)).toBe(t(K.AUTH.USERNAME_REQUIRED));
    expect(validateLoginForm({ username: 'owner', password: '' }, t)).toBe(t(K.AUTH.PASSWORD_REQUIRED));
    expect(validateLoginForm({ username: 'owner', password: 'password' }, t)).toBeNull();
    const html = renderToString(<I18nProvider locale="zh-CN"><MemoryRouter><LoginPage /></MemoryRouter></I18nProvider>);
    expect(html).toContain('登录 Haro 控制台');
    expect(html).toContain('用户名');
  });

  it('redirects root login fallback to chat', () => {
    expect(redirectTarget({ from: { pathname: '/', search: '' } })).toBe('/chat');
    expect(redirectTarget({ from: { pathname: '/sessions', search: '?page=2' } })).toBe('/sessions?page=2');
  });
});
