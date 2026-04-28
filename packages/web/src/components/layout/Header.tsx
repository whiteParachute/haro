import { useLocation } from 'react-router-dom';

import { fallbackPageMeta, navigationItems } from '@/components/layout/navigation';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useAuthStore } from '@/stores/auth';

export function Header() {
  const t = useT();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const header =
    navigationItems.find((item) => item.to === location.pathname) ??
    (location.pathname.startsWith('/sessions/')
      ? { titleKey: K.NAV.SESSIONS, descriptionKey: K.NAV.SESSIONS_DESC, title: '会话详情', description: '查看完整事件时间线。' }
      : fallbackPageMeta);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-6 py-4 backdrop-blur md:px-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t(header.titleKey)}</h2>
          <p className="text-sm text-muted-foreground">{t(header.descriptionKey)}</p>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {user.displayName?.slice(0, 1).toUpperCase() ?? 'U'}
              </span>
              <span className="hidden sm:inline">{user.displayName}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{user.role}</span>
              <Button variant="ghost" size="sm" onClick={() => void logout()}>{t(K.COMMON.LOGOUT)}</Button>
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
