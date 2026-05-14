import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
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
  const location = useLocation();
  const { status, user, mustChangePassword, checking, checkAuth } = useAuthStore();

  useEffect(() => {
    if (status === 'initial') void checkAuth();
  }, [checkAuth, status]);

  const decision = resolveAuthGuardDecision({ status, checking, role: user?.role, requireRole, mustChangePassword });

  if (decision === 'loading') {
    return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;
  }

  if (decision === 'bootstrap') {
    return <Navigate to="/bootstrap" replace state={{ from: location }} />;
  }

  if (decision === 'login') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (decision === 'password-change') {
    return (
      <div className="mx-auto flex w-full max-w-3xl">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>需要重置密码</CardTitle>
            <CardDescription>当前 Haro Web 已收缩为提案 Review 工作台，不再提供通用设置页面。</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            请联系 owner 通过 CLI 或受控运维流程重置密码。
          </CardContent>
        </Card>
      </div>
    );
  }

  if (decision === 'forbidden') {
    return (
      <div className="mx-auto flex w-full max-w-3xl">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>403 · 权限不足</CardTitle>
            <CardDescription>当前账号不能访问这个 Haro Web 操作。</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            当前角色：{user?.role ?? 'anonymous'} / 需要角色：{requireRole}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
