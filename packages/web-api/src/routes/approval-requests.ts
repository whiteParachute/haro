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
  ApprovalDecisionRecordSchema,
  ApprovalDecisionOptionSchema,
  ApprovalRequestRecordSchema,
  ApplicationRecordSchema,
  AssetEventSchema,
  AssetSnapshotRecordSchema,
  EvolutionProposalSchema,
  RollbackRecordSchema,
  lintApprovalDecisionDescription,
  type ApprovalDecisionRecord,
  type ApprovalDecisionOption,
  type ApprovalRequestRecord,
  type ApplicationRecord,
  type AssetEvent,
  type AssetSnapshotRecord,
  type EvolutionProposal,
  type RollbackRecord,
} from '@haro/agentdock-contract';
import { readWebAuth, requireWebPermission } from '../auth.js';
import type { ApiKeyAuthEnv } from '../types.js';
import type {
  ApprovalConversationMessage,
  ApprovalDecisionAutoApplyResult,
  ReviewConversationReplyInput,
  WebRuntime,
} from '../runtime.js';

interface ApprovalConversationRecord {
  id: string;
  associatedApprovalRequestId: string;
  proposalId: string;
  validationId: string;
  messages: ApprovalConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

const ApprovalConversationMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

const ApprovalConversationRecordSchema = z.object({
  id: z.string().min(1),
  associatedApprovalRequestId: z.string().min(1),
  proposalId: z.string().min(1),
  validationId: z.string().min(1),
  messages: z.array(ApprovalConversationMessageSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

interface ApprovalRequestView {
  request: ApprovalRequestRecord;
  latestDecision?: ApprovalDecisionRecord;
  lifecycle: ApprovalRequestLifecycle;
}

type ApprovalLifecycleStatus = 'undecided' | 'approved' | 'rejected' | 'applied' | 'rolled-back';

interface ApprovalRequestLifecycle {
  status: ApprovalLifecycleStatus;
  decision?: {
    id: string;
    decision: ApprovalDecisionOption;
    direction?: string;
    reviewer: ApprovalDecisionRecord['reviewer'];
    createdAt: string;
    updatedAt: string;
  };
  application?: {
    id: string;
    status: ApplicationRecord['status'];
    gateCode: ApplicationRecord['gateCode'];
    applied: boolean;
    snapshotId?: string;
    rollbackId?: string;
    assetEventIds: string[];
    blockingReasons: string[];
    createdAt: string;
    updatedAt: string;
  };
  assetEvents: Array<{
    id: string;
    eventType: AssetEvent['eventType'];
    status: AssetEvent['status'];
    assetId: string;
    kind: AssetEvent['kind'];
    contentHash: string;
    createdAt: string;
  }>;
  snapshot?: {
    id: string;
    createdAt: string;
    entryCount: number;
    assetIds: string[];
  };
  rollback?: {
    id: string;
    createdAt: string;
    reversible: boolean;
    entryCount: number;
    rolledBack: boolean;
  };
  proposalContent?: {
    contentHashes: string[];
    contentRefs: string[];
    targetRefs: string[];
  };
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

  route.get('/:id/conversations', requireWebPermission('read-only'), (c) => {
    const view = getApprovalRequest(resolveHaroHome(runtime), c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    const items = listApprovalConversations(resolveHaroHome(runtime), view.request.id);
    return c.json({ success: true, data: { items, total: items.length } });
  });

  route.post('/:id/conversations', requireWebPermission('config-write'), (c) => {
    const view = getApprovalRequest(resolveHaroHome(runtime), c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    const record = createApprovalConversation(resolveHaroHome(runtime), view.request);
    return c.json({ success: true, data: record });
  });

  route.get('/:id/conversations/:conversationId', requireWebPermission('read-only'), (c) => {
    const view = getApprovalRequest(resolveHaroHome(runtime), c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    const record = readApprovalConversation(
      resolveHaroHome(runtime),
      view.request.id,
      c.req.param('conversationId'),
    );
    if (!record) return c.json({ error: 'Approval conversation not found' }, 404);
    return c.json({ success: true, data: record });
  });

  route.post('/:id/conversations/:conversationId/messages', requireWebPermission('config-write'), async (c) => {
    const view = getApprovalRequest(resolveHaroHome(runtime), c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    const body = await readConversationMessageBody(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    const record = appendApprovalConversationMessage(
      resolveHaroHome(runtime),
      view.request.id,
      c.req.param('conversationId'),
      {
        role: 'user',
        content: body.value.content,
      },
    );
    if (!record) return c.json({ error: 'Approval conversation not found' }, 404);
    return c.json({ success: true, data: record });
  });

  route.post('/:id/conversations/:conversationId/agent-reply', requireWebPermission('config-write'), (c) => {
    const root = resolveHaroHome(runtime);
    const view = getApprovalRequest(root, c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    const conversation = readApprovalConversation(root, view.request.id, c.req.param('conversationId'));
    if (!conversation) return c.json({ error: 'Approval conversation not found' }, 404);
    if (!runtime.reviewConversationReply) {
      return c.json({ error: 'Review conversation agent is not configured' }, 503);
    }
    return streamApprovalConversationReply(runtime, root, view.request, conversation, c.get('logger'));
  });

  route.get('/:id', requireWebPermission('read-only'), (c) => {
    const view = getApprovalRequest(resolveHaroHome(runtime), c.req.param('id'));
    if (!view) return c.json({ error: 'Approval request not found' }, 404);
    return c.json({ success: true, data: view });
  });

  route.post('/:id/decision', requireWebPermission('config-write'), async (c) => {
    const root = resolveHaroHome(runtime);
    const body = await readDecisionBody(c.req.json.bind(c.req));
    if (!body.ok) return c.json({ error: body.error }, 400);
    const direction =
      body.value.decision === 'request-changes'
        ? buildRequestChangesDirection(root, c.req.param('id'), body.value.direction, body.value.conversationId)
        : undefined;
    if (direction && !direction.ok) return c.json({ error: direction.error }, 400);
    const auth = readWebAuth(c);
    const result = decideApprovalRequest(root, {
      requestId: c.req.param('id'),
      decision: body.value.decision,
      direction: direction?.direction ?? body.value.direction,
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
    const autoApply = await triggerAutoApplyAfterApprove(runtime, result.value, c.get('logger'));
    return c.json({ success: true, data: { ...result.value, ...(autoApply ? { autoApply } : {}) } });
  });

  return route;
}

async function triggerAutoApplyAfterApprove(
  runtime: WebRuntime,
  value: {
    request: ApprovalRequestRecord;
    decision: ApprovalDecisionRecord;
  },
  logger: ApiKeyAuthEnv['Variables']['logger'],
): Promise<ApprovalDecisionAutoApplyResult | undefined> {
  if (value.decision.decision !== 'approve' || !runtime.autoApplyApprovedDecision) return undefined;
  try {
    return await runtime.autoApplyApprovedDecision({
      requestId: value.request.id,
      proposalId: value.request.proposalId,
      validationId: value.request.validationId,
      decisionId: value.decision.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error({ error: message, proposalId: value.request.proposalId }, 'auto apply after approve failed');
    return {
      attempted: true,
      status: 'error',
      proposalId: value.request.proposalId,
      blockingReasons: [message],
    };
  }
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

function applicationsDir(root: string): string {
  return path.join(root, 'evolution', 'applications');
}

function assetEventsDir(root: string): string {
  return path.join(root, 'assets', 'events');
}

function snapshotsDir(root: string): string {
  return path.join(root, 'evolution', 'snapshots');
}

function rollbacksDir(root: string): string {
  return path.join(root, 'evolution', 'rollbacks');
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

function listJsonRecords<T>(dir: string, schema: z.ZodTypeAny): T[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const record = readJson<T>(path.join(dir, name), schema);
      return record ? [record] : [];
    });
}


function approvalConversationsDir(root: string, approvalRequestId: string): string {
  return path.join(root, 'evolution', 'approval-conversations', safeSegment(approvalRequestId));
}

function approvalConversationFilePath(root: string, approvalRequestId: string, conversationId: string): string {
  return path.join(approvalConversationsDir(root, approvalRequestId), `${safeSegment(conversationId)}.json`);
}

function listApprovalConversations(root: string, approvalRequestId: string): ApprovalConversationRecord[] {
  const dir = approvalConversationsDir(root, approvalRequestId);
  const records = listJsonRecords<ApprovalConversationRecord>(dir, ApprovalConversationRecordSchema);
  return records
    .filter((record) => record.associatedApprovalRequestId === approvalRequestId)
    .sort((a, b) => compareIsoDateTime(a.updatedAt, b.updatedAt) || a.id.localeCompare(b.id));
}

function readApprovalConversation(
  root: string,
  approvalRequestId: string,
  conversationId: string,
): ApprovalConversationRecord | null {
  const record = readJson<ApprovalConversationRecord>(
    approvalConversationFilePath(root, approvalRequestId, conversationId),
    ApprovalConversationRecordSchema,
  );
  return record?.associatedApprovalRequestId === approvalRequestId ? record : null;
}

function createApprovalConversation(root: string, request: ApprovalRequestRecord): ApprovalConversationRecord {
  const timestamp = new Date().toISOString();
  const id = `approval_conversation_${crypto
    .createHash('sha256')
    .update(JSON.stringify({ requestId: request.id, timestamp }))
    .digest('hex')
    .slice(0, 24)}`;
  const record = ApprovalConversationRecordSchema.parse({
    id,
    associatedApprovalRequestId: request.id,
    proposalId: request.proposalId,
    validationId: request.validationId,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeApprovalConversation(root, record);
  return record;
}

function appendApprovalConversationMessage(
  root: string,
  approvalRequestId: string,
  conversationId: string,
  input: { role: ApprovalConversationMessage['role']; content: string; metadata?: Record<string, unknown> },
): ApprovalConversationRecord | null {
  const record = readApprovalConversation(root, approvalRequestId, conversationId);
  if (!record) return null;
  const timestamp = new Date().toISOString();
  const message = ApprovalConversationMessageSchema.parse({
    id: `approval_message_${crypto
      .createHash('sha256')
      .update(JSON.stringify({ conversationId, role: input.role, content: input.content, timestamp }))
      .digest('hex')
      .slice(0, 24)}`,
    role: input.role,
    content: input.content.trim(),
    createdAt: timestamp,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  const next = ApprovalConversationRecordSchema.parse({
    ...record,
    messages: [...record.messages, message],
    updatedAt: timestamp,
  });
  writeApprovalConversation(root, next);
  return next;
}

function writeApprovalConversation(root: string, record: ApprovalConversationRecord): void {
  writeJsonAtomic(
    approvalConversationFilePath(root, record.associatedApprovalRequestId, record.id),
    record,
  );
}

async function readConversationMessageBody(readJsonBody: () => Promise<unknown>): Promise<
  | { ok: true; value: { content: string } }
  | { ok: false; error: string }
> {
  let body: unknown;
  try {
    body = await readJsonBody();
  } catch {
    return { ok: false, error: 'Request body must be valid JSON' };
  }
  const parsed = z.object({ content: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const content = parsed.data.content.trim();
  if (!content) return { ok: false, error: 'Message content is required' };
  return { ok: true, value: { content } };
}

function streamApprovalConversationReply(
  runtime: WebRuntime,
  root: string,
  request: ApprovalRequestRecord,
  conversation: ApprovalConversationRecord,
  logger: ApiKeyAuthEnv['Variables']['logger'],
): Response {
  const encoder = new TextEncoder();
  let streamedContent = '';
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const result = await runtime.reviewConversationReply!({
          approvalRequest: conversationRequestContext(request),
          messages: conversation.messages,
          onText: (chunk) => {
            if (!chunk) return;
            streamedContent += chunk;
            send('delta', { content: chunk });
          },
        });
        const content = result.content.trim() || streamedContent.trim();
        if (!content) throw new Error('Review conversation agent returned an empty response');
        if (!streamedContent.trim()) send('delta', { content });
        const next = appendApprovalConversationMessage(root, request.id, conversation.id, {
          role: 'assistant',
          content,
          metadata: {
            ...(result.provider ? { provider: result.provider } : {}),
            ...(result.model ? { model: result.model } : {}),
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          },
        });
        send('done', { conversation: next });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.error({ error: message, approvalRequestId: request.id }, 'approval conversation agent failed');
        send('error', { error: message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}

function conversationRequestContext(request: ApprovalRequestRecord): ReviewConversationReplyInput['approvalRequest'] {
  return {
    id: request.id,
    title: request.title,
    level: request.level,
    targetKind: request.targetKind,
    riskLevel: request.riskLevel,
    whyChange: request.whyChange,
    howChange: request.howChange,
    expectedBenefits: request.expectedBenefits,
    regressionRisks: request.regressionRisks,
  };
}

function buildRequestChangesDirection(
  root: string,
  requestId: string,
  direction: string | undefined,
  conversationId: string | undefined,
): { ok: true; direction: string } | { ok: false; error: string } {
  if (!conversationId) return direction?.trim() ? { ok: true, direction: direction.trim() } : { ok: false, error: 'request-changes requires direction' };
  const conversation = readApprovalConversation(root, requestId, conversationId);
  if (!conversation) return { ok: false, error: 'Approval conversation not found' };
  const summary = summarizeApprovalConversation(conversation);
  const parts = [
    direction?.trim() ? `用户最终要求：${direction.trim()}` : '用户通过对话面板要求修改。',
    '对话摘要：',
    summary,
    `原始对话：haro-sidecar://approval-conversations/${encodeURIComponent(requestId)}/${encodeURIComponent(conversation.id)}`,
  ];
  return { ok: true, direction: parts.join('\n') };
}

function summarizeApprovalConversation(conversation: ApprovalConversationRecord): string {
  const lines = conversation.messages.slice(-12).map((message) => {
    const role = message.role === 'user' ? '用户' : 'Haro';
    return `- ${role}: ${truncateForDirection(message.content, 500)}`;
  });
  return lines.length > 0 ? lines.join('\n') : '- 用户没有留下对话内容。';
}

function truncateForDirection(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
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
  return listJsonRecords<ApprovalDecisionRecord>(approvalDecisionsDir(root), ApprovalDecisionRecordSchema);
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
  const views = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const request = readJson<ApprovalRequestRecord>(path.join(dir, name), ApprovalRequestRecordSchema);
      if (!request) return [];
      const latestDecision = decisions.get(request.id);
      const decided = Boolean(latestDecision);
      if (status === 'pending' && decided) return [];
      if (status === 'decided' && !decided) return [];
      return [buildApprovalRequestView(root, request, latestDecision)];
    });
  return views.sort(compareApprovalRequestViews);
}

function compareApprovalRequestViews(a: ApprovalRequestView, b: ApprovalRequestView): number {
  const created = compareIsoDateTime(a.request.createdAt, b.request.createdAt);
  if (created !== 0) return created;
  const updated = compareIsoDateTime(a.request.updatedAt, b.request.updatedAt);
  if (updated !== 0) return updated;
  return a.request.id.localeCompare(b.request.id);
}

function compareIsoDateTime(a: string, b: string): number {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) && Number.isNaN(right)) return a.localeCompare(b);
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  return left - right;
}

function getApprovalRequest(root: string, id: string): ApprovalRequestView | null {
  const request = readJson<ApprovalRequestRecord>(
    path.join(approvalRequestsDir(root), `${safeSegment(id)}.json`),
    ApprovalRequestRecordSchema,
  );
  if (!request || request.id !== id) return null;
  const latestDecision = latestDecisions(root).get(id);
  return buildApprovalRequestView(root, request, latestDecision);
}

function buildApprovalRequestView(
  root: string,
  request: ApprovalRequestRecord,
  latestDecision?: ApprovalDecisionRecord,
): ApprovalRequestView {
  return {
    request,
    ...(latestDecision ? { latestDecision } : {}),
    lifecycle: buildApprovalLifecycle(root, request, latestDecision),
  };
}

function buildApprovalLifecycle(
  root: string,
  request: ApprovalRequestRecord,
  latestDecision?: ApprovalDecisionRecord,
): ApprovalRequestLifecycle {
  const proposal = readProposal(root, request.proposalId);
  const application = latestApplicationForProposal(root, request.proposalId);
  const assetEvents = listAssetEventsForProposal(root, request.proposalId, application)
    .sort((a, b) => compareIsoDateTime(a.createdAt, b.createdAt))
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      status: event.status,
      assetId: event.assetId,
      kind: event.kind,
      contentHash: event.contentHash,
      createdAt: event.createdAt,
    }));
  const snapshot = application?.snapshotRef
    ? readJson<AssetSnapshotRecord>(
        path.join(snapshotsDir(root), `${safeSegment(application.snapshotRef.id)}.json`),
        AssetSnapshotRecordSchema,
      )
    : latestSnapshotForProposal(root, request.proposalId);
  const rollback = application?.rollbackRef
    ? readJson<RollbackRecord>(
        path.join(rollbacksDir(root), `${safeSegment(application.rollbackRef.id)}.json`),
        RollbackRecordSchema,
      )
    : latestRollbackForProposal(root, request.proposalId);
  const rolledBack = Boolean(
    application?.status === 'rolled-back' || assetEvents.some((event) => event.eventType === 'rolled-back'),
  );

  const status = deriveLifecycleStatus(latestDecision, application, assetEvents, rolledBack);
  const lifecycle: ApprovalRequestLifecycle = {
    status,
    assetEvents,
    ...(latestDecision
      ? {
          decision: {
            id: latestDecision.id,
            decision: latestDecision.decision,
            ...(latestDecision.direction ? { direction: latestDecision.direction } : {}),
            reviewer: latestDecision.reviewer,
            createdAt: latestDecision.createdAt,
            updatedAt: latestDecision.updatedAt,
          },
        }
      : {}),
    ...(application
      ? {
          application: {
            id: application.id,
            status: application.status,
            gateCode: application.gateCode,
            applied: application.applied,
            ...(application.snapshotRef ? { snapshotId: application.snapshotRef.id } : {}),
            ...(application.rollbackRef ? { rollbackId: application.rollbackRef.id } : {}),
            assetEventIds: application.assetEventRefs.map((ref) => ref.id),
            blockingReasons: application.blockingReasons,
            createdAt: application.createdAt,
            updatedAt: application.updatedAt,
          },
        }
      : {}),
    ...(snapshot
      ? {
          snapshot: {
            id: snapshot.id,
            createdAt: snapshot.createdAt,
            entryCount: snapshot.entries.length,
            assetIds: snapshot.entries.map((entry) => entry.assetId),
          },
        }
      : {}),
    ...(rollback
      ? {
          rollback: {
            id: rollback.id,
            createdAt: rollback.createdAt,
            reversible: rollback.reversible,
            entryCount: rollback.entries.length,
            rolledBack,
          },
        }
      : {}),
    ...(proposal ? { proposalContent: summarizeProposalContent(proposal) } : {}),
  };
  return lifecycle;
}

function deriveLifecycleStatus(
  latestDecision: ApprovalDecisionRecord | undefined,
  application: ApplicationRecord | null,
  assetEvents: ApprovalRequestLifecycle['assetEvents'],
  rolledBack: boolean,
): ApprovalLifecycleStatus {
  if (!latestDecision) return 'undecided';
  if (latestDecision.decision !== 'approve') return 'rejected';
  if (rolledBack) return 'rolled-back';
  if (application?.status === 'applied' || assetEvents.some((event) => event.eventType === 'applied')) {
    return 'applied';
  }
  return 'approved';
}

function readProposal(root: string, proposalId: string): EvolutionProposal | null {
  return readJson<EvolutionProposal>(
    path.join(proposalsDir(root), `${safeSegment(proposalId)}.json`),
    EvolutionProposalSchema,
  );
}

function latestApplicationForProposal(root: string, proposalId: string): ApplicationRecord | null {
  return latestByUpdatedAt(
    listJsonRecords<ApplicationRecord>(applicationsDir(root), ApplicationRecordSchema)
      .filter((record) => record.proposalId === proposalId),
  );
}

function latestSnapshotForProposal(root: string, proposalId: string): AssetSnapshotRecord | null {
  return latestByCreatedAt(
    listJsonRecords<AssetSnapshotRecord>(snapshotsDir(root), AssetSnapshotRecordSchema)
      .filter((record) => record.proposalId === proposalId),
  );
}

function latestRollbackForProposal(root: string, proposalId: string): RollbackRecord | null {
  return latestByCreatedAt(
    listJsonRecords<RollbackRecord>(rollbacksDir(root), RollbackRecordSchema)
      .filter((record) => record.proposalId === proposalId),
  );
}

function listAssetEventsForProposal(
  root: string,
  proposalId: string,
  application: ApplicationRecord | null,
): AssetEvent[] {
  const applicationEventIds = new Set(application?.assetEventRefs.map((ref) => ref.id) ?? []);
  return listJsonRecords<AssetEvent>(assetEventsDir(root), AssetEventSchema)
    .filter((event) => {
      if (applicationEventIds.has(event.id)) return true;
      return event.proposalRef?.id === proposalId && (event.eventType === 'applied' || event.eventType === 'rolled-back');
    });
}

function summarizeProposalContent(proposal: EvolutionProposal): ApprovalRequestLifecycle['proposalContent'] {
  return {
    contentHashes: uniqueStrings(proposal.changeSet.flatMap((change) => change.contentHash ? [change.contentHash] : [])),
    contentRefs: uniqueStrings(proposal.changeSet.flatMap((change) => change.contentRef ? [change.contentRef] : [])),
    targetRefs: uniqueStrings(proposal.changeSet.map((change) => change.targetRef.id)),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function latestByUpdatedAt<T extends { createdAt: string; updatedAt: string }>(records: T[]): T | null {
  return records
    .slice()
    .sort((a, b) => {
      const updated = compareIsoDateTime(a.updatedAt, b.updatedAt);
      if (updated !== 0) return updated;
      return compareIsoDateTime(a.createdAt, b.createdAt);
    })
    .at(-1) ?? null;
}

function latestByCreatedAt<T extends { createdAt: string }>(records: T[]): T | null {
  return records
    .slice()
    .sort((a, b) => compareIsoDateTime(a.createdAt, b.createdAt))
    .at(-1) ?? null;
}

async function readDecisionBody(readJsonBody: () => Promise<unknown>): Promise<
  | {
      ok: true;
      value: { decision: ApprovalDecisionOption; direction?: string; conversationId?: string };
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
    conversationId: z.string().min(1).optional(),
  }).safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  if (
    parsed.data.decision === 'request-changes' &&
    !parsed.data.direction?.trim() &&
    !parsed.data.conversationId?.trim()
  ) {
    return { ok: false, error: 'request-changes requires direction' };
  }
  return {
    ok: true,
    value: {
      decision: parsed.data.decision,
      ...(parsed.data.direction?.trim() ? { direction: parsed.data.direction.trim() } : {}),
      ...(parsed.data.conversationId?.trim() ? { conversationId: parsed.data.conversationId.trim() } : {}),
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
  const parsedDecision = ApprovalDecisionRecordSchema.parse({
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
  const baseDecision = ApprovalDecisionRecordSchema.parse({
    ...parsedDecision,
    descriptionLint: lintApprovalDecisionDescription(parsedDecision),
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
  } else if (decision.decision === 'request-changes') {
    proposal.status = 'superseded';
  }
  proposal.updatedAt = decision.createdAt;
  writeJsonAtomic(filePath, proposal);
  return true;
}
