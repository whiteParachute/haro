import { BrowserRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { RootLayout } from '@/components/layout/RootLayout';
import { navigationItems } from '@/components/layout/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { BootstrapPage } from '@/pages/BootstrapPage';
import { ChatPage } from '@/pages/ChatPage';
import { ChannelPage } from '@/pages/ChannelPage';
import { DispatchPage } from '@/pages/DispatchPage';
import { GatewayPage } from '@/pages/GatewayPage';
import { AgentEditorPage } from '@/pages/AgentEditorPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { SessionDetailPage } from '@/pages/SessionDetailPage';
import { StatusPage } from '@/pages/StatusPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { KnowledgePage } from '@/pages/KnowledgePage';
import { InvokeAgentPage } from '@/pages/InvokeAgentPage';
import { LogsPage } from '@/pages/LogsPage';
import { MonitorPage } from '@/pages/MonitorPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { UsersPage } from '@/pages/UsersPage';
import type { WebUserRole } from '@/types';

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-4xl">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t(K.TABLE.EMPTY)}
        </CardContent>
      </Card>
    </div>
  );
}

function guard(element: ReactNode, requireRole?: WebUserRole) {
  return <AuthGuard requireRole={requireRole}>{element}</AuthGuard>;
}

const concreteRoutes = [
  '/',
  '/chat',
  '/sessions',
  '/status',
  '/settings',
  '/channels',
  '/gateway',
  '/agents',
  '/dispatch',
  '/knowledge',
  '/logs',
  '/invoke',
  '/monitor',
  '/skills',
  '/users',
];
const placeholderRoutes = navigationItems.filter((item) => !concreteRoutes.includes(item.to));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="bootstrap" element={<BootstrapPage />} />
        <Route element={<RootLayout />}>
          <Route index element={guard(<HomePage />)} />
          <Route path="chat" element={guard(<ChatPage />)} />
          <Route path="dispatch" element={guard(<DispatchPage />)} />
          <Route path="sessions" element={guard(<SessionsPage />)} />
          <Route path="sessions/:id" element={guard(<SessionDetailPage />)} />
          <Route path="status" element={guard(<StatusPage />)} />
          <Route path="channels" element={guard(<ChannelPage />)} />
          <Route path="gateway" element={guard(<GatewayPage />)} />
          <Route path="agents" element={guard(<AgentEditorPage />)} />
          <Route path="knowledge" element={guard(<KnowledgePage />)} />
          <Route path="logs" element={guard(<LogsPage />)} />
          <Route path="invoke" element={guard(<InvokeAgentPage />)} />
          <Route path="monitor" element={guard(<MonitorPage />)} />
          <Route path="skills" element={guard(<SkillsPage />)} />
          <Route path="settings" element={guard(<SettingsPage />)} />
          <Route path="users" element={guard(<UsersPage />, 'admin')} />
          {placeholderRoutes.map((item) => (
            <Route
              key={item.to}
              path={item.to.slice(1)}
              element={guard(<PlaceholderPage title={item.title} description={item.description} />, item.requireRole)}
            />
          ))}
          <Route path="*" element={<PlaceholderPage title="404" description="Not found" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
