import { useMemo, useState, type ReactNode } from 'react';
import type { ToolCallNode } from '@haro/core/stream';
import { cn } from '@/lib/utils';

/**
 * Tool Call Timeline (FEAT-034 G2 / R5 / R6 / AC2 / AC3).
 *
 * Renders the most recent N (default 30) tool calls for the current session,
 * supports up to 3 levels of nesting (deeper trees fold into a "more children"
 * affordance), and surfaces hook pre/post status using the shadcn/ui token set.
 *
 * We accept a flat `nodes` array and assemble the tree at render time so the
 * caller (chat store) can keep its update path append-only.
 */

const MAX_RECENT = 30;
const MAX_DEPTH = 3;

export interface ToolTimelineProps {
  nodes: readonly ToolCallNode[];
  /** Override the recent-window cap (R5 says default 30). */
  limit?: number;
}

export function ToolTimeline({ nodes, limit = MAX_RECENT }: ToolTimelineProps) {
  const recent = useMemo(() => nodes.slice(-limit), [nodes, limit]);
  const tree = useMemo(() => buildTree(recent), [recent]);

  if (recent.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        当前 session 还没有工具调用。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="tool-timeline">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>最近 {recent.length} 个调用</span>
        {nodes.length > recent.length ? (
          <span aria-label="历史已截断">{nodes.length - recent.length} 条更早已折叠</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        {tree.map((node) => (
          <ToolNode key={node.callId} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

interface TreeNode extends ToolCallNode {
  children: TreeNode[];
}

function buildTree(nodes: readonly ToolCallNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const node of nodes) byId.set(node.callId, { ...node, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.parentCallId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function ToolNode({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(true);
  const overflow = depth >= MAX_DEPTH && node.children.length > 0;
  return (
    <div
      className={cn(
        'rounded-md border bg-card text-xs',
        node.status === 'error'
          ? 'border-destructive/40'
          : node.status === 'pending'
            ? 'border-ring/40'
            : 'border-border',
      )}
      style={{
        marginInlineStart: depth > 0 ? `${Math.min(depth, MAX_DEPTH) * 0.75}rem` : undefined,
      }}
      data-testid="tool-node"
      data-call-id={node.callId}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
        aria-expanded={open}
      >
        <StatusBadge status={node.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono font-medium">{node.tool}</span>
            {node.hookName ? <HookBadge node={node} /> : null}
            {typeof node.durationMs === 'number' ? (
              <span className="text-muted-foreground">{formatDuration(node.durationMs)}</span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {node.paramsSummary}
          </div>
          {node.errorMessage ? (
            <div className="mt-1 break-words rounded bg-destructive/10 p-1 text-[11px] text-destructive">
              {node.errorCode ? <span className="font-medium">{node.errorCode}: </span> : null}
              {node.errorMessage}
            </div>
          ) : null}
        </div>
      </button>
      {open && open && node.children.length > 0 ? (
        depth < MAX_DEPTH ? (
          <div className="border-t border-border bg-background/30 px-2 py-1">
            {node.children.map((child) => (
              <ToolNode key={child.callId} node={child} depth={depth + 1} />
            ))}
          </div>
        ) : (
          <div className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
            +{node.children.length} 子调用已折叠（嵌套深度 ≥ {MAX_DEPTH}）
          </div>
        )
      ) : null}
      {overflow && !open ? null : null}
    </div>
  );
}

function StatusBadge({ status }: { status: ToolCallNode['status'] }) {
  const map: Record<ToolCallNode['status'], { label: string; classes: string }> = {
    pending: { label: '运行中', classes: 'bg-muted text-muted-foreground' },
    success: { label: '成功', classes: 'bg-primary/15 text-primary' },
    error: { label: '失败', classes: 'bg-destructive/15 text-destructive' },
  };
  const view = map[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
        view.classes,
      )}
    >
      {view.label}
    </span>
  );
}

function HookBadge({ node }: { node: TreeNode }) {
  const segments: ReactNode[] = [];
  if (node.hookPre) {
    segments.push(
      <span
        key="pre"
        className={cn(
          'rounded px-1 text-[10px]',
          node.hookPre === 'pending'
            ? 'bg-muted text-muted-foreground'
            : node.hookPre === 'allowed'
              ? 'bg-primary/15 text-primary'
              : 'bg-destructive/15 text-destructive',
        )}
      >
        pre:{node.hookPre}
      </span>,
    );
  }
  if (node.hookPost) {
    segments.push(
      <span
        key="post"
        className={cn(
          'rounded px-1 text-[10px]',
          node.hookPost === 'success'
            ? 'bg-primary/15 text-primary'
            : 'bg-destructive/15 text-destructive',
        )}
      >
        post:{node.hookPost}
      </span>,
    );
  }
  if (segments.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1" data-testid="tool-hook-badge">
      <span className="text-muted-foreground">{node.hookName}</span>
      {segments}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m${seconds}s`;
}
