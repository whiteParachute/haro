import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Collapsible "extended thinking" panel (FEAT-034 G1 / R3 / R4 / AC1).
 *
 * Default collapsed; click toggles. We render thinking inline as plain text
 * (not Markdown) because reasoning streams typically include markdown-like
 * syntax that would fight react-markdown for the same characters and produce
 * confusing output during partial deltas.
 */

export interface ThinkingPanelProps {
  content: string;
  /** When true, the caret pulses to hint that thinking is still streaming. */
  streaming?: boolean;
}

export function ThinkingPanel({ content, streaming }: ThinkingPanelProps) {
  const [open, setOpen] = useState(false);
  if (!content.trim()) return null;
  return (
    <div className="mt-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        data-testid="thinking-toggle"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90', streaming && 'animate-pulse')}
        />
        <span className="font-medium">Thinking</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {streaming ? 'streaming' : 'complete'}
        </span>
      </button>
      {open ? (
        <pre
          className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-muted-foreground/20 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground"
          data-testid="thinking-content"
        >
          {content}
        </pre>
      ) : null}
    </div>
  );
}
