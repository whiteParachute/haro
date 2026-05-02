/**
 * `haro chat` command (FEAT-039 R1).
 *
 * Modes:
 *   haro chat                       — enter the existing REPL (alias for bare `haro`)
 *   haro chat --send "<msg>"        — single-shot, exit
 *   haro chat --agent <id>          — REPL pinned to that agent
 *   haro chat --session <id>        — REPL with continueLatestSession=true against the session
 *   haro chat --history             — list recent sessions, pick one, then resume
 *
 * Re-uses the existing `runRepl` / `executeTask` plumbing rather than
 * re-implementing it (per batch-1 decision: "仅 chat" extraction).
 */

import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { services } from '@haro/core';
import { renderError } from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext, type ExecuteCliTaskFn, type RunCliReplFn } from '../index.js';

export interface ChatCommandHooks {
  /** Bound to executeTask in index.ts so chat doesn't need its private symbols. */
  executeTask: ExecuteCliTaskFn;
  /** Bound to runRepl in index.ts so --agent / --session can enter the same loop. */
  runRepl: RunCliReplFn;
}

interface ChatOptions {
  send?: string;
  session?: string;
  agent?: string;
  history?: boolean;
}

export function registerChatCommand(program: Command, app: AppContext, hooks: ChatCommandHooks): void {
  program
    .command('chat')
    .description('Chat with an agent (REPL by default; --send for one-shot)')
    .option('-s, --session <id>', 'continue an existing session')
    .option('-a, --agent <id>', 'agent id to chat with')
    .option('--send <message>', 'one-shot: send the message and exit')
    .option('--history', 'pick a recent session interactively, then chat')
    .action(async (opts: ChatOptions) => {
      try {
        const agentId = opts.agent ?? app.cliState.defaultAgentId ?? app.loaded.config.defaultAgent ?? 'haro-assistant';

        if (opts.send !== undefined) {
          if (opts.session) {
            const detail = services.sessions.tryGetSession(buildServiceContext(app), opts.session);
            if (!detail) {
              throw new CommanderExit(1, `session '${opts.session}' not found`);
            }
            if (detail.agentId !== agentId) {
              throw new CommanderExit(
                1,
                `session '${opts.session}' belongs to agent '${detail.agentId}', not '${agentId}'; pass --agent ${detail.agentId}`,
              );
            }
          }
          const result = await hooks.executeTask(app, {
            task: opts.send,
            agentId,
            ...(app.cliState.defaultProvider ? { provider: app.cliState.defaultProvider } : {}),
            ...(app.cliState.defaultModel ? { model: app.cliState.defaultModel } : {}),
            ...(opts.session
              ? { continueFromSessionId: opts.session, continueLatestSession: true }
              : { continueLatestSession: false }),
          });
          if (result.finalEvent.type === 'error') {
            app.stderr.write(`${result.finalEvent.message}\n`);
            throw new CommanderExit(1, result.finalEvent.message);
          }
          return;
        }

        if (opts.history) {
          const picked = await pickSessionInteractive(app);
          if (!picked) {
            app.stdout.write('no session selected; cancelled\n');
            return;
          }
          opts.session = picked;
        }

        if (opts.session) {
          const detail = services.sessions.tryGetSession(buildServiceContext(app), opts.session);
          if (!detail) {
            throw new CommanderExit(1, `session '${opts.session}' not found`);
          }
          if (detail.agentId !== agentId) {
            throw new CommanderExit(
              1,
              `session '${opts.session}' belongs to agent '${detail.agentId}', not '${agentId}'; pass --agent ${detail.agentId}`,
            );
          }
        }

        // Pin replState before entering REPL — runRepl now honors a
        // pre-seeded state instead of overwriting it.
        app.replState = {
          agentId,
          providerOverride: app.cliState.defaultProvider,
          modelOverride: app.cliState.defaultModel,
          continueLatestSession: true,
          ...(opts.session ? { lastSessionId: opts.session, resumeFromSessionId: opts.session } : {}),
        };

        await hooks.runRepl(app);
      } catch (error) {
        if (error instanceof CommanderExit) throw error;
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

async function pickSessionInteractive(app: AppContext): Promise<string | null> {
  const result = services.sessions.listSessions(buildServiceContext(app), { pageSize: '10' });
  if (result.items.length === 0) {
    app.stdout.write('No sessions found yet — start a new one with `haro chat`.\n');
    return null;
  }
  app.stdout.write('Recent sessions:\n');
  result.items.forEach((item, idx) => {
    app.stdout.write(`  [${idx + 1}] ${item.sessionId}  ${item.agentId}  ${item.status}  ${item.createdAt}\n`);
  });
  const isTty = (app.stdin as { isTTY?: boolean }).isTTY === true;
  if (!isTty) {
    app.stderr.write('--history requires an interactive TTY; use --session <id> directly\n');
    return null;
  }
  const rl = createInterface({ input: app.stdin, output: app.stdout });
  try {
    const answer = (await rl.question('Pick a session number (or empty to cancel): ')).trim();
    if (answer === '') return null;
    const idx = Number.parseInt(answer, 10) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= result.items.length) {
      app.stderr.write(`invalid selection '${answer}'\n`);
      return null;
    }
    return result.items[idx]!.sessionId;
  } finally {
    rl.close();
  }
}
