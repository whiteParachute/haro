import { Outlet } from 'react-router-dom';

import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export function RootLayout() {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-80 [background:radial-gradient(circle_at_7%_2%,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_92%_8%,rgba(245,158,11,0.16),transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.92),rgba(241,245,249,0.72))] dark:[background:radial-gradient(circle_at_5%_5%,rgba(34,211,238,0.13),transparent_32%),radial-gradient(circle_at_90%_8%,rgba(251,191,36,0.09),transparent_25%),linear-gradient(180deg,rgba(2,6,23,1),rgba(15,23,42,0.92))]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.18] [background-image:linear-gradient(rgba(15,23,42,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.18)_1px,transparent_1px)] [background-size:48px_48px] dark:opacity-[0.12] dark:[background-image:linear-gradient(rgba(255,255,255,0.22)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.22)_1px,transparent_1px)]" />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-7 md:py-7 xl:px-9">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
