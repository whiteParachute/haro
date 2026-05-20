import { z } from 'zod';
import { NonEmptyStringSchema } from './primitives.js';
import type { ApprovalDecisionRecord, ApprovalRequestRecord } from './approval-request.js';
import type { EvolutionProposal } from './proposal.js';
import type { ValidationReport } from './validation.js';

export const DescriptionLintSeveritySchema = z.enum(['warning', 'blocker']);

export const DescriptionLintIssueSchema = z.object({
  severity: DescriptionLintSeveritySchema,
  ruleId: NonEmptyStringSchema,
  field: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  sample: NonEmptyStringSchema.optional(),
});

export const DescriptionLintReportSchema = z.object({
  status: z.enum(['pass', 'warning', 'blocker']),
  issueCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  blockerCount: z.number().int().nonnegative(),
  issues: z.array(DescriptionLintIssueSchema).default([]),
});

export type DescriptionLintSeverity = z.infer<typeof DescriptionLintSeveritySchema>;
export type DescriptionLintIssue = z.infer<typeof DescriptionLintIssueSchema>;
export type DescriptionLintReport = z.infer<typeof DescriptionLintReportSchema>;

export interface DescriptionLintTarget {
  kind: 'proposal' | 'validation' | 'approval-request' | 'approval-decision';
  id: string;
  fields: Array<{
    name: string;
    value: string;
    blockerSensitive?: boolean;
    blockerRules?: readonly string[];
  }>;
}

const NAKED_TERMS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\bfrontier signal\b/i, message: '把 frontier signal 改成“外部一手情报”。' },
  { pattern: /\bobservation batch\b/i, message: '把 observation batch 改成“本轮 Haro 自检快照”。' },
  { pattern: /proposal-content/i, message: '把 proposal-content 改成“本次改动的具体内容文件”。' },
  { pattern: /contentHash/i, message: '把 contentHash 改成“内容指纹”。' },
  { pattern: /gated-write/i, message: '把 gated-write 改成“必须人审通过才允许使用的写入类工具”。' },
  { pattern: /mcp-tool-config asset/i, message: '把 mcp-tool-config asset 改成“Haro 自己维护的 MCP 工具配置文件”。' },
];

