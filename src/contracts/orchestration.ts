export const TENDER_SKILL_CONTRACT_MARKER = 'dsh-tender-workbench/workflow-v2' as const

export const TENDER_WORKFLOW_SKILL = 'tender-workbench' as const

export const TENDER_ACTION_SKILLS = [
  'tender-workbench-query',
  'tender-workbench-screening',
  'tender-workbench-analysis',
  'tender-workbench-review',
  'tender-workbench-report',
] as const

export type TenderActionSkillName = typeof TENDER_ACTION_SKILLS[number]

export const TENDER_ACTION_TOOLS = [
  'tender_workbench_run_query',
  'tender_workbench_preview_rules',
  'tender_workbench_confirm_rules',
  'tender_workbench_prepare_analysis_batch',
  'tender_workbench_commit_analysis_batch',
  'tender_workbench_apply_review',
  'tender_workbench_revert_review',
  'tender_workbench_create_report',
  'tender_workbench_retry_report',
] as const

export const TENDER_READ_TOOLS = [
  'tender_workbench_get_workflow_state',
  'tender_workbench_get_rule_drafting_context',
  'tender_workbench_get_analysis_record_context',
  'tender_workbench_get_report_narrative_context',
] as const

export const TENDER_TOOLS = [...TENDER_ACTION_TOOLS, ...TENDER_READ_TOOLS] as const

export type TenderActionToolName = typeof TENDER_ACTION_TOOLS[number]
export type TenderReadToolName = typeof TENDER_READ_TOOLS[number]
export type TenderToolNameV2 = typeof TENDER_TOOLS[number]

export const TENDER_INTENT_KINDS = [
  'query.run',
  'rules.propose',
  'rules.adjust',
  'rules.preview',
  'rules.confirm',
  'analysis.run',
  'analysis.follow-up',
  'review.apply',
  'review.revert',
  'report.create',
  'report.retry',
] as const

export type TenderWorkbenchIntentKindV2 = typeof TENDER_INTENT_KINDS[number]

export type WorkflowStage =
  | 'query'
  | 'overview'
  | 'rules'
  | 'classification'
  | 'analysis'
  | 'review'
  | 'report'

interface FixedEntry {
  readonly kind: 'fixed'
  readonly tool: TenderToolNameV2
}

interface PayloadEntry {
  readonly kind: 'payload-discriminated'
  readonly path: 'narrativeMode'
  readonly cases: Readonly<Record<'none' | 'requested', TenderToolNameV2>>
}

export interface TenderOrchestrationActionV2 {
  readonly intentKind: TenderWorkbenchIntentKindV2
  readonly actionSkill: TenderActionSkillName
  readonly stage: WorkflowStage
  readonly submission: 'mutating' | 'read-only-interaction'
  readonly entry: FixedEntry | PayloadEntry
  readonly allowedTools: readonly TenderToolNameV2[]
  readonly terminalTools: readonly TenderToolNameV2[]
  readonly completion: 'tool-control' | 'tool-control-and-turn-end'
}

