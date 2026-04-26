import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog';

interface SkillInstallDialogProps {
  onInstall: (source: string) => Promise<void> | void;
}

export function SkillInstallDialog({ onInstall }: SkillInstallDialogProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Install user skill</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install user skill</DialogTitle>
          <DialogDescription>
            安装会写入 Evolution Asset Registry audit event；代谢清理请走 haro shit 流程，本页面不直接执行。
          </DialogDescription>
        </DialogHeader>
        <label className="mt-4 flex flex-col gap-2 text-sm">
          Source path or git URL
          <input
            className="rounded-md border border-border bg-background px-3 py-2"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="/path/to/skill"
          />
        </label>
        <DialogFooter>
          <Button
            onClick={() => {
              void onInstall(source);
              setOpen(false);
              setSource('');
            }}
            disabled={source.trim().length === 0}
          >
            Install with audit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
