import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function ChatInput({
  onSubmit,
  onCancel,
  running = false,
  disabled = false,
  disabledReason,
}: {
  onSubmit: (content: string) => void;
  onCancel?: () => void;
  running?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const content = value.trim();
        if (!content) return;
        onSubmit(content);
        setValue('');
      }}
    >
      <div className="flex gap-2">
        <input
          className="min-h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="输入消息，或使用 /new /retry /agent <id> /model <provider> <model>"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {running ? (
          <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
        ) : null}
        <Button type="submit" disabled={running || disabled}>发送</Button>
      </div>
      {disabled && disabledReason ? (
        <span className="text-xs text-destructive">{disabledReason}</span>
      ) : null}
    </form>
  );
}
