import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useAuthStore } from '@/stores/auth';

export function redirectTarget(state: unknown): string {
  if (state && typeof state === 'object' && 'from' in state) {
    const from = (state as { from?: { pathname?: string; search?: string } }).from;
    if (from?.pathname && from.pathname !== '/' && from.pathname !== '/login' && from.pathname !== '/bootstrap') return `${from.pathname}${from.search ?? ''}`;
  }
  return '/chat';
}

export function validateLoginForm(input: { username: string; password: string }, t: (key: string) => string): string | null {
  if (input.username.trim().length === 0) return t(K.AUTH.USERNAME_REQUIRED);
  if (input.password.length === 0) return t(K.AUTH.PASSWORD_REQUIRED);
  return null;
}

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to={redirectTarget(location.state)} replace />;
  if (status === 'needs-bootstrap') return <Navigate to="/bootstrap" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateLoginForm({ username, password }, t);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await login(username, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(t(K.AUTH.LOGIN_FAILED));
      return;
    }
    navigate(redirectTarget(location.state), { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t(K.AUTH.LOGIN_TITLE)}</CardTitle>
          <CardDescription>{t(K.AUTH.LOGIN_DESC)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              {t(K.AUTH.USERNAME)}
              <input className="rounded-md border border-input bg-background px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t(K.AUTH.PASSWORD)}
              <input className="rounded-md border border-input bg-background px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" disabled={submitting}>{submitting ? t(K.AUTH.LOGGING_IN) : t(K.AUTH.LOGIN)}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
