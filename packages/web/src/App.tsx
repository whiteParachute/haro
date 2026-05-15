import { BrowserRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { RootLayout } from '@/components/layout/RootLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { ApprovalRequestsPage } from '@/pages/ApprovalRequestsPage';
import { LoginPage } from '@/pages/LoginPage';
import { BootstrapPage } from '@/pages/BootstrapPage';
import type { WebUserRole } from '@/types';

function NotFoundPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>404</CardTitle>
          <CardDescription>Haro Web 只保留提案 Review 工作台。</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          旧 Dashboard / chat / config 页面已下线；Haro Web
          负责每日情报收集状态与提案人审，AgentDock 仅作为 sidecar 交互底座。
        </CardContent>
      </Card>
    </div>
  );
}

function guard(element: ReactNode, requireRole?: WebUserRole) {
  return <AuthGuard requireRole={requireRole}>{element}</AuthGuard>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="bootstrap" element={<BootstrapPage />} />
        <Route element={<RootLayout />}>
          <Route index element={guard(<ApprovalRequestsPage />)} />
          <Route path="*" element={guard(<NotFoundPage />)} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
