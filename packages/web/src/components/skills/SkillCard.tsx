import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import type { SkillSummary } from '@/types';

interface SkillCardProps {
  skill: SkillSummary;
  onToggle: () => void;
  onUninstall: () => void;
}

export function SkillCard({ skill, onToggle, onUninstall }: SkillCardProps) {
  return (
    <Card data-skill-id={skill.id}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{skill.id}</CardTitle>
            <CardDescription>
              {skill.source} · installed {skill.installedAt} · asset {skill.assetStatus}
            </CardDescription>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {skill.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{skill.description ?? skill.originalSource}</p>
        <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
          <span>isPreinstalled: {String(skill.isPreinstalled)}</span>
          <span>assetRef: {skill.assetRef}</span>
          <span>lastUsedAt: {skill.lastUsedAt ?? 'never'}</span>
          <span>useCount: {skill.useCount}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onToggle}>{skill.enabled ? 'Disable' : 'Enable'}</Button>
          <Button size="sm" variant="outline" disabled={skill.isPreinstalled} onClick={onUninstall}>
            {skill.isPreinstalled ? 'Preinstalled protected' : 'Uninstall with audit'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
