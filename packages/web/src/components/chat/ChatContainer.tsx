import type { ChatMessage } from '@/stores/chat';
import { MessageBubble } from './MessageBubble';

export function ChatContainer({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex min-h-[28rem] flex-col gap-3 rounded-xl border border-border bg-background p-4">
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          选择 Agent 后发送第一条消息；历史消息按需加载，避免一次性展开全部上下文。
        </div>
      ) : (
        messages.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
    </div>
  );
}
