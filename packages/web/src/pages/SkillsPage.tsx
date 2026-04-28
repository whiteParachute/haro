import { useEffect } from 'react';
import { PaginatedTable, type PaginatedTableState } from '@/components/PaginatedTable';
import { SkillInstallDialog } from '@/components/skills/SkillInstallDialog';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useSkillsStore } from '@/stores/skills';
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
  const t = useT();
  const { skills, total, query, loading, error, audit, loadSkills, toggleSkill, install, uninstall } = useSkillsStore();

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const handleChange = (next: Partial<PaginatedTableState>) => {
    void loadSkills(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(K.SKILLS.TITLE)}</CardTitle>
          <CardDescription>{t(K.SKILLS.DESC)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="outline" onClick={() => void loadSkills()} disabled={loading}>{t(K.COMMON.REFRESH)}</Button>
          <SkillInstallDialog onInstall={(source) => install(source)} />
          <span className="text-muted-foreground">{t(K.SKILLS.INSTALL_HINT)}</span>
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>

      {audit ? <AuditCard audit={audit} /> : null}

      <PaginatedTable<SkillSummary>
        columns={[
          { key: 'id', header: t(K.SKILLS.ID), sortable: true },
          { key: 'source', header: t(K.SKILLS.SOURCE), sortable: true },
          { key: 'enabled', header: t(K.SKILLS.ENABLED), sortable: true, render: (skill) => skill.enabled ? t(K.COMMON.YES) : t(K.COMMON.NO) },
          { key: 'assetStatus', header: t(K.SKILLS.ASSET_STATUS), sortable: true },
          { key: 'useCount', header: t(K.SKILLS.USE_COUNT), sortable: true },
          {
            key: 'actions',
            header: t(K.COMMON.ACTIONS),
            render: (skill) => (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void toggleSkill(skill)}>{t(K.SKILLS.TOGGLE)}</Button>
                {!skill.isPreinstalled ? <Button variant="ghost" size="sm" onClick={() => void uninstall(skill)}>{t(K.COMMON.DELETE)}</Button> : null}
              </div>
            ),
          },
        ]}
        rows={skills}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        sort={query.sort}
        order={query.order}
        q={query.q}
        onChange={handleChange}
        loading={loading}
        error={error}
        emptyMessage={t(K.SKILLS.EMPTY)}
        onRetry={() => void loadSkills()}
      />
    </div>
  );
}

export function SkillsPageView({ skills, onRefresh, onToggle, onInstall, onUninstall, loading = false, error = null, audit = null }: SkillsPageViewProps) {
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(K.SKILLS.TITLE)}</CardTitle>
          <CardDescription>{t(K.SKILLS.DESC)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>{t(K.COMMON.REFRESH)}</Button>
          <SkillInstallDialog onInstall={onInstall} />
          <span className="text-muted-foreground">haro shit 代谢流程请在 CLI 中执行，本页只提示不直接运行。</span>
          {error ? <span className="text-destructive">{error}</span> : null}
        </CardContent>
      </Card>
      {audit ? <AuditCard audit={audit} /> : null}
      <SkillGroup title="Preinstalled skills" description="Preinstalled protected" skills={skills.filter((skill) => skill.isPreinstalled)} onToggle={onToggle} onUninstall={onUninstall} />
      <SkillGroup title="User skills" description="User skill 可启停、安装和按 archive/uninstall 语义卸载。" skills={skills.filter((skill) => !skill.isPreinstalled)} onToggle={onToggle} onUninstall={onUninstall} />
    </div>
  );
}

function AuditCard({ audit }: { audit: SkillAuditResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset audit result</CardTitle>
        <CardDescription>最近一次 install / uninstall / enable / disable 的资产审计结果。</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(audit, null, 2)}</pre>
      </CardContent>
    </Card>
  );
}

function SkillGroup({ title, description, skills, onToggle, onUninstall }: { title: string; description: string; skills: SkillSummary[]; onToggle: (skill: SkillSummary) => void; onUninstall: (skill: SkillSummary) => void }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {skills.length === 0 ? (
          <Card><CardContent className="pt-6 text-sm text-muted-foreground">暂无 {title}。</CardContent></Card>
        ) : skills.map((skill) => (
          <Card key={skill.id}>
            <CardHeader><CardTitle>{skill.id}</CardTitle><CardDescription>{skill.description}</CardDescription></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{skill.source} · {skill.installedAt} · {skill.enabled ? 'enabled' : 'disabled'}</p>
              <p>useCount: {skill.useCount}</p>
              <p>{skill.lastUsedAt}</p>
              <p>{skill.assetStatus}</p>
              <div className="flex gap-2"><Button onClick={() => onToggle(skill)}>Toggle</Button>{!skill.isPreinstalled ? <Button onClick={() => onUninstall(skill)}>Uninstall</Button> : null}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
