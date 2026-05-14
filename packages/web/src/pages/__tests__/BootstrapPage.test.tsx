import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BootstrapPage, validateBootstrapForm } from '../BootstrapPage';

describe('BootstrapPage', () => {
  it('validates strength rules and renders proposal-review copy', () => {
    expect(validateBootstrapForm({ username: '', password: '', confirmPassword: '' })).toBe('请输入用户名');
    expect(validateBootstrapForm({ username: 'owner', password: 'short', confirmPassword: 'short' })).toBe('密码至少需要 8 个字符');
    expect(validateBootstrapForm({ username: 'ownername', password: 'ownername', confirmPassword: 'ownername' })).toBe('密码不能和用户名相同');
    expect(validateBootstrapForm({ username: 'owner', password: 'password1', confirmPassword: 'password2' })).toBe('两次输入的密码不一致');
    expect(validateBootstrapForm({ username: 'owner', password: 'password1', confirmPassword: 'password1' })).toBeNull();
    const html = renderToString(<MemoryRouter><BootstrapPage /></MemoryRouter>);
    expect(html).toContain('创建第一个 owner');
    expect(html).toContain('确认密码');
  });
});