const SECTION_MIX_RULES: Array<{ field: RegExp; pattern: RegExp; message: string }> = [
  { field: /^whyChange/, pattern: /证据|引用|内容指纹|自动检查|人审通过|不会|不写|不改 AgentDock/, message: '为什么改只写问题和不改的代价。' },
  { field: /^howChange/, pattern: /内容指纹|证据|haro rollback|只影响|不会回滚/, message: '怎么改只写对象和可见变化。' },
  { field: /^expectedBenefits/, pattern: /不会|不改|只影响|范围|边界/, message: '预期收益只写正向收益。' },
  { field: /^regressionRisks/, pattern: /haro rollback|request-changes|reject|审批页点|运行 `|恢复方式|命令/, message: '风险只写坏结果、感知方和恢复窗口。' },
  { field: /^rollbackPlan\.strategy/, pattern: /只影响|不会回滚|不改 AgentDock|aria-memory-vault|用户记忆|范围/, message: '回滚方案只写人怎么撤。' },
];

export function lintEvolutionProposalDescription(proposal: EvolutionProposal): DescriptionLintReport {
  return lintDescriptionTarget({
    kind: 'proposal',
    id: proposal.id,
    fields: [
      { name: 'title', value: proposal.title, blockerRules: ['naked-term'] },
      ...proposal.changeSet.map((change, index) => ({ name: `changeSet[${index}].summary`, value: change.summary })),
      ...proposal.testPlan.manualChecks.map((value, index) => ({ name: `manualChecks[${index}]`, value })),
      ...proposal.testPlan.regressionRisks.map((value, index) => ({ name: `regressionRisks[${index}]`, value })),
      { name: 'rollbackPlan.strategy', value: proposal.rollbackPlan.strategy },
    ],
  });
}

export function lintValidationDescription(validation: ValidationReport): DescriptionLintReport {
  return lintDescriptionTarget({
    kind: 'validation',
    id: validation.id,
    fields: [
      ...validation.blockingReasons.map((value, index) => ({ name: `blockingReasons[${index}]`, value })),
      ...validation.requiredTests.map((value, index) => ({ name: `requiredTests[${index}]`, value })),
    ],
  });
}

export function lintApprovalRequestDescription(request: ApprovalRequestRecord): DescriptionLintReport {
  return lintDescriptionTarget({
    kind: 'approval-request',
    id: request.id,
    fields: [
      { name: 'title', value: request.title, blockerSensitive: true },
      ...request.whyChange.map((value, index) => ({ name: `whyChange[${index}]`, value, blockerSensitive: true })),
      ...request.howChange.map((value, index) => ({ name: `howChange[${index}]`, value, blockerSensitive: true })),
      ...request.expectedBenefits.map((value, index) => ({ name: `expectedBenefits[${index}]`, value, blockerSensitive: true })),
      ...request.scope.map((value, index) => ({ name: `scope[${index}]`, value })),
      ...request.manualChecks.map((value, index) => ({ name: `manualChecks[${index}]`, value })),
      ...request.regressionRisks.map((value, index) => ({ name: `regressionRisks[${index}]`, value, blockerSensitive: true })),
      { name: 'rollbackPlan.strategy', value: request.rollbackPlan.strategy, blockerSensitive: true },
      { name: 'reviewerInstruction', value: request.reviewerInstruction, blockerSensitive: true },
    ],
  });
}

export function lintApprovalDecisionDescription(decision: ApprovalDecisionRecord): DescriptionLintReport {
  return lintDescriptionTarget({
    kind: 'approval-decision',
    id: decision.id,
    fields: [
      ...(decision.direction ? [{ name: 'direction', value: decision.direction, blockerSensitive: true }] : []),
    ],
  });
}

export function mergeDescriptionLintReports(reports: readonly DescriptionLintReport[]): DescriptionLintReport {
  const issues = reports.flatMap((report) => report.issues);
  return buildReport(issues);
}

function lintDescriptionTarget(target: DescriptionLintTarget): DescriptionLintReport {
  const issues: DescriptionLintIssue[] = [];
  for (const field of target.fields) {
    const text = field.value.trim();
    if (!text) continue;
    for (const term of NAKED_TERMS) {
      if (term.pattern.test(text)) {
        issues.push({
          severity: severityFor(field, 'naked-term'),
          ruleId: 'naked-term',
          field: `${target.kind}.${field.name}`,
          message: term.message,
          sample: truncateSample(text),
        });
      }
    }
    for (const sentence of readableSentences(text)) {
      if (sentence.length > 35) {
        issues.push({
          severity: severityFor(field, 'sentence-length'),
          ruleId: 'sentence-length',
          field: `${target.kind}.${field.name}`,
          message: '句子超过 35 个汉字或等价长度，请拆短。',
          sample: truncateSample(sentence),
        });
      }
    }
    for (const rule of SECTION_MIX_RULES) {
      if (rule.field.test(field.name) && rule.pattern.test(text)) {
        issues.push({
          severity: severityFor(field, 'section-contamination'),
          ruleId: 'section-contamination',
          field: `${target.kind}.${field.name}`,
          message: rule.message,
          sample: truncateSample(text),
        });
      }
    }
  }
  return buildReport(issues);
}

function severityFor(
  field: DescriptionLintTarget['fields'][number],
  ruleId: string,
): DescriptionLintIssue['severity'] {
  return field.blockerSensitive || field.blockerRules?.includes(ruleId) ? 'blocker' : 'warning';
}

function buildReport(issues: DescriptionLintIssue[]): DescriptionLintReport {
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const blockerCount = issues.filter((issue) => issue.severity === 'blocker').length;
  return {
    status: blockerCount > 0 ? 'blocker' : warningCount > 0 ? 'warning' : 'pass',
    issueCount: issues.length,
    warningCount,
    blockerCount,
    issues,
  };
}

function readableSentences(text: string): string[] {
  return text
    .replace(/`[^`]+`/g, '命令')
    .replace(/[A-Za-z0-9_:/.-]{24,}/g, '编号')
    .split(/[。！？\n]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function truncateSample(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
