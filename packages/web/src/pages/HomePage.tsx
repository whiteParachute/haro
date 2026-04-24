import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { AUTH_API_KEY_STORAGE_KEY, useAuthStore } from '@/stores/auth';

export function HomePage() {
  const [isRoadmapOpen, setIsRoadmapOpen] = useState(false);
  const { apiKey, clearAuth, isAuthenticated, setApiKey } = useAuthStore();
  const [apiKeyInput, setApiKeyInput] = useState(apiKey ?? '');
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  function handleSaveApiKey() {
    setApiKey(apiKeyInput);
    setAuthMessage(
      apiKeyInput.trim().length > 0
        ? 'API key 已保存，后续 /api 请求会携带 x-api-key。'
        : 'API key 为空，已切换为无认证配置。',
    );
  }

  function handleClearApiKey() {
    clearAuth();
    setApiKeyInput('');
    setAuthMessage('API key 已清除。');
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-primary">
            FEAT-015 / Foundation
          </p>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Haro Dashboard</h1>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            Web Dashboard 基础框架已就位。当前版本仅包含布局、主题切换、基础组件和占位首页，
            后续页面将在接下来的 FEAT 中逐步接入。
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={() => setIsRoadmapOpen(true)}>查看占位说明</Button>
            <span className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground">
              Version: 0.1.0-placeholder
            </span>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Layout Shell</CardTitle>
              <CardDescription>Sidebar / Header / content 区域已搭好。</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              为后续 Chat、Sessions、Status、Settings 页面预留导航与主内容区。
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Theme Toggle</CardTitle>
              <CardDescription>支持浅色、深色、跟随系统三态切换。</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              当前主题持久化到 localStorage（key = haro:theme），刷新页面后仍可保留。
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Foundation APIs</CardTitle>
              <CardDescription>i18n、fetch wrapper、auth store 与 API key 链路已创建。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                若后端配置了 <code>HARO_WEB_API_KEY</code>，请在此保存同一个 key；
                API client 会自动注入 <code>x-api-key</code>。
              </p>
              <div className="space-y-2">
                <label
                  className="block text-xs font-medium uppercase tracking-wide text-foreground"
                  htmlFor="dashboard-api-key"
                >
                  Dashboard API key
                </label>
                <input
                  id="dashboard-api-key"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={`localStorage: ${AUTH_API_KEY_STORAGE_KEY}`}
                  type="password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.currentTarget.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleSaveApiKey}>
                  保存 API key
                </Button>
                <Button size="sm" variant="secondary" onClick={handleClearApiKey}>
                  清除
                </Button>
              </div>
              <p className="text-xs">
                当前状态：
                <span className={isAuthenticated ? 'text-primary' : 'text-muted-foreground'}>
                  {isAuthenticated ? ' 已配置 API key' : ' 未配置 API key'}
                </span>
              </p>
              {authMessage ? <p className="text-xs text-foreground">{authMessage}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isRoadmapOpen} onOpenChange={setIsRoadmapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>占位说明</DialogTitle>
            <DialogDescription>
              当前首页仅用于验证前端基础框架接入成功，不承载业务逻辑。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>• Sidebar 导航已为后续页面预留路由入口。</p>
            <p>• ThemeToggle 已具备可工作的主题切换与持久化能力。</p>
            <p>• API client / Zustand store / i18n 目前都只包含最小可扩展骨架。</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsRoadmapOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
