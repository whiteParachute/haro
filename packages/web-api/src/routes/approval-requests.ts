import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  ApprovalDecisionOptionSchema,
  ApprovalRequestRecordSchema,
  EvolutionProposalSchema,
  type ApprovalDecisionOption,
  type ApprovalRequestRecord,
} from '@haro/agentdock-contract';
import { readWebAuth, requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type { WebRuntime } from '../runtime.js';

const RefSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  uri: z.string().optional(),
});

const ApprovalDecisionRecordSchema = z.object({
  id: z.string().min(1),
  approvalRequestId: z.string().min(1),
  proposalId: z.string().min(1),
  validationId: z.string().min(1),
  decision: ApprovalDecisionOptionSchema,
  direction: z.string().optional(),
  reviewer: z.object({
    source: z.literal('haro-web'),
    userId: z.string().optional(),
    username: z.string().optional(),
    role: z.string().optional(),
  }),
  sourceRef: RefSchema,
  approvalRef: RefSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

type ApprovalDecisionRecord = z.infer<typeof ApprovalDecisionRecordSchema>;

interface ApprovalRequestView {
  request: ApprovalRequestRecord;
  latestDecision?: ApprovalDecisionRecord;
}

export function createApprovalRequestsRoute(
  runtime: WebRuntime,
): Hono<ApiKeyAuthEnv> {
  const route = new Hono<ApiKeyAuthEnv>();

  route.get('/', requireWebPermission('read-only'), (c) => {
    const status = readStatusQuery(c.req.query('status'));
    if (!status) {
      return c.json({ error: 'Invalid status; expected pending, decided, or all' }, 400);
    }
    const views = listApprovalRequests(resolveHaroHome(runtime), status);
    return c.json({
      success: true,
      data: {
        items: views,
        total: views.length,
      },
    });
  });

  route.get('/:id', requireWebPermission('read-only'), (c) => {
    const view = getApprovalRequest(resolveHaroHome(runtime), c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    return c.json({ success: true, data: view });
  });

  route.post('/:id/decision', requireWebPermission('config-write'), async (c) => {
    const body = await readDecisionBody(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    const auth = readWebAuth(c);
    const result = decideApprovalRequest(resolveHaroHome(runtime), {
      requestId: c.req.param('id'),
      decision: body.value.decision,
      direction: body.value.direction,
      reviewer: {
        ...(auth?.kind === 'session'
          ? {
              userId: auth.user.id,
              username: auth.user.username,
              role: auth.role,
            }
          : { role: auth?.role ?? 'unknown' }),
      },
    });
    if (!result.ok) {
      return c.json({ error: result.error.message, code: result.error.code }, result.error.status);
    }
    return c.json({ success: true, data: result.value });
  });

  return route;
}

function resolveHaroHome(runtime: WebRuntime): string {
  return path.resolve(runtime.root ?? process.env.HARO_HOME ?? path.join(os.homedir(), '.haro'));
}

function approvalRequestsDir(root: string): string {
  return path.join(root, 'evolution', 'approval-requests');
}

function approvalDecisionsDir(root: string): string {
  return path.join(root, 'evolution', 'approval-decisions');
}

function proposalsDir(root: string): string {
  return path.join(root, 'evolution', 'proposals');
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

function readStatusQuery(value: string | undefined): 'pending' | 'decided' | 'all' | null {
  if (!value) return 'pending';
  return value === 'pending' || value === 'decided' || value === 'all'
    ? value
    : null;
}

function readJson<T>(filePath: string, schema: z.ZodTypeAny): T | null {
  try {
    return schema.parse(JSON.parse(readFileSync(filePath, 'utf8')) as unknown) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(tmp, filePath);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function listDecisionRecords(root: string): ApprovalDecisionRecord[] {
  const dir = approvalDecisionsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const record = readJson<ApprovalDecisionRecord>(path.join(dir, name), ApprovalDecisionRecordSchema);
      return record ? [record] : [];
    });
}

function latestDecisions(root: string): Map<string, ApprovalDecisionRecord> {
  const latest = new Map<string, ApprovalDecisionRecord>();
  for (const decision of listDecisionRecords(root)) {
    const current = latest.get(decision.approvalRequestId);
    if (!current || decision.createdAt > current.createdAt) {
      latest.set(decision.approvalRequestId, decision);
    }
  }
  return latest;
}

function listApprovalRequests(
  root: string,
  status: 'pending' | 'decided' | 'all',
): ApprovalRequestView[] {
  const dir = approvalRequestsDir(root);
  if (!existsSync(dir)) return [];
  const decisions = latestDecisions(root);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const request = readJson<ApprovalRequestRecord>(path.join(dir, name), ApprovalRequestRecordSchema);
      if (!request) return [];
      const latestDecision = decisions.get(request.id);
      const decided = Boolean(latestDecision);
      if (status === 'pending' && decided) return [];
      if (status === 'decided' && !decided) return [];
      return [{ request, ...(latestDecision ? { latestDecision } : {}) }];
    });
}

function getApprovalRequest(root: string, id: string): ApprovalRequestView | null {
  const request = readJson<ApprovalRequestRecord>(
    path.join(approvalRequestsDir(root), `${safeSegment(id)}.json`),
    ApprovalRequestRecordSchema,
  );
  if (!request || request.id !== id) return null;
  const latestDecision = latestDecisions(root).get(id);
  return { request, ...(latestDecision ? { latestDecision } : {}) };
}

async function readDecisionBody(readJsonBody: () => Promise<unknown>): Promise<
  | {
      ok: true;
      value: { decision: ApprovalDecisionOption; direction?: string };
    }
  | { ok: false; error: string }
> {
  let body: unknown;
  try {
    body = await readJsonBody();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  const parsed = z.object({
    decision: ApprovalDecisionOptionSchema,
    direction: z.string().optional(),
  }).safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  if (parsed.data.decision === 'request-changes' && !parsed.data.direction?.trim()) {
    return { ok: false, error: 'request-changes requires direction' };
  }
  return {
    ok: true,
    value: {
      decision: parsed.data.decision,
      ...(parsed.data.direction?.trim() ? { direction: parsed.data.direction.trim() } : {}),
    },
  };
}

function decideApprovalRequest(
  root: string,
  input: {
    requestId: string;
    decision: ApprovalDecisionOption;
    direction?: string;
    reviewer: { userId?: string; username?: string; role?: string };
  },
):
  | {
      ok: true;
      value: {
        request: ApprovalRequestRecord;
        decision: ApprovalDecisionRecord;
        proposalUpdated: boolean;
      };
    }
  | { ok: false; error: { status: 400 | 404 | 409; code: string; message: string } } {
  const view = getApprovalRequest(root, input.requestId);
  if (!view) {
    return {
      ok: false,
      error: { status: 404, code: 'APPROVAL_REQUEST_NOT_FOUND', message: 'Approval request not found' },
    };
  }
  if (view.latestDecision) {
    return {
      ok: false,
      error: { status: 409, code: 'APPROVAL_REQUEST_ALREADY_DECIDED', message: 'Approval request already has a decision' },
    };
  }

  const request = view.request;
  const timestamp = new Date().toISOString();
  const id = `approval_decision_${crypto
    .createHash('sha256')
    .update(JSON.stringify({ requestId: request.id, decision: input.decision, direction: input.direction ?? '', timestamp }))
    .digest('hex')
    .slice(0, 24)}`;
  const baseDecision = ApprovalDecisionRecordSchema.parse({
    id,
    approvalRequestId: request.id,
    proposalId: request.proposalId,
    validationId: request.validationId,
    decision: input.decision,
    ...(input.direction ? { direction: input.direction } : {}),
    reviewer: {
      source: 'haro-web',
      ...(input.reviewer.userId ? { userId: input.reviewer.userId } : {}),
      ...(input.reviewer.username ? { username: input.reviewer.username } : {}),
      ...(input.reviewer.role ? { role: input.reviewer.role } : {}),
    },
    sourceRef: {
      id: request.id,
      kind: 'approval-request',
      uri: `haro-sidecar://approval-requests/${encodeURIComponent(request.id)}`,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const decision = input.decision === 'approve'
    ? ApprovalDecisionRecordSchema.parse({
        ...baseDecision,
        approvalRef: {
          id: baseDecision.id,
          kind: 'human-approval',
          uri: `haro-sidecar://approval-decisions/${encodeURIComponent(baseDecision.id)}`,
        },
      })
    : baseDecision;

  writeJsonAtomic(
    path.join(approvalDecisionsDir(root), `${safeSegment(decision.id)}.json`),
    decision,
  );
  const proposalUpdated = updateProposal(root, request, decision);
  return { ok: true, value: { request, decision, proposalUpdated } };
}

function updateProposal(
  root: string,
  request: ApprovalRequestRecord,
  decision: ApprovalDecisionRecord,
): boolean {
  const filePath = path.join(proposalsDir(root), `${safeSegment(request.proposalId)}.json`);
  const proposal = readJson<z.infer<typeof EvolutionProposalSchema>>(filePath, EvolutionProposalSchema);
  if (!proposal || proposal.id !== request.proposalId) return false;

  if (decision.decision === 'approve' && decision.approvalRef) {
    const humanApprovalRefs = proposal.humanApprovalRefs ?? [];
    if (!humanApprovalRefs.some((ref) => ref.id === decision.approvalRef!.id)) {
      proposal.humanApprovalRefs = [...humanApprovalRefs, decision.approvalRef];
    }
  } else if (decision.decision === 'reject') {
    proposal.status = 'rejected';
  }
  proposal.updatedAt = decision.createdAt;
  writeJsonAtomic(filePath, proposal);
  return true;
}
