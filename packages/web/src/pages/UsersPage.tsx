import { useEffect, useState, type FormEvent } from 'react';
import { PaginatedTable, type PaginatedTableState } from '@/components/PaginatedTable';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { K } from '@/i18n/keys';
import { useT } from '@/i18n/provider';
import { useUsersStore } from '@/stores/users';
import type { WebUser, WebUserRole } from '@/types';

const roles: WebUserRole[] = ['viewer', 'operator', 'admin', 'owner'];

export function UsersPage() {
  const t = useT();
  const { users, total, query, loading, error, loadUsers, createUser, setUserStatus } = useUsersStore();
  const [draft, setDraft] = useState({ username: '', displayName: '', password: '', role: 'viewer' as WebUserRole });
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.username.trim() || draft.password.length < 8) {
      setCreateError(t(K.AUTH.PASSWORD_MIN));
      return;
    }
    setCreateError(null);
    const ok = await createUser(draft);
    if (ok) setDraft({ username: '', displayName: '', password: '', role: 'viewer' });
  }

  const handleChange = (next: Partial<PaginatedTableState>) => {
    void loadUsers(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(K.USERS.TITLE)}</CardTitle>
          <CardDescription>{t(K.USERS.DESC)}</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(K.USERS.CREATE_TITLE)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 text-sm md:grid-cols-5" onSubmit={onCreate}>
            <input className="rounded-md border border-input bg-background px-3 py-2" placeholder={t(K.USERS.USERNAME)} value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
            <input className="rounded-md border border-input bg-background px-3 py-2" placeholder={t(K.USERS.DISPLAY_NAME)} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
            <input className="rounded-md border border-input bg-background px-3 py-2" type="password" placeholder={t(K.USERS.PASSWORD)} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
            <select className="rounded-md border border-input bg-background px-3 py-2" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as WebUserRole })}>
              {roles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <Button type="submit" disabled={loading}>{t(K.USERS.CREATE)}</Button>
          </form>
          {createError ? <p className="mt-2 text-sm text-destructive">{createError}</p> : null}
        </CardContent>
      </Card>

      <PaginatedTable<WebUser>
        columns={[
          { key: 'username', header: t(K.USERS.USERNAME), sortable: true },
          { key: 'displayName', header: t(K.USERS.DISPLAY_NAME), sortable: true },
          { key: 'role', header: t(K.USERS.ROLE), sortable: true },
          { key: 'status', header: t(K.USERS.STATUS), sortable: true },
          { key: 'lastLoginAt', header: t(K.USERS.LAST_LOGIN), sortable: true },
          { key: 'auditSummary', header: t(K.USERS.AUDIT_COUNT), render: (user) => user.auditSummary?.count ?? 0 },
          {
            key: 'actions',
            header: t(K.COMMON.ACTIONS),
            render: (user) => user.status === 'disabled'
              ? <Button variant="outline" size="sm" onClick={() => void setUserStatus(user, 'active')}>{t(K.USERS.ENABLE)}</Button>
              : <Button variant="ghost" size="sm" onClick={() => void setUserStatus(user, 'disabled')}>{t(K.USERS.DISABLE)}</Button>,
          },
        ]}
        rows={users}
        total={total}
        page={query.page}
        pageSize={query.pageSize}
        sort={query.sort}
        order={query.order}
        q={query.q}
        onChange={handleChange}
        loading={loading}
        error={error}
        emptyMessage={t(K.USERS.EMPTY)}
        onRetry={() => void loadUsers()}
      />
    </div>
  );
}
