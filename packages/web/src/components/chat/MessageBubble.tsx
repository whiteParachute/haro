import { useMemo } from 'react';
import type { ChatMessage } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ThinkingPanel } from './ThinkingPanel';

/**
 * Single message rendered with the FEAT-034 GFM Markdown pipeline + collapsible
 * thinking panel. Tool calls now live in the side timeline (ToolTimeline) so
 * they don't crowd the main flow; legacy bubbles that still carry inline tool
 * events are degraded gracefully through the bucket data on the message.
 */
export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const thinking = message.bucket?.thinking ?? '';
  const streaming = message.bucket?.streaming ?? false;

  const renderedContent = useMemo(() => message.content || (streaming ? ' ' : ''), [message.content, streaming]);

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-xl border px-4 py-3 sm:max-w-[78%]',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground',
        )}
      >
        <MarkdownRenderer content={renderedContent} />
        {!isUser && thinking ? <ThinkingPanel content={thinking} streaming={streaming} /> : null}
      </div>
    </div>
  );
}
