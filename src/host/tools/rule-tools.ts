import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { NormalizedDatasetV1Schema } from '../../contracts/dataset.ts'
import {
  ConfirmedRuleSetV1Schema,
  ConfirmRulesCommandV1Schema,
  PreviewRulesCommandV1Schema,
  RuleDraftArtifactV1Schema,
  RulePreviewArtifactV1Schema,
  ruleDraftFingerprint,
  type PreviewRulesCommandV1,
} from '../../contracts/screening.ts'
import {
  TenderWorkflowProjectionV1Schema,
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV1,
} from '../../contracts/workflow.ts'
import {
  CommandReceiptCoordinator,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/command-receipts.ts'
import {
  createArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import {
  classifyTenderProjects,
  createClassifiedDataset,
  createRulePreviewArtifact,
} from '../pipeline/classify.ts'

const RuleToolResultV1Schema = z.object({
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  state: TenderWorkflowProjectionV1Schema,
}).strict()

export type RuleToolResultV1 = z.infer<typeof RuleToolResultV1Schema>

export interface RuleToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: CommandReceiptCoordinator
}

function jsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('value is not lossless JSON')
  return JSON.parse(serialized) as JsonValue
}

function requireAgent(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('tender workbench tools require an Agent-owned Session')
  return exec.agent
}

function currentProjection(dependencies: RuleToolDependencies, exec: ToolRunContext): TenderWorkflowProjectionV1 {
  const agent = requireAgent(exec)
  return dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

function assertCurrentDataset(
  state: TenderWorkflowProjectionV1,
  activeDatasetRef: string,
  projectionRevision: number,
): NonNullable<NonNullable<TenderWorkflowProjectionV1['query']>['normalizedData']> {
  const active = state.query?.normalizedData
  if (active === undefined || active.id !== activeDatasetRef) {
    throw new Error('活动数据快照已变化；请基于当前 activeDatasetRef 重新生成初筛口径。')
  }
  if (state.revision !== projectionRevision) {
    throw new Error('Projection revision 已变化；旧草案或预览不能继续使用。')
  }
  return active
}

function validatedFingerprint(rules: PreviewRulesCommandV1['rules'], fingerprint?: string): string {
  const computed = ruleDraftFingerprint(rules)
  if (fingerprint !== undefined && computed !== fingerprint) {
    throw new Error('规则草案指纹与完整规则内容不匹配。')
  }
  return computed
}

function ruleSchema() {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      id: { type: 'string' as const, required: true as const },
      name: { type: 'string' as const, required: true as const },
      enabled: { type: 'boolean' as const, required: true as const },
      action: { type: 'string' as const, enum: ['include', 'observe', 'exclude', 'manual-review'] as const, required: true as const },
      sources: { type: 'array' as const, items: { type: 'string' as const, enum: ['tender', 'proposed'] as const }, required: true as const },
      scope: { type: 'string' as const, enum: ['title', 'purchaser', 'all'] as const, required: true as const },
      keywords: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
      priority: { type: 'integer' as const, required: true as const },
      exceptions: { type: 'array' as const, items: { type: 'string' as const }, required: true as const },
      reason: { type: 'string' as const, required: true as const },
    },
  }
}

function sharedParameters() {
  return {
    schemaVersion: { type: 'integer' as const, const: 1, required: true as const },
    commandId: { type: 'string' as const, required: true as const },
    activeDatasetRef: { type: 'string' as const, required: true as const },
    projectionRevision: { type: 'integer' as const, required: true as const },
    rules: { type: 'array' as const, items: ruleSchema(), required: true as const },
  }
}

function outputSchema() {
  return {
    schema: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        outcome: { type: 'string' as const, const: 'succeeded' as const, required: true as const },
        message: { type: 'string' as const, required: true as const },
        state: { type: 'json' as const, required: true as const },
      },
    },
  }
}

function presentationMeta(
  command: 'tender_workbench_preview_rules' | 'tender_workbench_confirm_rules',
  args: { readonly commandId: string },
  value: unknown,
): JsonValue {
  const parsed = RuleToolResultV1Schema.parse(value)
  return jsonValue({
    domain: 'dsh-tender-workbench',
    schemaVersion: 1,
    commandId: args.commandId,
    command,
    state: parsed.state,
  })
}

