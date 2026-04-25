import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function ChatInput({ onSubmit }: { onSubmit: (content: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const content = value.trim();
        if (!content) return;
        onSubmit(content);
        setValue('');
      }}
    >
      <input
        className="min-h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="输入消息，或使用 /new /retry /agent <id> /model <provider> <model>"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit">发送</Button>
    </form>
  );
}
