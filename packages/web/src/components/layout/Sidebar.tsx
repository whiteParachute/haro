import { NavLink } from 'react-router-dom';

import { navigationItems } from '@/components/layout/navigation';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { canAccessRole } from '@/router/roles';
import { useAuthStore } from '@/stores/auth';

export function Sidebar() {
  const t = useT();
  const user = useAuthStore((state) => state.user);
  const visibleItems = navigationItems.filter((item) => canAccessRole(user?.role, item.requireRole));
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="border-b border-border px-5 py-6">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Haro</p>
        <h1 className="mt-2 text-xl font-semibold">{t(K.COMMON.DASHBOARD)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(K.NAV.SHELL_SUBTITLE)}</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {visibleItems.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
