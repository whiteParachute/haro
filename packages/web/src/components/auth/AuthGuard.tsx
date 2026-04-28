import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { canAccessRole } from '@/router/roles';
import { useAuthStore } from '@/stores/auth';
import type { WebUserRole } from '@/types';

export interface AuthGuardProps {
  children: ReactNode;
  requireRole?: WebUserRole;
}

export type AuthGuardDecision = 'loading' | 'bootstrap' | 'login' | 'password-change' | 'forbidden' | 'allow';

export function resolveAuthGuardDecision(input: {
  status: 'initial' | 'needs-bootstrap' | 'logged-out' | 'authenticated';
  checking?: boolean;
  role?: WebUserRole;
  requireRole?: WebUserRole;
  mustChangePassword?: boolean;
}): AuthGuardDecision {
  if (input.status === 'initial' || input.checking) return 'loading';
  if (input.status === 'needs-bootstrap') return 'bootstrap';
  if (input.status === 'logged-out') return 'login';
  if (input.mustChangePassword) return 'password-change';
  if (!canAccessRole(input.role, input.requireRole)) return 'forbidden';
  return 'allow';
}

export function AuthGuard({ children, requireRole }: AuthGuardProps) {
  const t = useT();
  const location = useLocation();
  const { status, user, mustChangePassword, checking, checkAuth } = useAuthStore();

  useEffect(() => {
    if (status === 'initial') void checkAuth();
  }, [checkAuth, status]);

  const decision = resolveAuthGuardDecision({ status, checking, role: user?.role, requireRole, mustChangePassword });

  if (decision === 'loading') {
    return <p className="p-6 text-sm text-muted-foreground">{t(K.COMMON.LOADING)}</p>;
  }

  if (decision === 'bootstrap') {
    return <Navigate to="/bootstrap" replace state={{ from: location }} />;
  }

  if (decision === 'login') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (decision === 'password-change') {
    return <Navigate to="/settings?tab=security" replace state={{ from: location }} />;
  }

  if (decision === 'forbidden') {
    return (
      <div className="mx-auto flex w-full max-w-3xl">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>403 · {t(K.COMMON.FORBIDDEN_TITLE)}</CardTitle>
            <CardDescription>{t(K.COMMON.FORBIDDEN_DESC)}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t(K.COMMON.ROLE)}: {user?.role ?? 'anonymous'} / {t(K.COMMON.REQUIRED_ROLE)}: {requireRole}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
