import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAuthStore } from '@/stores/auth';

export function validateBootstrapForm(input: { username: string; password: string; confirmPassword: string }): string | null {
  const username = input.username.trim();
  if (username.length === 0) return '请输入用户名';
  if (input.password.length === 0) return '请输入密码';
  if (input.password.length < 8) return '密码至少需要 8 个字符';
  if (input.password === username) return '密码不能和用户名相同';
  if (input.password !== input.confirmPassword) return '两次输入的密码不一致';
  return null;
}

export function BootstrapPage() {
  const navigate = useNavigate();
  const { status, bootstrapOwner } = useAuthStore();
  const [username, setUsername] = useState('owner');
  const [displayName, setDisplayName] = useState('Owner');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to="/" replace />;
  if (status === 'logged-out') return <Navigate to="/login" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateBootstrapForm({ username, password, confirmPassword });
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await bootstrapOwner({ username, displayName, password });
    setSubmitting(false);
    if (!result.ok) {
      setError('创建 owner 失败');
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6 text-foreground">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>创建第一个 owner</CardTitle>
          <CardDescription>用于 Haro 提案 Review 工作台的人审账号。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              用户名
              <input className="rounded-md border border-input bg-background px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              显示名
              <input className="rounded-md border border-input bg-background px-3 py-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              密码
              <input className="rounded-md border border-input bg-background px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <p className="text-xs text-muted-foreground">密码至少需要 8 个字符，且不能和用户名相同。</p>
            <label className="flex flex-col gap-1 text-sm">
              确认密码
              <input className="rounded-md border border-input bg-background px-3 py-2" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" disabled={submitting}>{submitting ? '创建中…' : '创建 owner'}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
