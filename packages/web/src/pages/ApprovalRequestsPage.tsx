import { useEffect, useMemo, useState } from 'react';
import { decideApprovalRequest, listApprovalRequests } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ApprovalDecisionOption, ApprovalRequestView } from '@/types';

type StatusFilter = 'pending' | 'decided' | 'all';

const decisionLabel: Record<ApprovalDecisionOption, string> = {
  approve: '通过',
  reject: '驳回',
  'request-changes': '要求修改',
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
  low: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  high: 'bg-red-500/10 text-red-700 dark:text-red-300',
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="当前列表" value={counts.total} description="按筛选条件展示的提案数" />
        <MetricCard
          label="待人工审阅"
          value={counts.pending}
          description="没有 Web 决策记录的提案"
        />
        <MetricCard label="已决策" value={counts.decided} description="已通过、驳回或要求修改" />
      </section>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between md:space-y-0">
          <div>
            <CardTitle>Haro 改动提案</CardTitle>
            <CardDescription>
              Haro 自动整理“为什么改、怎么改、收益、测试和回滚方案”，这里只负责人审决策。
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['pending', 'decided', 'all'] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant={status === option ? 'default' : 'outline'}
                onClick={() => setStatus(option)}
              >
                {option === 'pending' ? '待审' : option === 'decided' ? '已决策' : '全部'}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void refresh(status)}
              disabled={loading}
            >
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {notice}
            </p>
          ) : null}
          {loading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
          {!loading && items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              当前没有符合筛选条件的审批请求。AgentDock workspace/agent 调用 Haro 后生成的已验证提案会自动展示在这里。
            </div>
          ) : null}
          {items.map((view) => (
            <ApprovalRequestCard
              key={view.request.id}
              view={view}
              busy={busyId === view.request.id}
              onDecision={(decision) => void submitDecision(view, decision)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function ApprovalRequestCard({
  view,
  busy,
  onDecision,
}: {
  view: ApprovalRequestView;
  busy: boolean;
  onDecision: (decision: ApprovalDecisionOption) => void;
}) {
  const request = view.request;
  const disabled = busy || Boolean(view.latestDecision);
  return (
    <article className="rounded-xl border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{request.title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {request.level}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {targetKindLabel[request.targetKind] ?? request.targetKind}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${riskTone[request.riskLevel]}`}>
              {riskLevelLabel[request.riskLevel] ?? request.riskLevel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            提案：{request.proposalId} · 验证：{request.validationId} · 更新时间：
            {formatDate(request.updatedAt)}
          </p>
        </div>
        {view.latestDecision ? (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
            已{decisionLabel[view.latestDecision.decision]}
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-sm text-amber-700 dark:text-amber-300">
            待审
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <SectionList title="为什么改" items={request.whyChange} />
        <SectionList title="怎么改" items={request.howChange} />
        <SectionList title="预期收益" items={request.expectedBenefits} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <SectionList title="必须测试" items={request.requiredTests} empty="无自动测试要求" />
        <SectionList title="人工检查" items={request.manualChecks} empty="无人工检查要求" />
        <SectionList title="回归风险" items={request.regressionRisks} empty="未声明额外风险" />
      </div>

      <div className="mt-5 rounded-lg bg-muted/50 p-4 text-sm">
        <p className="font-medium">审阅说明</p>
        <p className="mt-1 text-muted-foreground">{request.reviewerInstruction}</p>
        <p className="mt-3 font-medium">回滚方案</p>
        <p className="mt-1 text-muted-foreground">
          {request.rollbackPlan.strategy} · 是否需要快照：
          {request.rollbackPlan.snapshotRequired ? '是' : '否'}
        </p>
        {view.latestDecision?.direction ? (
          <>
            <p className="mt-3 font-medium">修改方向</p>
            <p className="mt-1 text-muted-foreground">{view.latestDecision.direction}</p>
          </>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onDecision('approve')} disabled={disabled}>
          通过
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecision('request-changes')}
          disabled={disabled}
        >
          要求修改
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onDecision('reject')}
          disabled={disabled}
        >
          驳回
        </Button>
      </div>
    </article>
  );
}

function SectionList({
  title,
  items,
  empty = '无',
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  return (
    <section>
      <p className="text-sm font-medium">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
