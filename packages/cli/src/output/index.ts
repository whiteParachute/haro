/**
 * CLI output helpers (FEAT-039 R11/R12).
 *
 * Every command renders results through these helpers so --json / --human
 * output stays uniform. Default mode follows R11: TTY → human, non-TTY → json.
 */

export {
  resolveOutputMode,
  renderJson,
  renderListJson,
  renderJsonDiagnostic,
  renderError,
  type OutputMode,
  type OutputModeFlags,
  type RenderTarget,
} from './render.js';
export {
  renderHumanTable,
  renderHumanRecord,
  renderHumanError,
  type ColumnDef,
} from './human.js';
export {
  confirmDestructive,
  type ConfirmOptions,
  type ConfirmHooks,
} from './confirm.js';
