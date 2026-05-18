import { useLocation } from 'react-router-dom';

import { fallbackPageMeta, navigationItems } from '@/components/layout/navigation';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth';

export function Header() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const header = navigationItems.find((item) => item.to === location.pathname) ?? fallbackPageMeta;

  return (
    <header className="sticky top-0 z-20 border-b border-slate-950/10 bg-white/72 px-4 py-3 shadow-[0_12px_50px_rgba(15,23,42,0.06)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/70 md:px-7">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-300">
            <span className="hidden h-px w-8 bg-current md:block" />
            Haro Review Board
          </div>
          <h2 className="mt-1 truncate text-xl font-black tracking-[-0.045em]">{header.title}</h2>
          <p className="hidden text-sm text-muted-foreground sm:block">{header.description}</p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {user ? (
            <div className="flex items-center gap-2 rounded-full border border-slate-950/10 bg-white/78 px-2 py-1 text-sm shadow-sm dark:border-white/10 dark:bg-white/8">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white dark:bg-white dark:text-slate-950">
                {user.displayName?.slice(0, 1).toUpperCase() ?? 'U'}
              </span>
              <span className="hidden font-semibold sm:inline">{user.displayName}</span>
              <span className="hidden rounded-full bg-cyan-400/12 px-2 py-0.5 text-xs font-semibold text-cyan-700 dark:text-cyan-200 md:inline">
                {user.role}
              </span>
              <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void logout()}>
                退出
              </Button>
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