export const TENDER_ORCHESTRATION_V2 = {
  'query.run': {
    intentKind: 'query.run', actionSkill: 'tender-workbench-query', stage: 'query', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_run_query' },
    allowedTools: ['tender_workbench_run_query'], terminalTools: ['tender_workbench_run_query'], completion: 'tool-control',
  },
  'rules.propose': {
    intentKind: 'rules.propose', actionSkill: 'tender-workbench-screening', stage: 'rules', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_get_rule_drafting_context' },
    allowedTools: ['tender_workbench_get_rule_drafting_context', 'tender_workbench_preview_rules'],
    terminalTools: ['tender_workbench_preview_rules'], completion: 'tool-control',
  },
  'rules.adjust': {
    intentKind: 'rules.adjust', actionSkill: 'tender-workbench-screening', stage: 'rules', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_preview_rules' },
    allowedTools: ['tender_workbench_preview_rules'], terminalTools: ['tender_workbench_preview_rules'], completion: 'tool-control',
  },
  'rules.preview': {
    intentKind: 'rules.preview', actionSkill: 'tender-workbench-screening', stage: 'rules', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_preview_rules' },
    allowedTools: ['tender_workbench_preview_rules'], terminalTools: ['tender_workbench_preview_rules'], completion: 'tool-control',
  },
  'rules.confirm': {
    intentKind: 'rules.confirm', actionSkill: 'tender-workbench-screening', stage: 'classification', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_confirm_rules' },
    allowedTools: ['tender_workbench_confirm_rules'], terminalTools: ['tender_workbench_confirm_rules'], completion: 'tool-control',
  },
  'analysis.run': {
    intentKind: 'analysis.run', actionSkill: 'tender-workbench-analysis', stage: 'analysis', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_prepare_analysis_batch' },
    allowedTools: ['tender_workbench_prepare_analysis_batch', 'tender_workbench_commit_analysis_batch'],
    terminalTools: ['tender_workbench_prepare_analysis_batch', 'tender_workbench_commit_analysis_batch'], completion: 'tool-control',
  },
  'analysis.follow-up': {
    intentKind: 'analysis.follow-up', actionSkill: 'tender-workbench-analysis', stage: 'analysis', submission: 'read-only-interaction',
    entry: { kind: 'fixed', tool: 'tender_workbench_get_analysis_record_context' },
    allowedTools: ['tender_workbench_get_analysis_record_context'], terminalTools: ['tender_workbench_get_analysis_record_context'],
    completion: 'tool-control-and-turn-end',
  },
  'review.apply': {
    intentKind: 'review.apply', actionSkill: 'tender-workbench-review', stage: 'review', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_apply_review' },
    allowedTools: ['tender_workbench_apply_review'], terminalTools: ['tender_workbench_apply_review'], completion: 'tool-control',
  },
  'review.revert': {
    intentKind: 'review.revert', actionSkill: 'tender-workbench-review', stage: 'review', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_revert_review' },
    allowedTools: ['tender_workbench_revert_review'], terminalTools: ['tender_workbench_revert_review'], completion: 'tool-control',
  },
  'report.create': {
    intentKind: 'report.create', actionSkill: 'tender-workbench-report', stage: 'report', submission: 'mutating',
    entry: {
      kind: 'payload-discriminated', path: 'narrativeMode',
      cases: { none: 'tender_workbench_create_report', requested: 'tender_workbench_get_report_narrative_context' },
    },
    allowedTools: ['tender_workbench_get_report_narrative_context', 'tender_workbench_create_report'],
    terminalTools: ['tender_workbench_create_report'], completion: 'tool-control',
  },
  'report.retry': {
    intentKind: 'report.retry', actionSkill: 'tender-workbench-report', stage: 'report', submission: 'mutating',
    entry: { kind: 'fixed', tool: 'tender_workbench_retry_report' },
    allowedTools: ['tender_workbench_retry_report'], terminalTools: ['tender_workbench_retry_report'], completion: 'tool-control',
  },
} as const satisfies Record<TenderWorkbenchIntentKindV2, TenderOrchestrationActionV2>

export function orchestrationFor(kind: TenderWorkbenchIntentKindV2): TenderOrchestrationActionV2 {
  return TENDER_ORCHESTRATION_V2[kind]
}

export function expectedEntryTool(
  kind: TenderWorkbenchIntentKindV2,
  payload: Readonly<Record<string, unknown>>,
): TenderToolNameV2 {
  const entry = orchestrationFor(kind).entry
  if (entry.kind === 'fixed') return entry.tool
  const discriminator = payload[entry.path]
  if (discriminator !== 'none' && discriminator !== 'requested') {
    throw new TypeError(`invalid ${entry.path} for ${kind}`)
  }
  return entry.cases[discriminator]
}

export function isTenderToolName(value: string): value is TenderToolNameV2 {
  return (TENDER_TOOLS as readonly string[]).includes(value)
}
