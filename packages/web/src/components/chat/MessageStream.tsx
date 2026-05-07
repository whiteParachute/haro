import { useEffect, useRef } from 'react';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import type { ChatMessage } from '@/stores/chat';
import { MessageBubble } from './MessageBubble';

/**
 * Virtualized message stream (FEAT-034 R9 / G6 / AC5).
 *
 * react-window keeps the DOM cost flat at O(visible window) so 1000-message
 * sessions still hit the < 200ms initial render budget. We use
 * VariableSizeList because bubbles vary widely (a multi-line code block dwarfs
 * a one-line ack). Heights are estimated via a fixed line ratio + measured
 * after first render to avoid jumpiness when streaming deltas land.
 *
 * A small viewport (≤ 12 messages) skips virtualization to dodge ResizeObserver
 * overhead and let prose-style layouts breathe.
 */

const VIRTUALIZATION_THRESHOLD = 24;
const ESTIMATED_BUBBLE_HEIGHT = 96;
const VIEWPORT_HEIGHT = 560;

export interface MessageStreamProps {
  messages: ChatMessage[];
}

export function MessageStream({ messages }: MessageStreamProps) {
  if (messages.length === 0) {
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground">
        选择 Agent 后发送第一条消息；历史消息按需加载，避免一次性展开全部上下文。
      </div>
    );
  }

  if (messages.length < VIRTUALIZATION_THRESHOLD) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    );
  }

  return <VirtualizedList messages={messages} />;
}

function VirtualizedList({ messages }: MessageStreamProps) {
  const listRef = useRef<VariableSizeList>(null);
  const sizesRef = useRef<Map<number, number>>(new Map());

  // Reset stored sizes whenever the message length jumps (new session, pruned
  // history, etc.) so stale measurements don't pin the wrong row heights.
  useEffect(() => {
    sizesRef.current = new Map();
    listRef.current?.resetAfterIndex(0, true);
  }, [messages.length]);

  const getItemSize = (index: number) => sizesRef.current.get(index) ?? ESTIMATED_BUBBLE_HEIGHT;

  const setItemSize = (index: number, size: number) => {
    if (sizesRef.current.get(index) === size) return;
    sizesRef.current.set(index, size);
    listRef.current?.resetAfterIndex(index);
  };

  return (
    <div className="rounded-xl border border-border bg-background">
      <VariableSizeList
        ref={listRef}
        height={VIEWPORT_HEIGHT}
        width="100%"
        itemCount={messages.length}
        itemSize={getItemSize}
        estimatedItemSize={ESTIMATED_BUBBLE_HEIGHT}
        itemKey={(index) => messages[index]!.id}
      >
        {(props: ListChildComponentProps) => (
          <Row
            index={props.index}
            style={props.style}
            message={messages[props.index]!}
            onMeasure={setItemSize}
          />
        )}
      </VariableSizeList>
    </div>
  );
}

interface RowProps {
  index: number;
  style: React.CSSProperties;
  message: ChatMessage;
  onMeasure: (index: number, size: number) => void;
}

function Row({ index, style, message, onMeasure }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    onMeasure(index, ref.current.getBoundingClientRect().height + 12);
  }, [index, message.content, message.bucket?.thinking, onMeasure]);
  return (
    <div style={style}>
      <div ref={ref} className="px-4 py-1.5">
        <MessageBubble message={message} />
      </div>
    </div>
  );
}
