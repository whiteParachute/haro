import { NavLink } from 'react-router-dom';

import { navigationItems } from '@/components/layout/navigation';
import { cn } from '@/lib/utils';
import { canAccessRole } from '@/router/roles';
import { useAuthStore } from '@/stores/auth';

export function Sidebar() {
  const user = useAuthStore((state) => state.user);
  const visibleItems = navigationItems.filter((item) => canAccessRole(user?.role, item.requireRole));
  return (
    <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-slate-950 text-white shadow-[18px_0_70px_rgba(15,23,42,0.22)] md:flex md:flex-col">
      <div className="relative overflow-hidden border-b border-white/10 px-6 py-7">
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-cyan-400/20 blur-3xl" />
        <p className="relative text-xs font-bold uppercase tracking-[0.34em] text-cyan-200/80">Haro</p>
        <h1 className="relative mt-2 text-2xl font-black tracking-[-0.06em]">Proposal Review</h1>
        <p className="relative mt-2 text-sm leading-6 text-slate-300">AgentDock sidecar 提案审批台</p>
      </div>

      <nav className="flex-1 space-y-2 px-4 py-5">
        {visibleItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all',
                isActive
                  ? 'bg-white text-slate-950 shadow-[0_16px_45px_rgba(255,255,255,0.13)]'
                  : 'text-slate-400 hover:bg-white/8 hover:text-white',
              )
            }
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-current transition group-hover:bg-white/12">
              <Icon className="h-4 w-4" />
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="m-4 rounded-[1.25rem] border border-cyan-200/15 bg-cyan-200/8 p-4 text-xs leading-5 text-cyan-50/80">
        <p className="font-bold uppercase tracking-[0.22em] text-cyan-200">Rule</p>
        <p className="mt-2">所有自动提案先人审；Haro Web 只做看板，不承担 workflow runtime。</p>
      </div>
    </aside>
  );
}
