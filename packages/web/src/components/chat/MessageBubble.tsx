import { useState } from 'react';
import type { ChatMessage } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { StreamingText } from './StreamingText';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const toolEvents = message.events.filter((event) => event.type === 'tool_call' || event.type === 'tool_result');
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[78%] rounded-xl border px-4 py-3', isUser ? 'bg-primary text-primary-foreground' : 'bg-card')}>
        <StreamingText content={message.content} />
        {toolEvents.length > 0 ? (
          <div className="mt-3 border-t border-border pt-2 text-xs">
            <button className="text-muted-foreground underline" onClick={() => setExpanded((value) => !value)}>
              {expanded ? '收起 tool 事件' : `展开 ${toolEvents.length} 条 tool 事件`}
            </button>
            {expanded ? (
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-2 text-muted-foreground">
                {JSON.stringify(toolEvents, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
