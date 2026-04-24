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

export function HomePage() {
  const [isRoadmapOpen, setIsRoadmapOpen] = useState(false);

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
              <CardDescription>i18n、fetch wrapper、auth store 骨架已创建。</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              仅保留占位结构，不包含任何业务接口或实际认证流程。
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
