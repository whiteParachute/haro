/**
 * `haro skill <name>` singular command tree (FEAT-039 R9).
 *
 * Singular complement to the existing `haro skills` plural management:
 *   run [--input "..."]
 *   disable
 *   uninstall
 *   show events
 *   validate
 */

import type { Command } from 'commander';
import { HaroError, services } from '@haro/core';
import {
  confirmDestructive,
  renderError,
  renderHumanRecord,
  renderHumanTable,
  renderJson,
  resolveOutputMode,
} from '../output/index.js';
import { buildServiceContext } from './service-context.js';
import { CommanderExit, type AppContext } from '../index.js';

interface OutputFlags { json?: boolean; human?: boolean }

export function registerSkillCommand(program: Command, app: AppContext): void {
  const skill = program
    .command('skill')
    .argument('<id>', 'skill id')
    .description('Per-skill detailed control (FEAT-039 R9)');

  skill
    .command('run')
    .description('Run the skill once (executes via runner with the skill prompt)')
    .option('--input <text>', 'optional input to forward to the skill task')
    .action(async (opts: { input?: string }, command) => {
      const id = command.parent?.args[0];
      if (!id) throw new CommanderExit(1, 'skill id is required');
      try {
        const detail = services.skills.getSkillDetail(skillCtx(app), id);
        const task = opts.input
          ? `Use the '${id}' skill on this input:\n${opts.input}`
          : `Use the '${id}' skill (${detail.descriptor.description}).`;
        const agentId = app.cliState.defaultAgentId ?? app.loaded.config.defaultAgent ?? 'haro-assistant';
        const result = await app.runner.run({ task, agentId, continueLatestSession: false });
        if (result.finalEvent.type === 'result') {
          app.stdout.write(`skill '${id}' ran OK — ${result.events.length} event(s)\n`);
        } else {
          app.stderr.write(`skill '${id}' failed: ${result.finalEvent.message}\n`);
          throw new CommanderExit(1, result.finalEvent.message);
        }
      } catch (error) {
        if (error instanceof CommanderExit) throw error;
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  skill
    .command('disable')
    .description('Disable the skill (does not uninstall)')
    .action((_opts, command) => {
      const id = command.parent?.args[0];
      if (!id) throw new CommanderExit(1, 'skill id is required');
      try {
        services.skills.disableSkill(skillCtx(app), id);
        app.stdout.write(`skill '${id}' disabled\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  skill
    .command('uninstall')
    .description('Remove the skill (preinstalled skills are protected)')
    .option('-y, --yes', 'skip confirmation')
    .option('--quiet', 'skip preview')
    .action(async (opts: { yes?: boolean; quiet?: boolean }, command) => {
      const id = command.parent?.args[0];
      if (!id) throw new CommanderExit(1, 'skill id is required');
      try {
        const confirm = await confirmDestructive(
          {
            action: 'uninstall',
            target: `skill '${id}'`,
            preview: `Will uninstall skill '${id}'. Asset audit row will be recorded.`,
            ...(opts.yes ? { yes: true } : {}),
            ...(opts.quiet ? { quiet: true } : {}),
          },
          { stdin: app.stdin, stdout: app.stdout, stderr: app.stderr },
        );
        if (!confirm.confirmed) {
          app.stdout.write(`uninstall cancelled: ${confirm.reason}\n`);
          return;
        }
        services.skills.uninstallSkill(skillCtx(app), id);
        app.stdout.write(`skill '${id}' uninstalled\n`);
      } catch (error) {
        if (error instanceof HaroError && error.code === 'SKILL_PREINSTALLED') {
          renderError(error, { stderr: app.stderr });
          throw new CommanderExit(1, error.message);
        }
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  skill
    .command('show')
    .argument('<topic>', 'events | detail')
    .description('Show skill detail or audit events')
    .option('--json', 'force JSON output')
    .option('--human', 'force human output')
    .action((topic: string, opts: OutputFlags, command) => {
      const id = command.parent?.parent?.args[0] ?? command.parent?.args[0];
      if (!id) throw new CommanderExit(1, 'skill id is required');
      const mode = resolveOutputMode(opts, app.stdout);
      try {
        if (topic === 'events') {
          const events = services.skills.getSkillUsageEvents(skillCtx(app), id);
          if (mode === 'json') {
            renderJson({ skillId: id, events }, { stdout: app.stdout });
            return;
          }
          renderHumanTable(
            events.map((e) => ({
              eventType: e.type,
              actor: e.actor,
              createdAt: e.createdAt,
              evidence: e.evidenceRefs.join(','),
            })),
            [
              { key: 'createdAt', label: 'TIME' },
              { key: 'eventType', label: 'EVENT' },
              { key: 'actor', label: 'ACTOR' },
              { key: 'evidence', label: 'EVIDENCE' },
            ],
            { stdout: app.stdout },
          );
          app.stdout.write(`\n${events.length} event(s)\n`);
          return;
        }
        if (topic === 'detail') {
          const detail = services.skills.getSkillDetail(skillCtx(app), id);
          if (mode === 'json') {
            renderJson(detail, { stdout: app.stdout });
            return;
          }
          renderHumanRecord(detail as unknown as Record<string, unknown>, { stdout: app.stdout });
          return;
        }
        throw new CommanderExit(1, `unknown topic '${topic}'; use 'events' or 'detail'`);
      } catch (error) {
        if (error instanceof CommanderExit) throw error;
        renderError(error, { stderr: app.stderr }, { mode });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });

  skill
    .command('validate')
    .description('Re-run skill metadata validation (manager.info)')
    .action((_opts, command) => {
      const id = command.parent?.args[0];
      if (!id) throw new CommanderExit(1, 'skill id is required');
      try {
        const detail = services.skills.getSkillDetail(skillCtx(app), id);
        app.stdout.write(`skill '${id}' OK — assetStatus=${detail.assetStatus}, source=${detail.source}\n`);
      } catch (error) {
        renderError(error, { stderr: app.stderr });
        throw new CommanderExit(1, error instanceof Error ? error.message : String(error));
      }
    });
}

function skillCtx(app: AppContext): services.skills.SkillsServiceContext {
  return {
    ...buildServiceContext(app),
    skillsManager: app.skills,
  };
}