function previewState(
  previous: TenderWorkflowProjectionV1,
  nextRevision: number,
  now: string,
  input: z.infer<typeof PreviewRulesCommandV1Schema>,
  draftFingerprint: string,
  draft: Awaited<ReturnType<ReturnType<typeof createArtifactTransaction>['stageJson']>>,
  preview: Awaited<ReturnType<ReturnType<typeof createArtifactTransaction>['stageJson']>>,
  result: z.infer<typeof RulePreviewArtifactV1Schema>,
): TenderWorkflowProjectionV1 {
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, ...base } = previous
  return TenderWorkflowProjectionV1Schema.parse({
    ...base,
    revision: nextRevision,
    currentStage: 'rules',
    stages: {
      ...base.stages,
      rules: { status: 'succeeded', updatedAt: now },
    },
    rules: {
      ...base.rules,
      draft,
      draftOrigin: input.origin,
      draftFingerprint,
      preview,
      previewRevision: nextRevision,
      activeDatasetId: input.activeDatasetRef,
      ruleCount: input.rules.length,
      rawMatches: result.rawMatches,
      covered: result.covered,
      conflicts: result.conflicts,
    },
  })
}

export function createTenderWorkbenchPreviewRulesTool(dependencies: RuleToolDependencies) {
  return defineTool({
    name: 'tender_workbench_preview_rules',
    description: 'Validate one bounded S3 rule draft and deterministically preview it against the current active dataset. Invoke exactly once for each user-visible draft, adjustment, or preview Intent; after the result, end the turn instead of revising or previewing again. Never confirms a rule version or changes active classification.',
    parameters: {
      ...sharedParameters(),
      kind: { type: 'string', const: 'rules.preview', required: true },
      origin: { type: 'string', enum: ['agent', 'user'], required: true },
      draftFingerprint: { type: 'string' },
    },
    output: {
      ...outputSchema(),
      render(_args, value) {
        const parsed = RuleToolResultV1Schema.parse(value)
        return [{ type: 'text', text: parsed.message }]
      },
      presentationMeta(args, value) {
        return presentationMeta('tender_workbench_preview_rules', args, value)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = PreviewRulesCommandV1Schema.parse(rawArgs)
      const draftFingerprint = validatedFingerprint(args.rules, args.draftFingerprint)
      const previous = currentProjection(dependencies, exec)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const command = await dependencies.receipts.run(String(agent.session.id), {
        commandId: args.commandId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: previous.revision,
        store: transaction,
        revisionOf: result => RuleToolResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          assertCurrentDataset(previous, args.activeDatasetRef, args.projectionRevision)
          exec.signal.throwIfAborted()
          const dataset = NormalizedDatasetV1Schema.parse(await transaction.readJsonArtifact(args.activeDatasetRef, 'normalized-data'))
          const run = classifyTenderProjects(dataset.rows, args.rules)
          const previewValue = createRulePreviewArtifact({
            activeDatasetId: args.activeDatasetRef,
            basedOnRevision: previous.revision,
            stateRevision: nextRevision,
            draftFingerprint,
            origin: args.origin,
            run,
          })
          const draftValue = RuleDraftArtifactV1Schema.parse({
            schemaVersion: 1,
            activeDatasetId: args.activeDatasetRef,
            basedOnRevision: previous.revision,
            draftFingerprint,
            origin: args.origin,
            rules: args.rules,
          })
          const draft = await transaction.stageJson('rule-draft', `rule-draft-${args.commandId}.json`, jsonValue(draftValue))
          const preview = await transaction.stageJson('rule-preview', `rule-preview-${args.commandId}.json`, jsonValue(previewValue))
          const now = new Date().toISOString()
          const state = previewState(previous, nextRevision, now, args, draftFingerprint, draft, preview, previewValue)
          return jsonValue(RuleToolResultV1Schema.parse({
            outcome: 'succeeded',
            message: `初筛口径预览完成：覆盖 ${run.covered}/${run.total} 个项目，发现 ${run.conflicts} 个跨动作冲突。`,
            state,
          })) as ReceiptJsonValue
        },
      })
      return RuleToolResultV1Schema.parse(command.result)
    },
  })
}

function samePreview(
  preview: z.infer<typeof RulePreviewArtifactV1Schema>,
  run: ReturnType<typeof classifyTenderProjects>,
): boolean {
  return JSON.stringify({
    counts: preview.counts,
    total: preview.total,
    covered: preview.covered,
    conflicts: preview.conflicts,
    rawMatches: preview.rawMatches,
    ruleImpacts: preview.ruleImpacts,
  }) === JSON.stringify({
    counts: run.counts,
    total: run.total,
    covered: run.covered,
    conflicts: run.conflicts,
    rawMatches: run.rawMatches,
    ruleImpacts: run.ruleImpacts,
  })
}

