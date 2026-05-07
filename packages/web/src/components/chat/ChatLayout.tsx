import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Responsive chat shell (FEAT-034 R11 / D1 / G7 / AC8).
 *
 * On viewports ≥ md the layout splits into a 2/3 message column + 1/3 timeline
 * column; below md the timeline collapses into a bottom sheet that the user
 * opens via a single button. We listen on `window.matchMedia` instead of just
 * Tailwind classes so the timeline component can also unmount when hidden,
 * which dodges expensive re-renders on small devices.
 */

const MD_BREAKPOINT = '(min-width: 768px)';

export interface ChatLayoutProps {
  main: ReactNode;
  side: ReactNode;
  /** Header content that should stay above both columns (config card etc). */
  header?: ReactNode;
  /** Visible label for the timeline open / close button on small viewports. */
  timelineLabel?: string;
}

export function ChatLayout({ main, side, header, timelineLabel = 'Tool Timeline' }: ChatLayoutProps) {
  const [isWide, setIsWide] = useState(() => safeMatch(MD_BREAKPOINT));
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia(MD_BREAKPOINT);
    const handler = (event: MediaQueryListEvent | MediaQueryList) => setIsWide(Boolean(event.matches));
    handler(media);
    media.addEventListener?.('change', handler);
    return () => media.removeEventListener?.('change', handler);
  }, []);

  if (isWide) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2 min-w-0">{main}</div>
          <aside className="md:col-span-1 min-w-0">{side}</aside>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      <div className="min-w-0">{main}</div>
      <button
        type="button"
        onClick={() => setDrawerOpen((value) => !value)}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-medium"
        aria-expanded={drawerOpen}
        data-testid="timeline-drawer-toggle"
      >
        {drawerOpen ? `收起 ${timelineLabel}` : `展开 ${timelineLabel}`}
      </button>
      <div
        className={cn(
          'overflow-hidden rounded-md border border-border bg-card transition-[max-height]',
          drawerOpen ? 'max-h-[60vh]' : 'max-h-0 border-0',
        )}
      >
        <div className="max-h-[60vh] overflow-auto p-3">{side}</div>
      </div>
    </div>
  );
}

function safeMatch(query: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return true;
  }
}
