import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { I18nProvider, getT } from '@/i18n/provider';
import { K } from '@/i18n/keys';
import { BootstrapPage, validateBootstrapForm } from '../BootstrapPage';

describe('FEAT-028 BootstrapPage', () => {
  it('validates strength rules and renders localized copy', () => {
    const t = getT('zh-CN');
    expect(validateBootstrapForm({ username: '', password: '', confirmPassword: '' }, t)).toBe(t(K.AUTH.USERNAME_REQUIRED));
    expect(validateBootstrapForm({ username: 'owner', password: 'short', confirmPassword: 'short' }, t)).toBe(t(K.AUTH.PASSWORD_MIN));
    expect(validateBootstrapForm({ username: 'ownername', password: 'ownername', confirmPassword: 'ownername' }, t)).toBe(t(K.AUTH.PASSWORD_NOT_USERNAME));
    expect(validateBootstrapForm({ username: 'owner', password: 'password1', confirmPassword: 'password2' }, t)).toBe(t(K.AUTH.PASSWORD_MISMATCH));
    expect(validateBootstrapForm({ username: 'owner', password: 'password1', confirmPassword: 'password1' }, t)).toBeNull();
    const html = renderToString(<I18nProvider locale="zh-CN"><MemoryRouter><BootstrapPage /></MemoryRouter></I18nProvider>);
    expect(html).toContain('创建第一个 owner');
    expect(html).toContain('确认密码');
  });
});
