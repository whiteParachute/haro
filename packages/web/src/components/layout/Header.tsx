import { useLocation } from 'react-router-dom';

import { fallbackPageMeta, navigationItems } from '@/components/layout/navigation';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

export function Header() {
  const location = useLocation();
  const header = navigationItems.find((item) => item.to === location.pathname) ?? fallbackPageMeta;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-6 py-4 backdrop-blur md:px-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{header.title}</h2>
          <p className="text-sm text-muted-foreground">{header.description}</p>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
