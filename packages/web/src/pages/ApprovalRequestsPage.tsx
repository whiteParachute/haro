import { useEffect, useMemo, useRef, useState } from 'react';
import {
  appendApprovalConversationMessage,
  createApprovalConversation,
  decideApprovalRequest,
  listApprovalConversations,
  listApprovalRequests,
  streamApprovalConversationAgentReply,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import type {
  ApprovalConversationMessage,
  ApprovalConversationRecord,
  ApprovalDecisionOption,
  ApprovalLifecycleStatus,
  ApprovalRequestView,
} from '@/types';

const EXPANDED_STORAGE_KEY = 'haro.approval.expanded.v1';
const USE_LEGACY_REQUEST_CHANGES_PROMPT = import.meta.env.VITE_HARO_LEGACY_REQUEST_CHANGES_PROMPT === '1';

const lifecycleOrder: ApprovalLifecycleStatus[] = ['undecided', 'approved', 'applied', 'rejected', 'rolled-back'];

const lifecycleLabel: Record<ApprovalLifecycleStatus, string> = {
  undecided: '待决策',
  approved: '已通过',
  applied: '已应用',
  rejected: '已退回',
  'rolled-back': '已回滚',
};

const lifecycleCaption: Record<ApprovalLifecycleStatus, string> = {
  undecided: '还没有人审结论',
  approved: '已通过，等待后续应用',
  applied: '已写入 Haro 资产',
  rejected: '已驳回或要求修改',
  'rolled-back': '已执行回滚',
};

const decisionLabel: Record<ApprovalDecisionOption, string> = {
  approve: '通过',
  reject: '驳回',
  'request-changes': '要求修改',
};

const targetKindLabel: Record<string, string> = {
  'mcp-tool-config': 'MCP 工具配置',
  'runner-profile': '运行策略',
  'schedule-config': '调度配置',
  skill: 'Skill',
  prompt: 'Prompt',
  'routing-rule': '路由规则',
};

const riskLevelLabel: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const riskTone = {
  low: {
    badge: 'border-emerald-300/60 bg-emerald-400/12 text-emerald-700 dark:border-emerald-300/25 dark:text-emerald-200',
    rail: 'from-emerald-300 via-cyan-300 to-sky-500',
    glow: 'shadow-[0_18px_60px_rgba(16,185,129,0.14)]',
  },
  medium: {
    badge: 'border-amber-300/70 bg-amber-400/14 text-amber-800 dark:border-amber-300/25 dark:text-amber-200',
    rail: 'from-amber-300 via-orange-300 to-rose-400',
    glow: 'shadow-[0_18px_60px_rgba(245,158,11,0.16)]',
  },
  high: {
    badge: 'border-rose-300/70 bg-rose-500/12 text-rose-800 dark:border-rose-300/25 dark:text-rose-200',
    rail: 'from-rose-400 via-red-500 to-fuchsia-500',
    glow: 'shadow-[0_18px_60px_rgba(244,63,94,0.16)]',
  },
} as const;

export function ApprovalRequestsPage() {
  const [selectedStatuses, setSelectedStatuses] = useState<ApprovalLifecycleStatus[]>(['undecided']);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [items, setItems] = useState<ApprovalRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversationView, setConversationView] = useState<ApprovalRequestView | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await listApprovalRequests('all');
      setItems([...response.data.items].sort(compareApprovalRequestViews));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(EXPANDED_STORAGE_KEY);
      if (raw) setExpandedIds(JSON.parse(raw) as string[]);
    } catch {
      setExpandedIds([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(expandedIds));
    } catch {
      // ignore unavailable sessionStorage
    }
  }, [expandedIds]);

  const counts = useMemo(() => {
    const next = Object.fromEntries(lifecycleOrder.map((status) => [status, 0])) as Record<ApprovalLifecycleStatus, number>;
    for (const item of items) next[item.lifecycle.status] += 1;
    return next;
  }, [items]);

  const filteredItems = useMemo(
    () => items.filter((item) => selectedStatuses.includes(item.lifecycle.status)),
    [items, selectedStatuses],
  );

  function toggleStatus(status: ApprovalLifecycleStatus) {
    setSelectedStatuses((current) => {
      if (current.includes(status)) {
        return current.length === 1 ? current : current.filter((item) => item !== status);
      }
      return lifecycleOrder.filter((item) => current.includes(item) || item === status);
    });
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submitDecision(view: ApprovalRequestView, decision: ApprovalDecisionOption) {
    let direction: string | undefined;
    if (decision === 'request-changes') {
      if (!USE_LEGACY_REQUEST_CHANGES_PROMPT) {
        setConversationView(view);
        return;
      }
      direction = window.prompt('请输入希望 Haro 按什么方向修改这个提案：')?.trim();
      if (!direction) return;
    }
    const verb = decisionLabel[decision];
    if (!window.confirm(`确认${verb}提案「${view.request.title}」？`)) return;

    setBusyId(view.request.id);
    setError(null);
    setNotice(null);
    try {
      await decideApprovalRequest(view.request.id, {
        decision,
        ...(direction ? { direction } : {}),
      });
      setNotice(`已${verb}：${view.request.title}`);
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-7 pb-10">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-950/10 bg-[#101624] px-6 py-7 text-white shadow-[0_28px_90px_rgba(15,23,42,0.26)] dark:border-white/10 dark:bg-[#080d19] md:px-8">
        <div className="absolute inset-0 opacity-80 [background:radial-gradient(circle_at_14%_16%,rgba(34,211,238,0.24),transparent_28%),radial-gradient(circle_at_84%_8%,rgba(245,158,11,0.18),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0)_0%,rgba(15,23,42,0.90)_66%)]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
        <div className="relative grid gap-7 xl:grid-cols-[1.1fr_0.9fr] xl:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/80">
              <span className="rounded-full border border-cyan-100/20 bg-white/10 px-3 py-1 backdrop-blur">Audit Docket</span>
              <span>Haro Sidecar Review</span>
            </div>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-4xl font-black tracking-[-0.06em] text-white md:text-6xl">
                Haro 提案审阅工作台
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-200 md:text-lg">
                先看人审状态，再展开看证据和生命周期。这里仍然只是看板，所有写入都要先经过人工决定。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5 xl:justify-self-end">
            {lifecycleOrder.map((status) => (
              <MetricTile key={status} label={lifecycleLabel[status]} value={counts[status]} caption={lifecycleCaption[status]} />
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-slate-950/10 bg-white/82 shadow-[0_22px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/62">
        <div className="flex flex-col gap-5 border-b border-slate-950/10 bg-gradient-to-r from-slate-50 via-white to-cyan-50/70 px-5 py-5 dark:border-white/10 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/20 md:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.32em] text-cyan-700 dark:text-cyan-300">Latest-decision view</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">Haro 改动提案</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                状态按最新人审决定和后续应用记录计算，不再使用容易误导的 pendingCount。
              </p>
            </div>
            <Button size="sm" variant="secondary" className="w-fit rounded-xl" onClick={() => void refresh()} disabled={loading}>
              刷新
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-950/10 bg-white/70 p-1.5 shadow-inner dark:border-white/10 dark:bg-white/5">
            {lifecycleOrder.map((status) => {
              const active = selectedStatuses.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  className={[
                    'rounded-xl px-4 py-2 text-sm font-semibold transition-all',
                    active
                      ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15 dark:bg-white dark:text-slate-950'
                      : 'text-muted-foreground hover:bg-slate-950/5 hover:text-foreground dark:hover:bg-white/10',
                  ].join(' ')}
                  onClick={() => toggleStatus(status)}
                >
                  {lifecycleLabel[status]} · {counts[status]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-5 p-5 md:p-7">
          {error ? (
            <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
              {notice}
            </p>
          ) : null}
          {loading ? <LoadingState /> : null}
          {!loading && filteredItems.length === 0 ? <EmptyState /> : null}
          {filteredItems.map((view, index) => (
            <ApprovalRequestCard
              key={view.request.id}
              index={index}
              view={view}
              expanded={expandedIds.includes(view.request.id)}
              busy={busyId === view.request.id}
              onToggle={() => toggleExpanded(view.request.id)}
              onDecision={(decision) => void submitDecision(view, decision)}
            />
          ))}
        </div>
      </section>
      {conversationView ? (
        <ReviewConversationPanel
          view={conversationView}
          onClose={() => setConversationView(null)}
          onSubmitted={async () => {
            setConversationView(null);
            setNotice(`已提交修改要求：${conversationView.request.title}`);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function MetricTile({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <div className="min-w-0 rounded-3xl border border-white/12 bg-white/[0.08] p-4 shadow-2xl backdrop-blur">
      <p className="truncate text-[11px] font-bold uppercase tracking-[0.20em] text-cyan-100/80">{label}</p>
      <p className="mt-3 text-4xl font-black tracking-[-0.08em] text-white">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-200/78">{caption}</p>
    </div>
  );
}

function ApprovalRequestCard({
  view,
  busy,
  index,
  expanded,
  onToggle,
  onDecision,
}: {
  view: ApprovalRequestView;
  busy: boolean;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onDecision: (decision: ApprovalDecisionOption) => void;
}) {
  const request = view.request;
  const disabled = busy || Boolean(view.latestDecision);
  const tone = riskTone[request.riskLevel];
  const status = view.lifecycle.status;
  const scopeLead = request.scope?.[0] ?? `范围：${targetKindLabel[request.targetKind] ?? request.targetKind}`;
  return (
    <article className={`group relative min-w-0 overflow-hidden rounded-[1.6rem] border border-slate-950/10 bg-white shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl dark:border-white/10 dark:bg-slate-950/88 ${tone.glow}`}>
      <div className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${tone.rail}`} />
      <div className="absolute right-0 top-0 h-36 w-36 rounded-full bg-cyan-300/10 blur-3xl transition group-hover:bg-cyan-300/18" />
      <div className="relative p-5 md:p-6">
        <button type="button" className="grid w-full min-w-0 gap-4 text-left xl:grid-cols-[minmax(0,1fr)_320px] xl:items-center" onClick={onToggle}>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-950/10 bg-slate-950 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-white dark:border-white/10 dark:bg-white dark:text-slate-950">
                #{String(index + 1).padStart(2, '0')}
              </span>
              <Badge>{request.level}</Badge>
              <Badge>{targetKindLabel[request.targetKind] ?? request.targetKind}</Badge>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`}>
                {riskLevelLabel[request.riskLevel] ?? request.riskLevel}
              </span>
              <LifecycleBadge status={status} />
              <RevisionBadge view={view} />
            </div>
            <h3 className="max-w-5xl break-words text-2xl font-black leading-tight tracking-[-0.045em] text-slate-950 [overflow-wrap:anywhere] dark:text-white">
              {request.title}
            </h3>
            <p className="break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{scopeLead}</p>
          </div>
          <div className="grid min-w-0 gap-2 rounded-[1.2rem] border border-slate-950/10 bg-slate-50/80 p-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.045]">
            <div className="flex items-center justify-between gap-3">
              <span>创建时间</span>
              <span className="text-right font-mono text-xs text-foreground">{formatDate(request.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>当前状态</span>
              <span className="font-semibold text-foreground">{lifecycleLabel[status]}</span>
            </div>
            <div className="text-xs text-muted-foreground">{expanded ? '收起详情' : '展开查看证据、内容指纹和生命周期'}</div>
          </div>
        </button>

        {expanded ? (
          <div className="mt-6 min-w-0 space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 flex-wrap gap-2 text-xs text-muted-foreground">
                  <CodePill label="提案" value={request.proposalId} />
                  <CodePill label="验证" value={request.validationId} />
                  <CodePill label="更新时间" value={formatDate(request.updatedAt)} />
                </div>
              </div>
              <DecisionPanel disabled={disabled} busy={busy} latestDecision={view.latestDecision?.decision} onDecision={onDecision} />
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-3">
              <SectionList variant="why" title="为什么改" items={request.whyChange} />
              <SectionList variant="how" title="怎么改" items={request.howChange} />
              <SectionList variant="gain" title="预期收益" items={request.expectedBenefits} />
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-3">
              <SectionList variant="risk" title="回归风险" items={request.regressionRisks} empty="未声明额外风险" />
              <SectionList variant="test" title="必须测试" items={request.requiredTests} empty="无自动测试要求" />
              <SectionList variant="check" title="人工检查" items={request.manualChecks} empty="无人工检查要求" />
            </div>

            <div className="grid min-w-0 gap-4 rounded-[1.35rem] border border-slate-950/10 bg-slate-950/[0.025] p-4 text-sm dark:border-white/10 dark:bg-white/[0.035] lg:grid-cols-2">
              {request.scope?.length ? <InfoBlock label="范围边界" text={request.scope.join(' ')} /> : null}
              <InfoBlock label="审阅说明" text={request.reviewerInstruction} />
              <InfoBlock label="回滚方案" text={`${request.rollbackPlan.strategy}。需要快照：${request.rollbackPlan.snapshotRequired ? '是' : '否'}。`} />
              {view.latestDecision?.direction ? <InfoBlock label="修改方向" text={view.latestDecision.direction} /> : null}
            </div>

            <RevisionPanel view={view} />

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <ReferencePanel view={view} />
              <LifecyclePanel view={view} />
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function DecisionPanel({
  disabled,
  busy,
  latestDecision,
  onDecision,
}: {
  disabled: boolean;
  busy: boolean;
  latestDecision?: ApprovalDecisionOption;
  onDecision: (decision: ApprovalDecisionOption) => void;
}) {
  return (
    <aside className="min-w-0 rounded-[1.25rem] border border-slate-950/10 bg-slate-50/85 p-3 dark:border-white/10 dark:bg-white/[0.045]">
      <p className="px-2 pt-1 text-xs font-bold uppercase tracking-[0.24em] text-muted-foreground">Decision</p>
      <div className="mt-3 grid gap-2">
        <Button className="h-10 rounded-xl" onClick={() => onDecision('approve')} disabled={disabled}>
          通过
        </Button>
        <Button className="h-10 rounded-xl border-cyan-500/30 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 dark:bg-cyan-400/10 dark:text-cyan-100 dark:hover:bg-cyan-400/15" variant="outline" onClick={() => onDecision('request-changes')} disabled={disabled}>
          要求修改
        </Button>
        <Button className="h-10 rounded-xl" variant="secondary" onClick={() => onDecision('reject')} disabled={disabled}>
          驳回
        </Button>
      </div>
      <p className="mt-3 px-2 text-xs leading-5 text-muted-foreground">
        {latestDecision ? `已${decisionLabel[latestDecision]}。` : busy ? '正在写入决策记录…' : '所有自动提案初期都必须人审。'}
      </p>
    </aside>
  );
}

function ReviewConversationPanel({
  view,
  onClose,
  onSubmitted,
}: {
  view: ApprovalRequestView;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}) {
  const [conversation, setConversation] = useState<ApprovalConversationRecord | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [replying, setReplying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadConversation() {
      setLoading(true);
      setError(null);
      try {
        const listed = await listApprovalConversations(view.request.id);
        const latest = listed.data.items.at(-1);
        const record = latest ?? (await createApprovalConversation(view.request.id)).data;
        if (!cancelled) {
          setHistoryCount(listed.data.total);
          setConversation(record);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadConversation();
    return () => {
      cancelled = true;
    };
  }, [view.request.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, replying]);

  async function sendMessage() {
    const content = draft.trim();
    if (!conversation || !content || replying) return;
    setDraft('');
    setReplying(true);
    setError(null);
    const requestId = view.request.id;
    try {
      const appended = await appendApprovalConversationMessage(requestId, conversation.id, content);
      const streaming: ApprovalConversationMessage = {
        id: 'approval_message_streaming',
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      setConversation({ ...appended.data, messages: [...appended.data.messages, streaming] });
      let streamed = '';
      const done = await streamApprovalConversationAgentReply(requestId, conversation.id, {
        onDelta: (chunk) => {
          streamed += chunk;
          setConversation((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.map((message) =>
                    message.id === streaming.id ? { ...message, content: streamed } : message,
                  ),
                }
              : current,
          );
        },
      });
      if (done) setConversation(done);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setReplying(false);
    }
  }

  async function submitRequestChanges() {
    if (!conversation || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let record = conversation;
      const pendingDraft = draft.trim();
      if (pendingDraft) {
        record = (await appendApprovalConversationMessage(view.request.id, conversation.id, pendingDraft)).data;
        setDraft('');
        setConversation(record);
      }
      if (!record.messages.length) {
        setError('请先写下修改意见，再提交要求修改。');
        return;
      }
      if (!window.confirm(`确认要求修改提案「${view.request.title}」？`)) return;
      await decideApprovalRequest(view.request.id, {
        decision: 'request-changes',
        conversationId: record.id,
        direction: '请按审批对话中的修改意见重写提案。',
      });
      await onSubmitted();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/58 backdrop-blur-sm">
      <section className="absolute inset-y-0 right-0 flex w-full max-w-6xl flex-col border-l border-white/12 bg-[#f7f4ef] shadow-[0_32px_120px_rgba(15,23,42,0.38)] dark:bg-[#080d18]">
        <header className="border-b border-slate-950/10 bg-white/76 px-5 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/80 md:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.32em] text-cyan-700 dark:text-cyan-300">
                Request changes conversation
              </p>
              <h2 className="mt-2 break-words text-2xl font-black tracking-[-0.04em] text-slate-950 [overflow-wrap:anywhere] dark:text-white">
                和 Haro 讨论要怎么改
              </h2>
              <p className="mt-1 max-w-3xl break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                {view.request.title}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{riskLevelLabel[view.request.riskLevel] ?? view.request.riskLevel}</Badge>
              <Badge>{targetKindLabel[view.request.targetKind] ?? view.request.targetKind}</Badge>
              <Button variant="secondary" className="rounded-xl" onClick={onClose} disabled={submitting}>
                关闭
              </Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-1">
          <aside className="hidden min-h-0 overflow-y-auto border-r border-slate-950/10 bg-white/50 p-5 dark:border-white/10 dark:bg-white/[0.035] lg:block">
            <div className="space-y-5">
              <InfoBlock label="提案范围" text={view.request.scope?.join(' ') ?? view.request.targetKind} />
              <SectionList variant="why" title="为什么改" items={view.request.whyChange} />
              <SectionList variant="how" title="怎么改" items={view.request.howChange} />
              <InfoBlock label="对话记录" text={`已加载 ${historyCount || (conversation ? 1 : 0)} 个历史对话。提交后会把摘要写入 direction，完整记录单独保存。`} />
            </div>
          </aside>

          <main className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-7">
              {error ? (
                <p role="alert" className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {loading ? (
                <div className="h-40 animate-pulse rounded-[1.5rem] bg-slate-950/5 dark:bg-white/8" />
              ) : null}
              {!loading && conversation ? (
                <div className="space-y-4">
                  {conversation.messages.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-950/15 bg-white/68 p-6 text-sm leading-6 text-muted-foreground dark:border-white/15 dark:bg-white/[0.045]">
                      先把你的修改意见写成大段文本。Haro 会继续追问或帮你整理成可执行的修改方向。
                    </div>
                  ) : null}
                  {conversation.messages.map((message) => (
                    <ConversationBubble key={message.id} message={message} />
                  ))}
                  {replying ? (
                    <p className="pl-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">
                      Haro 正在回复…
                    </p>
                  ) : null}
                  <div ref={bottomRef} />
                </div>
              ) : null}
            </div>

            <footer className="border-t border-slate-950/10 bg-white/80 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/82 md:p-5">
              <textarea
                className="min-h-[180px] w-full resize-y rounded-[1.4rem] border border-slate-950/10 bg-[#fffcf5] p-4 text-sm leading-7 text-slate-950 shadow-inner outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-300/20 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                placeholder="写下你的修改意见，可以是 Markdown、分点列表或长段背景。比如：这条提案还没有说清楚用户收益，请补充不改会怎样。"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={replying || submitting}
              />
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-xs leading-5 text-muted-foreground">
                  对话不会直接改提案。只有点击“提交要求修改”后，才会写入审批决定。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" className="rounded-xl" onClick={() => void sendMessage()} disabled={!draft.trim() || !conversation || replying || submitting}>
                    发送给 Haro
                  </Button>
                  <Button className="rounded-xl" onClick={() => void submitRequestChanges()} disabled={!conversation || replying || submitting}>
                    提交要求修改
                  </Button>
                </div>
              </div>
            </footer>
          </main>
        </div>
      </section>
    </div>
  );
}

function ConversationBubble({ message }: { message: ApprovalConversationMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <article
        className={[
          'max-w-[min(780px,100%)] rounded-[1.35rem] border p-4 shadow-sm',
          isUser
            ? 'border-slate-950/10 bg-slate-950 text-white'
            : 'border-cyan-500/20 bg-white text-slate-950 dark:bg-slate-900 dark:text-white',
        ].join(' ')}
      >
        <div className="mb-2 flex items-center justify-between gap-3 text-xs opacity-70">
          <span className="font-bold">{isUser ? '你' : 'Haro'}</span>
          <span>{formatDate(message.createdAt)}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">
          {message.content || '…'}
        </div>
      </article>
    </div>
  );
}

function RevisionBadge({ view }: { view: ApprovalRequestView }) {
  const revision = view.revision;
  if (revision.isRevision) return <Badge>{`修订 #${revision.revisionDepth ?? 0}`}</Badge>;
  if (revision.label === 'superseded-source') return <Badge>已被修订替代</Badge>;
  return null;
}

function RevisionPanel({ view }: { view: ApprovalRequestView }) {
  const revision = view.revision;
  if (!revision.isRevision && revision.label !== 'superseded-source') return null;

  if (revision.label === 'superseded-source') {
    return (
      <section className="min-w-0 rounded-[1.35rem] border border-amber-300/40 bg-amber-50/70 p-4 text-sm dark:border-amber-300/20 dark:bg-amber-400/10">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-700 dark:text-amber-200">Revision chain</p>
        <h4 className="mt-1 text-lg font-black tracking-[-0.03em]">这条旧提案已被修订替代</h4>
        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          {revision.supersededBy?.proposalId ? <CodePill label="新提案" value={revision.supersededBy.proposalId} /> : null}
          {revision.supersededBy?.approvalRequestId ? <CodePill label="新审批" value={revision.supersededBy.approvalRequestId} /> : null}
          {revision.supersededBy?.sourceDecisionId ? <CodePill label="来源意见" value={revision.supersededBy.sourceDecisionId} /> : null}
        </div>
        <p className="mt-3 break-words leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          请优先审阅新的修订提案。旧提案只保留审计链路，避免和新请求混淆。
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-[1.35rem] border border-cyan-300/40 bg-cyan-50/70 p-4 text-sm dark:border-cyan-300/20 dark:bg-cyan-400/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-200">Feedback revision</p>
          <h4 className="mt-1 text-lg font-black tracking-[-0.03em]">根据上次意见提交的修订</h4>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          {revision.rootProposalId ? <CodePill label="根提案" value={revision.rootProposalId} /> : null}
          {revision.revisionOfProposalId ? <CodePill label="父提案" value={revision.revisionOfProposalId} /> : null}
          {typeof revision.revisionDepth === 'number' ? <CodePill label="深度" value={String(revision.revisionDepth)} /> : null}
        </div>
      </div>
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
        {revision.sourceDecisionDirection ? <InfoBlock label="上次审批意见" text={revision.sourceDecisionDirection} /> : null}
        {revision.resubmissionReason ? <InfoBlock label="本次修改说明" text={revision.resubmissionReason} /> : null}
        {revision.sourceDecisionId ? <InfoBlock label="来源决策" text={revision.sourceDecisionId} /> : null}
        {revision.noOpCheck ? <InfoBlock label="no-op 检查" text={`${revision.noOpCheck.verdict}：${revision.noOpCheck.reason}`} /> : null}
      </div>
      <RevisionFeedbackList title="已吸收的意见" items={revision.incorporatedFeedback} empty="没有记录已吸收项" />
      <RevisionFeedbackList title="未解决的意见" items={revision.unresolvedFeedback} empty="没有未解决项" />
      {revision.sourceConversationRefs.length ? (
        <div className="mt-4 min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">对话引用</p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            {revision.sourceConversationRefs.map((ref) => <CodePill key={ref} label="conversation" value={ref} />)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RevisionFeedbackList({
  title,
  items,
  empty,
}: {
  title: string;
  items: ApprovalRequestView['revision']['incorporatedFeedback'];
  empty: string;
}) {
  return (
    <div className="mt-4 min-w-0">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
      {items.length ? (
        <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
          {items.map((item) => (
            <li key={item.id} className="min-w-0 rounded-2xl border border-slate-950/10 bg-white/65 p-3 dark:border-white/10 dark:bg-slate-950/45">
              <div className="flex flex-wrap gap-2">
                <Badge>{item.category}</Badge>
                <Badge>{item.disposition}</Badge>
              </div>
              <p className="mt-2 break-words font-medium text-foreground [overflow-wrap:anywhere]">{item.normalizedRequirement}</p>
              <p className="mt-1 break-words [overflow-wrap:anywhere]">{item.explanation}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function LifecyclePanel({ view }: { view: ApprovalRequestView }) {
  const lifecycle = view.lifecycle;
  const decisionText = lifecycle.decision
    ? `${decisionLabel[lifecycle.decision.decision]}，${formatDate(lifecycle.decision.createdAt)}`
    : '等待人工决定';
  return (
    <section className="min-w-0 rounded-[1.35rem] border border-slate-950/10 bg-slate-50/76 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">Lifecycle</p>
          <h4 className="mt-1 text-lg font-black tracking-[-0.03em]">通过后的状态追踪</h4>
        </div>
        <LifecycleBadge status={lifecycle.status} />
      </div>
      <div className="mt-4 space-y-3">
        <TimelineItem title="人审决定" body={decisionText} meta={lifecycle.decision?.reviewer.username ?? lifecycle.decision?.reviewer.role ?? '未决'} />
        <TimelineItem
          title="应用记录"
          body={lifecycle.application ? `${applicationLabel(lifecycle.application.status)}，gate=${lifecycle.application.gateCode}` : '还没有 application 记录'}
          meta={lifecycle.application?.id ?? '未开始'}
          alert={Boolean(lifecycle.application?.blockingReasons.length)}
        />
        {lifecycle.application?.blockingReasons.length ? (
          <InfoBlock label="阻断原因" text={lifecycle.application.blockingReasons.join(' ')} />
        ) : null}
        <TimelineItem
          title="资产事件"
          body={lifecycle.assetEvents.length ? `${lifecycle.assetEvents.length} 条事件，最新 ${last(lifecycle.assetEvents)?.eventType ?? 'unknown'}` : '尚未写入资产事件'}
          meta={last(lifecycle.assetEvents)?.assetId ?? '无'}
        />
        <TimelineItem
          title="快照备份"
          body={lifecycle.snapshot ? `${lifecycle.snapshot.entryCount} 个资产快照` : '尚未生成快照'}
          meta={lifecycle.snapshot?.id ?? '无'}
        />
        <TimelineItem
          title="回滚准备"
          body={lifecycle.rollback ? `${lifecycle.rollback.reversible ? '可回滚' : '不可回滚'}，${lifecycle.rollback.entryCount} 个动作` : '尚未生成回滚记录'}
          meta={lifecycle.rollback?.id ?? '无'}
        />
      </div>
    </section>
  );
}

function ReferencePanel({ view }: { view: ApprovalRequestView }) {
  const content = view.lifecycle.proposalContent;
  return (
    <section className="min-w-0 rounded-[1.35rem] border border-slate-950/10 bg-slate-50/76 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-muted-foreground">Evidence & Content</p>
      <div className="mt-4 grid gap-4">
        <InfoBlock label="内容指纹" text={content?.contentHashes.length ? content.contentHashes.join(' ') : '无内容指纹'} />
        <InfoBlock label="目标资产" text={content?.targetRefs.length ? content.targetRefs.join(' ') : '无目标资产'} />
        <InfoBlock label="内容文件" text={content?.contentRefs.length ? content.contentRefs.join(' ') : '无内容文件'} />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">证据引用</p>
          {view.request.evidenceRefs.length ? (
            <div className="mt-2 flex min-w-0 flex-wrap gap-2">
              {view.request.evidenceRefs.map((ref) => <CodePill key={`${ref.kind}-${ref.id}`} label={ref.kind} value={ref.id} />)}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">无证据引用</p>
          )}
        </div>
      </div>
    </section>
  );
}

function TimelineItem({ title, body, meta, alert = false }: { title: string; body: string; meta: string; alert?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[0.85rem_minmax(0,1fr)] gap-3">
      <span className={`mt-1.5 h-3 w-3 rounded-full ${alert ? 'bg-rose-400' : 'bg-cyan-400'} shadow-[0_0_22px_currentColor]`} />
      <div className="min-w-0 border-b border-slate-950/10 pb-3 dark:border-white/10">
        <p className="text-sm font-black tracking-[-0.02em]">{title}</p>
        <p className="mt-1 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{body}</p>
        <p className="mt-1 break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{meta}</p>
      </div>
    </div>
  );
}

function SectionList({
  title,
  items,
  empty = '无',
  variant,
}: {
  title: string;
  items: string[];
  empty?: string;
  variant: 'check' | 'gain' | 'how' | 'risk' | 'test' | 'why';
}) {
  const marker = {
    check: 'bg-sky-400',
    gain: 'bg-emerald-400',
    how: 'bg-cyan-400',
    risk: 'bg-rose-400',
    test: 'bg-indigo-400',
    why: 'bg-amber-400',
  }[variant];
  return (
    <section className="min-w-0 rounded-[1.25rem] border border-slate-950/10 bg-slate-50/76 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${marker} shadow-[0_0_20px_currentColor]`} />
        <p className="text-sm font-black tracking-[-0.02em]">{title}</p>
      </div>
      {items.length > 0 ? (
        <ol className="mt-3 min-w-0 space-y-2 text-sm leading-6 text-muted-foreground">
          {items.map((item, itemIndex) => (
            <li key={`${title}-${item}`} className="grid min-w-0 grid-cols-[1.6rem_minmax(0,1fr)] gap-2">
              <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                {itemIndex + 1}
              </span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function LifecycleBadge({ status }: { status: ApprovalLifecycleStatus }) {
  const tone = {
    undecided: 'border-amber-300/60 bg-amber-300/15 text-amber-800 dark:text-amber-200',
    approved: 'border-sky-300/60 bg-sky-300/15 text-sky-800 dark:text-sky-200',
    applied: 'border-emerald-300/60 bg-emerald-300/15 text-emerald-800 dark:text-emerald-200',
    rejected: 'border-rose-300/60 bg-rose-300/15 text-rose-800 dark:text-rose-200',
    'rolled-back': 'border-violet-300/60 bg-violet-300/15 text-violet-800 dark:text-violet-200',
  }[status];
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{lifecycleLabel[status]}</span>;
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-slate-950/10 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/8 dark:text-slate-300">
      {children}
    </span>
  );
}

function CodePill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-slate-950/10 bg-slate-100/80 px-2.5 py-1 dark:border-white/10 dark:bg-white/8">
      <span className="shrink-0 font-semibold text-foreground">{label}</span>
      <span className="min-w-0 break-all font-mono text-xs [overflow-wrap:anywhere]">{value}</span>
    </span>
  );
}

function InfoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 break-words leading-6 text-muted-foreground [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-950/15 bg-slate-50/80 p-10 text-center text-sm text-muted-foreground dark:border-white/15 dark:bg-white/[0.035]">
      <p className="text-lg font-black tracking-[-0.03em] text-foreground">当前没有符合筛选条件的审批请求</p>
      <p className="mt-2">切换状态筛选，可以查看已通过、已应用、已退回或已回滚的提案。</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      {[0, 1].map((item) => (
        <div key={item} className="h-32 animate-pulse rounded-[1.5rem] bg-slate-950/5 dark:bg-white/8" />
      ))}
    </div>
  );
}

function applicationLabel(status: string): string {
  return {
    ready: '已通过应用门，等待写入',
    blocked: '应用门阻断',
    applied: '已写入',
    'rolled-back': '已回滚',
  }[status] ?? status;
}

function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function compareApprovalRequestViews(a: ApprovalRequestView, b: ApprovalRequestView): number {
  const created = compareIsoDateTime(a.request.createdAt, b.request.createdAt);
  if (created !== 0) return created;
  const updated = compareIsoDateTime(a.request.updatedAt, b.request.updatedAt);
  if (updated !== 0) return updated;
  return a.request.id.localeCompare(b.request.id);
}

function compareIsoDateTime(a: string, b: string): number {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) && Number.isNaN(right)) return a.localeCompare(b);
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  return left - right;
}
