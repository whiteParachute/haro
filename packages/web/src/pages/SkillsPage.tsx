import { useCallback, useEffect, useMemo, useState } from 'react';
import { disableSkill, enableSkill, installSkill, listSkills, uninstallSkill } from '@/api/client';
import { SkillCard } from '@/components/skills/SkillCard';
import { SkillInstallDialog } from '@/components/skills/SkillInstallDialog';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { SkillAuditResult, SkillSummary } from '@/types';

interface SkillsPageViewProps {
  skills: SkillSummary[];
  onRefresh: () => void;
  onToggle: (skill: SkillSummary) => void;
  onInstall: (source: string) => Promise<void> | void;
  onUninstall: (skill: SkillSummary) => void;
  loading?: boolean;
  error?: string | null;
  audit?: SkillAuditResult | null;
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<SkillAuditResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listSkills();
      setSkills(response.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const mutate = async (action: () => Promise<{ data: { audit?: SkillAuditResult } }>) => {
    setLoading(true);
    setError(null);
    try {
      const response = await action();
      setAudit(response.data.audit ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SkillsPageView
      skills={skills}
      onRefresh={() => void load()}
      onToggle={(skill) => void mutate(() => (skill.enabled ? disableSkill(skill.id) : enableSkill(skill.id)))}
      onInstall={(source) => mutate(() => installSkill(source))}
      onUninstall={(skill) => void mutate(() => uninstallSkill(skill.id))}
      loading={loading}
      error={error}
      audit={audit}
    />
  );
}

export function SkillsPageView({
  skills,
  onRefresh,
  onToggle,
  onInstall,
  onUninstall,
  loading = false,
  error = null,
  audit = null,
}: SkillsPageViewProps) {
  const preinstalled = useMemo(() => skills.filter((skill) => skill.isPreinstalled), [skills]);
  const userSkills = useMemo(() => skills.filter((skill) => !skill.isPreinstalled), [skills]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>
            管理预装和 user skill；install/uninstall 通过 Evolution Asset Registry 写审计事件。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>Refresh</Button>
          <SkillInstallDialog onInstall={onInstall} />
          <span className="text-muted-foreground">haro shit 代谢流程请在 CLI 中执行，本页只提示不直接运行。</span>
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>

      {audit ? (
        <Card>
          <CardHeader>
            <CardTitle>Asset audit result</CardTitle>
            <CardDescription>最近一次 install / uninstall / enable / disable 的资产审计结果。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(audit, null, 2)}</pre>
          </CardContent>
        </Card>
      ) : null}

      <SkillGroup title="Preinstalled skills" description="预装 skill 受保护，不提供 uninstall 操作。" skills={preinstalled} onToggle={onToggle} onUninstall={onUninstall} />
      <SkillGroup title="User skills" description="User skill 可启停、安装和按 archive/uninstall 语义卸载。" skills={userSkills} onToggle={onToggle} onUninstall={onUninstall} />
    </div>
  );
}

function SkillGroup({
  title,
  description,
  skills,
  onToggle,
  onUninstall,
}: {
  title: string;
  description: string;
  skills: SkillSummary[];
  onToggle: (skill: SkillSummary) => void;
  onUninstall: (skill: SkillSummary) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {skills.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">暂无 {title}。</CardContent>
          </Card>
        ) : skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} onToggle={() => onToggle(skill)} onUninstall={() => onUninstall(skill)} />
        ))}
      </div>
    </section>
  );
}
