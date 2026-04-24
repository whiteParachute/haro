import { NavLink } from 'react-router-dom';

import { navigationItems } from '@/components/layout/navigation';
import { cn } from '@/lib/utils';

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="border-b border-border px-5 py-6">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Haro
        </p>
        <h1 className="mt-2 text-xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Phase 1 foundation shell</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigationItems.map(({ to, label, icon: Icon, end }) => (
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
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
