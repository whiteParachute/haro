/**
 * Bridges `AppContext` (CLI runtime) into a `services.ServiceContext` shape
 * that `@haro/core/services` accepts.
 */

import type { services } from '@haro/core';
import type { AppContext } from '../index.js';

export function buildServiceContext(app: AppContext): services.ServiceContext {
  return {
    ...(app.opts.root ? { root: app.opts.root } : {}),
    dbFile: app.paths.dbFile,
    ...(app.opts.projectRoot ? { projectRoot: app.opts.projectRoot } : {}),
    logger: app.logger,
  };
}
