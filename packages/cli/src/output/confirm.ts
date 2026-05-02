/**
 * Destructive-action confirmation flow (FEAT-039 R12).
 *
 * Write commands (delete/disable/wipe) preview the action then ask for
 * confirmation. `--yes` skips the prompt; `--quiet` skips the preview too.
 * On non-TTY input without --yes, the command refuses (so a piped script
 * won't accidentally delete data).
 */

import type { Interface as ReadlineInterface } from 'node:readline/promises';
import { createInterface } from 'node:readline/promises';

export interface ConfirmOptions {
  /** Non-empty preview banner shown before the prompt. */
  preview?: string;
  /** Action verb shown in the prompt — e.g. "delete", "disable". */
  action: string;
  /** Target shown in the prompt — e.g. "session 'abc-123'". */
  target: string;
  /** --yes flag — skip prompt. */
  yes?: boolean;
  /** --quiet flag — skip preview but still prompt unless --yes. */
  quiet?: boolean;
  /** When true, require the user to type the target id back as a safety word. */
  requireTypeback?: boolean;
}

export interface ConfirmHooks {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export type ConfirmResult =
  | { confirmed: true }
  | { confirmed: false; reason: 'declined' | 'no-tty' | 'typeback-mismatch' };

export async function confirmDestructive(
  options: ConfirmOptions,
  hooks: ConfirmHooks = {},
): Promise<ConfirmResult> {
  const stdin = hooks.stdin ?? process.stdin;
  const stdout = hooks.stdout ?? process.stdout;
  const stderr = hooks.stderr ?? process.stderr;

  if (!options.quiet && options.preview) {
    stdout.write(`${options.preview}\n`);
  }

  if (options.yes) return { confirmed: true };

  const isTty = (stdin as { isTTY?: boolean }).isTTY === true;
  if (!isTty) {
    stderr.write(`refusing to ${options.action} ${options.target} without --yes (non-interactive stdin)\n`);
    return { confirmed: false, reason: 'no-tty' };
  }

  const rl: ReadlineInterface = createInterface({ input: stdin, output: stdout });
  try {
    if (options.requireTypeback) {
      const typed = (await rl.question(
        `Type '${options.target}' to confirm ${options.action}: `,
      )).trim();
      if (typed !== options.target) {
        return { confirmed: false, reason: 'typeback-mismatch' };
      }
      return { confirmed: true };
    }
    const answer = (await rl.question(`Confirm ${options.action} ${options.target}? [y/N] `))
      .trim()
      .toLowerCase();
    return answer === 'y' || answer === 'yes'
      ? { confirmed: true }
      : { confirmed: false, reason: 'declined' };
  } finally {
    rl.close();
  }
}
