import { useEffect, useMemo, useState } from 'react';
import { decideApprovalRequest, listApprovalRequests } from '@/api/client';
import { Button } from '@/components/ui/Button';
import type { ApprovalDecisionOption, ApprovalRequestView } from '@/types';

type StatusFilter = 'pending' | 'decided' | 'all';

const decisionLabel: Record<ApprovalDecisionOption, string> = {
  approve: '通过',
  reject: '驳回',
  'request-changes': '要求修改',
};

const filterLabel: Record<StatusFilter, string> = {
  pending: '待审',
  decided: '已决策',
  all: '全部',
};

const targetKindLabel: Record<string, string> = {
  'mcp-tool-config': 'MCP 工具配置',
  'runner-profile': 'Runner Profile',
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
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [items, setItems] = useState<ApprovalRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(nextStatus = status) {
    setLoading(true);
    setError(null);
    try {
      const response = await listApprovalRequests(nextStatus);
      setItems(response.data.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const counts = useMemo(() => {
    const decided = items.filter((item) => item.latestDecision).length;
    return { total: items.length, decided, pending: items.length - decided };
  }, [items]);

  async function submitDecision(view: ApprovalRequestView, decision: ApprovalDecisionOption) {
    let direction: string | undefined;
    if (decision === 'request-changes') {
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
      await refresh(status);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-7 pb-10">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-950/10 bg-[#111827] px-6 py-7 text-white shadow-[0_28px_90px_rgba(15,23,42,0.26)] dark:border-white/10 dark:bg-[#0a1020] md:px-8">
        <div className="absolute inset-0 opacity-80 [background:radial-gradient(circle_at_14%_16%,rgba(56,189,248,0.28),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(251,191,36,0.20),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0)_0%,rgba(15,23,42,0.86)_65%)]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" />
        <div className="relative grid gap-7 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/80">
              <span className="rounded-full border border-cyan-100/20 bg-white/10 px-3 py-1 backdrop-blur">Human Gate</span>
              <span>AgentDock Sidecar</span>
            </div>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-4xl font-black tracking-[-0.06em] text-white md:text-6xl">
                Haro 提案审阅工作台
              </h1>
              <p className="max-w-3xl text-base leading-8 text-slate-200 md:text-lg">
                把自动观察、前沿情报和验证结论压缩成可审阅的行动卡片。这里不是运行时控制面，
                只做人审：通过、驳回，或要求 Haro 按你的方向重写提案。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 lg:justify-self-end">
            <MetricTile label="当前列表" value={counts.total} caption="筛选后" tone="cyan" />
            <MetricTile label="待人工审阅" value={counts.pending} caption="无决策记录" tone="amber" />
            <MetricTile label="已决策" value={counts.decided} caption="已处理" tone="emerald" />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.75rem] border border-slate-950/10 bg-white/82 shadow-[0_22px_80px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/62">
        <div className="flex flex-col gap-5 border-b border-slate-950/10 bg-gradient-to-r from-slate-50 via-white to-cyan-50/70 px-5 py-5 dark:border-white/10 dark:from-slate-950 dark:via-slate-950 dark:to-cyan-950/20 md:flex-row md:items-center md:justify-between md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-cyan-700 dark:text-cyan-300">Proposal Docket</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">Haro 改动提案</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Haro 自动整理“为什么改、怎么改、收益、测试和回滚方案”，这里只负责人审决策。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-950/10 bg-white/70 p-1.5 shadow-inner dark:border-white/10 dark:bg-white/5">
            {(['pending', 'decided', 'all'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={[
                  'rounded-xl px-4 py-2 text-sm font-semibold transition-all',
                  status === option
                    ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15 dark:bg-white dark:text-slate-950'
                    : 'text-muted-foreground hover:bg-slate-950/5 hover:text-foreground dark:hover:bg-white/10',
                ].join(' ')}
                onClick={() => setStatus(option)}
              >
                {filterLabel[option]}
              </button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              className="rounded-xl"
              onClick={() => void refresh(status)}
              disabled={loading}
            >
              刷新
            </Button>
          </div>
        </div>

        <div className="space-y-5 p-5 md:p-7">
          {error ? (
            <p
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">
              {notice}
            </p>
          ) : null}
          {loading ? <LoadingState /> : null}
          {!loading && items.length === 0 ? <EmptyState /> : null}
          {items.map((view, index) => (
            <ApprovalRequestCard
              key={view.request.id}
              index={index}
              view={view}
              busy={busyId === view.request.id}
              onDecision={(decision) => void submitDecision(view, decision)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  tone: 'amber' | 'cyan' | 'emerald';
}) {
  const toneClass = {
    amber: 'from-amber-200/24 to-orange-300/10 text-amber-100',
    cyan: 'from-cyan-200/24 to-sky-300/10 text-cyan-100',
    emerald: 'from-emerald-200/24 to-teal-300/10 text-emerald-100',
  }[tone];
  return (
    <div className={`rounded-3xl border border-white/12 bg-gradient-to-br ${toneClass} p-4 shadow-2xl backdrop-blur`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-80">{label}</p>
      <p className="mt-3 text-4xl font-black tracking-[-0.08em] text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-200/78">{caption}</p>
    </div>
  );
}

function ApprovalRequestCard({
  view,
  busy,
  index,
  onDecision,
}: {
  view: ApprovalRequestView;
  busy: boolean;
  index: number;
  onDecision: (decision: ApprovalDecisionOption) => void;
}) {
  const request = view.request;
  const disabled = busy || Boolean(view.latestDecision);
  const tone = riskTone[request.riskLevel];
  return (
    <article className={`group relative overflow-hidden rounded-[1.6rem] border border-slate-950/10 bg-white shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl dark:border-white/10 dark:bg-slate-950/88 ${tone.glow}`}>
      <div className={`absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${tone.rail}`} />
      <div className="absolute right-0 top-0 h-36 w-36 rounded-full bg-cyan-300/10 blur-3xl transition group-hover:bg-cyan-300/18" />
      <div className="relative p-5 md:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-950/10 bg-slate-950 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-white dark:border-white/10 dark:bg-white dark:text-slate-950">
                #{String(index + 1).padStart(2, '0')}
              </span>
              <Badge>{request.level}</Badge>
              <Badge>{targetKindLabel[request.targetKind] ?? request.targetKind}</Badge>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`}>
                {riskLevelLabel[request.riskLevel] ?? request.riskLevel}
              </span>
              {view.latestDecision ? (
                <span className="rounded-full border border-cyan-300/50 bg-cyan-400/12 px-3 py-1 text-xs font-semibold text-cyan-700 dark:text-cyan-200">
                  已{decisionLabel[view.latestDecision.decision]}
                </span>
              ) : (
                <span className="rounded-full border border-amber-300/60 bg-amber-300/15 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
                  待审
                </span>
              )}
            </div>

            <div>
              <h3 className="max-w-4xl text-2xl font-black leading-tight tracking-[-0.045em] text-slate-950 dark:text-white">
                {request.title}
              </h3>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <CodePill label="提案" value={request.proposalId} />
                <CodePill label="验证" value={request.validationId} />
                <CodePill label="更新时间" value={formatDate(request.updatedAt)} />
              </div>
            </div>
          </div>

          <DecisionPanel disabled={disabled} busy={busy} latestDecision={view.latestDecision?.decision} onDecision={onDecision} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <SectionList variant="why" title="为什么改" items={request.whyChange} />
          <SectionList variant="how" title="怎么改" items={request.howChange} />
          <SectionList variant="gain" title="预期收益" items={request.expectedBenefits} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <SectionList variant="test" title="必须测试" items={request.requiredTests} empty="无自动测试要求" />
          <SectionList variant="check" title="人工检查" items={request.manualChecks} empty="无人工检查要求" />
          <SectionList variant="risk" title="回归风险" items={request.regressionRisks} empty="未声明额外风险" />
        </div>

        <div className="mt-5 grid gap-4 rounded-[1.35rem] border border-slate-950/10 bg-slate-950/[0.025] p-4 text-sm dark:border-white/10 dark:bg-white/[0.035] lg:grid-cols-[1fr_1fr]">
          <InfoBlock label="审阅说明" text={request.reviewerInstruction} />
          <InfoBlock
            label="回滚方案"
            text={`${request.rollbackPlan.strategy} · 是否需要快照：${request.rollbackPlan.snapshotRequired ? '是' : '否'}`}
          />
          {view.latestDecision?.direction ? (
            <div className="lg:col-span-2">
              <InfoBlock label="修改方向" text={view.latestDecision.direction} />
            </div>
          ) : null}
        </div>
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
    <aside className="rounded-[1.25rem] border border-slate-950/10 bg-slate-50/85 p-3 dark:border-white/10 dark:bg-white/[0.045]">
      <p className="px-2 pt-1 text-xs font-bold uppercase tracking-[0.24em] text-muted-foreground">Decision</p>
      <div className="mt-3 grid gap-2">
        <Button className="h-10 rounded-xl" onClick={() => onDecision('approve')} disabled={disabled}>
          通过
        </Button>
        <Button
          className="h-10 rounded-xl border-cyan-500/30 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 dark:bg-cyan-400/10 dark:text-cyan-100 dark:hover:bg-cyan-400/15"
          variant="outline"
          onClick={() => onDecision('request-changes')}
          disabled={disabled}
        >
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
    <section className="rounded-[1.25rem] border border-slate-950/10 bg-slate-50/76 p-4 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${marker} shadow-[0_0_20px_currentColor]`} />
        <p className="text-sm font-black tracking-[-0.02em]">{title}</p>
      </div>
      {items.length > 0 ? (
        <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          {items.map((item, itemIndex) => (
            <li key={`${title}-${item}`} className="grid grid-cols-[1.6rem_1fr] gap-2">
              <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200">
                {itemIndex + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
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
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-950/10 bg-slate-100/80 px-2.5 py-1 dark:border-white/10 dark:bg-white/8">
      <span className="font-semibold text-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </span>
  );
}

function InfoBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-slate-950/15 bg-slate-50/80 p-10 text-center text-sm text-muted-foreground dark:border-white/15 dark:bg-white/[0.035]">
      <p className="text-lg font-black tracking-[-0.03em] text-foreground">当前没有符合筛选条件的审批请求</p>
      <p className="mt-2">AgentDock workspace/agent 调用 Haro 后生成的已验证提案会自动展示在这里。</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      {[0, 1].map((item) => (
        <div key={item} className="h-44 animate-pulse rounded-[1.5rem] bg-slate-950/5 dark:bg-white/8" />
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
