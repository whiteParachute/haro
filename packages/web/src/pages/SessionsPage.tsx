import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PaginatedTable, type PaginatedTableState } from '@/components/PaginatedTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { canAccessRole } from '@/router/roles';
import { useAuthStore } from '@/stores/auth';
import { useSessionsStore, type SessionSummary } from '@/stores/sessions';

export function SessionsPage() {
  const t = useT();
  const { user } = useAuthStore();
  const { items, total, loading, error, query, loadSessions, deleteSession } = useSessionsStore();
  const canDelete = canAccessRole(user?.role, 'operator');

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleChange = (next: Partial<PaginatedTableState>) => {
    void loadSessions(next);
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t(K.SESSIONS.TITLE)}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t(K.NAV.SESSIONS_DESC)}
        </CardContent>
      </Card>
      <PaginatedTable<SessionSummary>
        columns={[
          { key: 'sessionId', header: t(K.SESSIONS.ID), sortable: true, render: (item) => <Link className="font-mono text-xs underline" to={`/sessions/${item.sessionId}`}>{item.sessionId}</Link> },
          { key: 'agentId', header: t(K.SESSIONS.AGENT), sortable: true },
          { key: 'status', header: t(K.COMMON.STATUS), sortable: true },
          { key: 'provider', header: t(K.SESSIONS.PROVIDER), sortable: true },
          { key: 'model', header: t(K.SESSIONS.MODEL), sortable: true },
          { key: 'createdAt', header: t(K.SESSIONS.CREATED_AT), sortable: true },
          {
            key: 'actions',
            header: t(K.COMMON.ACTIONS),
            render: (item) => (
              <div className="flex justify-end gap-2">
                <Link className="rounded-md px-3 py-2 text-sm underline hover:bg-accent" to={`/sessions/${item.sessionId}`}>{t(K.COMMON.DETAILS)}</Link>
                {canDelete ? <Button variant="ghost" size="sm" onClick={() => void deleteSession(item.sessionId)}>{t(K.COMMON.DELETE)}</Button> : null}
              </div>
            ),
          },
        ]}
        rows={items}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        sort={query.sort}
        order={query.order}
        q={query.q}
        onChange={handleChange}
        loading={loading}
        error={error}
        emptyMessage={t(K.SESSIONS.EMPTY)}
        onRetry={() => void loadSessions()}
      />
    </div>
  );
}