export function createTenderWorkbenchConfirmRulesTool(dependencies: RuleToolDependencies) {
  return defineTool({
    name: 'tender_workbench_confirm_rules',
    description: 'Explicitly confirm an unexpired S3 preview as an immutable rule version and classify the entire current active dataset with the same deterministic classifier.',
    parameters: {
      ...sharedParameters(),
      kind: { type: 'string', const: 'rules.confirm', required: true },
      draftFingerprint: { type: 'string', required: true },
      previewArtifactId: { type: 'string', required: true },
    },
    output: {
      ...outputSchema(),
      render(_args, value) {
        const parsed = RuleToolResultV1Schema.parse(value)
        return [{ type: 'text', text: parsed.message }]
      },
      presentationMeta(args, value) {
        return presentationMeta('tender_workbench_confirm_rules', args, value)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = ConfirmRulesCommandV1Schema.parse(rawArgs)
      validatedFingerprint(args.rules, args.draftFingerprint)
      const previous = currentProjection(dependencies, exec)
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const command = await dependencies.receipts.run(String(agent.session.id), {
        commandId: args.commandId,
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: previous.revision,
        store: transaction,
        revisionOf: result => RuleToolResultV1Schema.parse(result).state.revision,
        execute: async (nextRevision) => {
          assertCurrentDataset(previous, args.activeDatasetRef, args.projectionRevision)
          if (previous.rules?.preview?.id !== args.previewArtifactId
            || previous.rules.previewRevision !== previous.revision
            || previous.rules.draftFingerprint !== args.draftFingerprint
            || previous.rules.activeDatasetId !== args.activeDatasetRef) {
            throw new Error('规则预览已过期；请重新预览当前草案后再确认。')
          }
          exec.signal.throwIfAborted()
          const preview = RulePreviewArtifactV1Schema.parse(await transaction.readJsonArtifact(args.previewArtifactId, 'rule-preview'))
          if (preview.activeDatasetId !== args.activeDatasetRef
            || preview.stateRevision !== previous.revision
            || preview.draftFingerprint !== args.draftFingerprint) {
            throw new Error('规则预览引用的 Artifact、数据快照或 revision 已过期。')
          }
          const dataset = NormalizedDatasetV1Schema.parse(await transaction.readJsonArtifact(args.activeDatasetRef, 'normalized-data'))
          const run = classifyTenderProjects(dataset.rows, args.rules)
          if (!samePreview(preview, run)) throw new Error('规则预览与正式分类的确定性统计不一致。')
          const now = new Date().toISOString()
          const ruleSetVersion = `rsv-${nextRevision}-${args.draftFingerprint.slice(2)}`.slice(0, 128)
          const ruleSetValue = ConfirmedRuleSetV1Schema.parse({
            schemaVersion: 1,
            ruleSetVersion,
            activeDatasetId: args.activeDatasetRef,
            previewArtifactId: args.previewArtifactId,
            confirmedAt: now,
            commandId: args.commandId,
            draftFingerprint: args.draftFingerprint,
            rules: args.rules,
          })
          const classifiedValue = createClassifiedDataset({
            activeDatasetId: args.activeDatasetRef,
            ruleSetVersion,
            classifiedAt: now,
            run,
          })
          const confirmed = await transaction.stageJson('rule-set', `rule-set-${ruleSetVersion}.json`, jsonValue(ruleSetValue))
          const classified = await transaction.stageJson('classified-data', `classified-${ruleSetVersion}.json`, jsonValue(classifiedValue), run.total)
          const {
            activeOperation: _activeOperation,
            lastFailure: _lastFailure,
            analysis: _analysis,
            review: _review,
            report: _report,
            ...base
          } = previous
          const state = TenderWorkflowProjectionV1Schema.parse({
            ...base,
            revision: nextRevision,
            currentStage: 'classification',
            stages: {
              ...base.stages,
              rules: { status: 'succeeded', updatedAt: now },
              classification: { status: 'succeeded', updatedAt: now },
              analysis: { status: 'not-started' },
              review: { status: 'not-started' },
              report: { status: 'not-started' },
            },
            rules: {
              ...base.rules,
              confirmed,
              ruleSetVersion,
              ruleCount: args.rules.length,
              rawMatches: run.rawMatches,
              covered: run.covered,
              conflicts: run.conflicts,
            },
            classification: {
              data: classified,
              include: run.counts.include,
              observe: run.counts.observe,
              exclude: run.counts.exclude,
              manualReview: run.counts.manualReview,
              unmatched: run.counts.unmatched,
              covered: run.covered,
              conflicts: run.conflicts,
              ruleSetVersion,
              activeDatasetId: args.activeDatasetRef,
            },
          })
          return jsonValue(RuleToolResultV1Schema.parse({
            outcome: 'succeeded',
            message: `初筛口径版本 ${ruleSetVersion} 已确认并完成 ${run.total} 个项目的确定性分类。`,
            state,
          })) as ReceiptJsonValue
        },
      })
      return RuleToolResultV1Schema.parse(command.result)
    },
  })
}
