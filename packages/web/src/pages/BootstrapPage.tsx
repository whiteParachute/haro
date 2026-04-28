import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useAuthStore } from '@/stores/auth';

export function validateBootstrapForm(input: { username: string; password: string; confirmPassword: string }, t: (key: string) => string): string | null {
  const username = input.username.trim();
  if (username.length === 0) return t(K.AUTH.USERNAME_REQUIRED);
  if (input.password.length === 0) return t(K.AUTH.PASSWORD_REQUIRED);
  if (input.password.length < 8) return t(K.AUTH.PASSWORD_MIN);
  if (input.password === username) return t(K.AUTH.PASSWORD_NOT_USERNAME);
  if (input.password !== input.confirmPassword) return t(K.AUTH.PASSWORD_MISMATCH);
  return null;
}

export function BootstrapPage() {
  const t = useT();
  const navigate = useNavigate();
  const { status, bootstrapOwner } = useAuthStore();
  const [username, setUsername] = useState('owner');
  const [displayName, setDisplayName] = useState('Owner');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to="/chat" replace />;
  if (status === 'logged-out') return <Navigate to="/login" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateBootstrapForm({ username, password, confirmPassword }, t);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await bootstrapOwner({ username, displayName, password });
    setSubmitting(false);
    if (!result.ok) {
      setError(t(K.AUTH.BOOTSTRAP_FAILED));
      return;
    }
    navigate('/chat', { replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6 text-foreground">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t(K.AUTH.BOOTSTRAP_TITLE)}</CardTitle>
          <CardDescription>{t(K.AUTH.BOOTSTRAP_DESC)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              {t(K.AUTH.USERNAME)}
              <input className="rounded-md border border-input bg-background px-3 py-2" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t(K.AUTH.DISPLAY_NAME)}
              <input className="rounded-md border border-input bg-background px-3 py-2" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t(K.AUTH.PASSWORD)}
              <input className="rounded-md border border-input bg-background px-3 py-2" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <p className="text-xs text-muted-foreground">{t(K.AUTH.PASSWORD_MIN)} {t(K.AUTH.PASSWORD_NOT_USERNAME)}</p>
            <label className="flex flex-col gap-1 text-sm">
              {t(K.AUTH.CONFIRM_PASSWORD)}
              <input className="rounded-md border border-input bg-background px-3 py-2" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" disabled={submitting}>{submitting ? t(K.AUTH.BOOTSTRAPPING) : t(K.AUTH.BOOTSTRAP)}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
