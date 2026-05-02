/**
 * `haro user` command tree (FEAT-039 R8 / FEAT-028 multi-user).
 *
 *   list / show <username>
 *   create <username> --role owner|admin|operator|viewer --password <p>
 *   role <username> <role>
 *   disable <username>
 *   reset-token <username> --password <new>
 *
 * The CLI runs as the local owner — every mutating call passes a `cli`
 * actor with role=owner so audit rows record `actor_kind=cli`.
 */

import { randomBytes } from 'node:crypto';
import type { Command } from 'commander';
import { HaroError, services, type HaroErrorCode } from '@haro/core';
import {
  confirmDestructive,
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  renderListJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags { json?: boolean; human?: boolean }

const CLI_ACTOR: services.users.UserActor = { kind: 'cli', role: 'owner' };

export function registerUserCommands(program: Command, app: AppContext): void {
  const user = program.command('user').description('Local user / RBAC management (FEAT-039 R8)');

  user
    .command('list')
    .description('List users')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const items = services.users.listUsers(buildServiceContext(app));
        if (mode === 'json') {
          renderListJson({ items, total: items.length }, { stdout: app.stdout });
          return;
        }
        renderHumanTable(
          items,
          [
            { key: 'username', label: 'USERNAME' },
            { key: 'role', label: 'ROLE' },
            { key: 'status', label: 'STATUS' },
            { key: 'createdAt', label: 'CREATED' },
            { key: 'lastLoginAt', label: 'LAST_LOGIN', render: (row) => row.lastLoginAt ?? '-' },
          ],
          { stdout: app.stdout },
        );
      } catch (error) {
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  user
    .command('show')
    .argument('<username>', 'username')
    .description('Show one user by username')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((username: string, opts: OutputFlags) => {
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        const detail = services.users.getUserByUsername(buildServiceContext(app), username);
        if (mode === 'json') {
          renderJson(detail, { stdout: app.stdout });
          return;
        }
        renderHumanRecord(detail as unknown as Record<string, unknown>, { stdout: app.stdout });
      } catch (error) {
        renderError(toHaroError(error), { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  user
    .command('create')
    .argument('<username>', 'new username')
    .description('Create a user')
    .requiredOption('--role <role>', 'owner | admin | operator | viewer')
    .option('--password <password>', 'password (min 8 chars); auto-generated when omitted')
    .option('--display-name <name>', 'display name; defaults to username')
    .option('--status <status>', 'active | disabled', 'active')
    .action((username: string, opts: { role: string; password?: string; displayName?: string; status: string }) => {
      try {
        const password = opts.password ?? generatePassword();
        const created = services.users.createUser(
          buildServiceContext(app),
          {
            username,
            password,
            role: opts.role,
            ...(opts.displayName ? { displayName: opts.displayName } : {}),
            status: opts.status,
          },
          CLI_ACTOR,
        );
        app.stdout.write(`user '${created.username}' created (id=${created.id}, role=${created.role})\n`);
        if (!opts.password) {
          app.stdout.write(`auto-generated password (save this — it will not be shown again):\n  ${password}\n`);
        }
      } catch (error) {
        renderError(toHaroError(error), { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  user
    .command('role')
    .argument('<username>', 'username')
    .argument('<role>', 'owner | admin | operator | viewer')
    .description('Change a user\'s role')
    .action((username: string, role: string) => {
      try {
        const target = services.users.getUserByUsername(buildServiceContext(app), username);
        const updated = services.users.updateUser(buildServiceContext(app), target.id, { role }, CLI_ACTOR);
        app.stdout.write(`user '${username}' role → ${updated.role}\n`);
      } catch (error) {
        renderError(toHaroError(error), { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  user
    .command('disable')
    .argument('<username>', 'username')
    .description('Disable a user (audit-logged)')
    .option('-y, --yes', 'skip confirmation')
    .option('--quiet', 'skip preview')
    .action(async (username: string, opts: { yes?: boolean; quiet?: boolean }) => {
      try {
        const target = services.users.getUserByUsername(buildServiceContext(app), username);
        const confirm = await confirmDestructive(
          {
            action: 'disable',
            target: `user '${username}'`,
            preview: `Will mark user '${username}' (role=${target.role}) as disabled. Active sessions are not revoked.`,
            ...(opts.yes ? { yes: true } : {}),
            ...(opts.quiet ? { quiet: true } : {}),
          },
          { stdin: app.stdin, stdout: app.stdout, stderr: app.stderr },
        );
        if (!confirm.confirmed) {
          app.stdout.write(`disable cancelled: ${confirm.reason}\n`);
          return;
        }
        services.users.updateUser(buildServiceContext(app), target.id, { status: 'disabled' }, CLI_ACTOR);
        app.stdout.write(`user '${username}' disabled\n`);
      } catch (error) {
        renderError(toHaroError(error), { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  user
    .command('reset-token')
    .argument('<username>', 'username')
    .description('Reset a user\'s password (revokes active sessions)')
    .option('--password <password>', 'new password; auto-generated when omitted')
    .action((username: string, opts: { password?: string }) => {
      try {
        const target = services.users.getUserByUsername(buildServiceContext(app), username);
        const password = opts.password ?? generatePassword();
        services.users.resetUserPassword(buildServiceContext(app), target.id, password, CLI_ACTOR);
        app.stdout.write(`user '${username}' password reset; all active sessions revoked\n`);
        if (!opts.password) {
          app.stdout.write(`new password (save this — it will not be shown again):\n  ${password}\n`);
        }
      } catch (error) {
        renderError(toHaroError(error), { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

function generatePassword(): string {
  return randomBytes(16).toString('base64url');
}

function toHaroError(error: unknown): unknown {
  if (error instanceof services.WebAuthError) {
    return new HaroError(
      mapAuthCode(error.code),
      error.message,
    );
  }
  return error;
}

function mapAuthCode(code: string): HaroErrorCode {
  switch (code) {
    case 'user_not_found': return 'USER_NOT_FOUND';
    case 'username_exists': return 'USER_USERNAME_EXISTS';
    case 'owner_transfer_required': return 'USER_OWNER_TRANSFER_REQUIRED';
    case 'last_owner_required': return 'USER_LAST_OWNER_REQUIRED';
    case 'invalid_username': return 'USER_INVALID_USERNAME';
    case 'invalid_password': return 'USER_INVALID_PASSWORD';
    case 'invalid_display_name': return 'USER_INVALID_DISPLAY_NAME';
    case 'invalid_role': return 'USER_INVALID_ROLE';
    case 'invalid_status': return 'USER_INVALID_STATUS';
    case 'bootstrap_closed': return 'USER_BOOTSTRAP_CLOSED';
    case 'invalid_credentials': return 'USER_INVALID_CREDENTIALS';
    default: return 'INTERNAL';
  }
}
