import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { RootLayout } from '@/components/layout/RootLayout';
import { navigationItems } from '@/components/layout/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { HomePage } from '@/pages/HomePage';
import { ChatPage } from '@/pages/ChatPage';
import { ChannelPage } from '@/pages/ChannelPage';
import { DispatchPage } from '@/pages/DispatchPage';
import { GatewayPage } from '@/pages/GatewayPage';
import { AgentEditorPage } from '@/pages/AgentEditorPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { SessionDetailPage } from '@/pages/SessionDetailPage';
import { StatusPage } from '@/pages/StatusPage';
import { SettingsPage } from '@/pages/SettingsPage';

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          此页面将在后续 FEAT 中逐步补齐，目前仅保留导航占位与布局结构。
        </CardContent>
      </Card>
    </div>
  );
}

function DispatchDebuggerPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Dispatch / Orchestration Debugger</CardTitle>
          <CardDescription>
            FEAT-018 只读编排调试入口，用于查看 workflow 拓扑、checkpoint 与 stalled branch。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h2 className="mb-2 font-medium text-foreground">Workflow read model</h2>
            <p>
              读取 <code>/api/v1/workflows*</code> 展示 workflow list/detail/checkpoints， 并突出
              blocked、needs-human-intervention 与 stalled 状态。
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h2 className="mb-2 font-medium text-foreground">Fork-and-merge graph</h2>
            <p>branch 必须平行排列并统一汇入 merge，页面不得暗示 branch-to-branch 串行 handoff。</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h2 className="mb-2 font-medium text-foreground">Checkpoint debug drawer</h2>
            <p>
              点击 checkpoint 后只读展示 rawContextRefs、branchState、merge envelope、
              leafSessionRefs 与完整结构化 JSON。
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h2 className="mb-2 font-medium text-foreground">Guard summaries</h2>
            <p>
              预算/权限摘要只消费 FEAT-023 guard read model，不在前端重复实现策略引擎， 也不提供
              approve / continue / stop 写操作。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
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
];
const placeholderRoutes = navigationItems.filter((item) => !concreteRoutes.includes(item.to));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<HomePage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="dispatch" element={<DispatchPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="status" element={<StatusPage />} />
          <Route path="channels" element={<ChannelPage />} />
          <Route path="gateway" element={<GatewayPage />} />
          <Route path="agents" element={<AgentEditorPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="dispatch" element={<DispatchDebuggerPage />} />
          {placeholderRoutes.map((item) => (
            <Route
              key={item.to}
              path={item.to.slice(1)}
              element={<PlaceholderPage title={item.title} description={item.description} />}
            />
          ))}
          <Route
            path="*"
            element={<PlaceholderPage title="页面未找到" description="当前访问的路由尚未定义。" />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
