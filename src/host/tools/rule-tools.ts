import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { NormalizedDatasetV1Schema } from '../../contracts/dataset.ts'
import {
  ConfirmedRuleSetV1Schema,
  RuleDraftArtifactV1Schema,
  RulePreviewArtifactV1Schema,
  ScreeningDraftContextV1Schema,
  ruleDraftFingerprint,
} from '../../contracts/screening.ts'
import {
  ConfirmRulesToolInputV2Schema,
  PreviewRulesToolInputV2Schema,
  RunQueryToolInputV2Schema,
  type PreviewRulesToolInputV2,
} from '../../contracts/tool-inputs.ts'
import { renderTenderToolResult } from '../../contracts/tool-results.ts'
import {
  ArtifactRefV1Schema,
  TenderWorkflowProjectionV2Schema,
  createEmptyTenderWorkflowProjection,
  type TenderWorkflowProjectionV2,
} from '../../contracts/workflow.ts'
import {
  IntentReceiptCoordinator,
  type JsonValue as ReceiptJsonValue,
} from '../artifacts/intent-receipts.ts'
import {
  createArtifactTransaction,
  type ArtifactTransaction,
  type SessionPersistenceLocator,
} from '../artifacts/store.ts'
import {
  classifyTenderProjects,
  createClassifiedDataset,
  createRulePreviewArtifact,
} from '../pipeline/classify.ts'
import { createScreeningDraftContext } from '../pipeline/screening-context.ts'
import { resolveToolInvocation, toolOriginParameter } from '../tool-contract.ts'

const PreviewRulesResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_preview_rules'),
  intentId: z.string().min(1).max(128),
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  result: z.object({
    draftFingerprint: z.string().min(1).max(128),
    draftArtifactRef: z.string().min(1).max(128),
    previewArtifactRef: z.string().min(1).max(128),
    counts: RulePreviewArtifactV1Schema.shape.counts,
    total: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    rawMatches: z.number().int().nonnegative(),
    ruleImpacts: RulePreviewArtifactV1Schema.shape.ruleImpacts,
  }).strict(),
  state: TenderWorkflowProjectionV2Schema,
  control: z.object({ status: z.literal('complete') }).strict(),
}).strict()

const ConfirmRulesResultV2Schema = z.object({
  domain: z.literal('dsh-tender-workbench'),
  schemaVersion: z.literal(2),
  tool: z.literal('tender_workbench_confirm_rules'),
  intentId: z.string().min(1).max(128),
  outcome: z.literal('succeeded'),
  message: z.string().min(1).max(512),
  result: z.object({
    ruleSetVersion: z.string().min(1).max(128),
    classificationArtifactRef: z.string().min(1).max(128),
    counts: RulePreviewArtifactV1Schema.shape.counts,
    total: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }).strict(),
  state: TenderWorkflowProjectionV2Schema,
  control: z.object({ status: z.literal('complete') }).strict(),
}).strict()

export type PreviewRulesResultV2 = z.infer<typeof PreviewRulesResultV2Schema>
export type ConfirmRulesResultV2 = z.infer<typeof ConfirmRulesResultV2Schema>

export interface RuleToolDependencies {
  readonly sessionProjections: Pick<SessionProjectionRegistry, 'stateOf'>
  readonly sessionPersistence: SessionPersistenceLocator
  readonly receipts: IntentReceiptCoordinator
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

function currentProjection(dependencies: RuleToolDependencies, exec: ToolRunContext): TenderWorkflowProjectionV2 {
  const agent = requireAgent(exec)
  return dependencies.sessionProjections.stateOf(agent.session, 'dshTenderWorkflow')
    ?? createEmptyTenderWorkflowProjection()
}

function assertCurrentDataset(
  state: TenderWorkflowProjectionV2,
  activeDatasetRef: string,
  projectionRevision: number,
): void {
  if (state.query?.normalizedData?.id !== activeDatasetRef) {
    throw new Error('活动数据快照已变化；请基于当前 activeDatasetRef 重新生成初筛口径。')
  }
  if (state.revision !== projectionRevision) {
    throw new Error('Projection revision 已变化；旧草案或预览不能继续使用。')
  }
}

function ruleParameter() {
  const textArray = { type: 'array' as const, items: { type: 'string' as const }, required: true as const }
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
      keywords: textArray,
      priority: { type: 'integer' as const, required: true as const },
      exceptions: textArray,
      reason: { type: 'string' as const, required: true as const },
    },
  }
}

function previewModeParameter() {
  return {
    oneOf: [
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, const: 'agent-proposal' as const, required: true as const },
          contextFingerprint: { type: 'string' as const, required: true as const },
        },
      },
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, const: 'agent-adjustment' as const, required: true as const },
          baseDraftFingerprint: { type: 'string' as const, required: true as const },
        },
      },
      {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: { type: 'string' as const, const: 'user-dry-run' as const, required: true as const },
          draftFingerprint: { type: 'string' as const, required: true as const },
        },
      },
    ],
  } as const
}

function mutationMeta(
  tool: 'tender_workbench_preview_rules' | 'tender_workbench_confirm_rules',
  origin: PreviewRulesToolInputV2['origin']['kind'],
  previousRevision: number,
  intentId: string,
  state: TenderWorkflowProjectionV2,
): JsonValue {
  return jsonValue({
    domain: 'dsh-tender-workbench', schemaVersion: 2, tool, intentId, origin,
    effect: 'mutation', previousRevision, state, control: { status: 'complete' },
  })
}

function previewState(input: {
  readonly previous: TenderWorkflowProjectionV2
  readonly nextRevision: number
  readonly now: string
  readonly args: PreviewRulesToolInputV2
  readonly draftFingerprint: string
  readonly draft: z.infer<typeof ArtifactRefV1Schema>
  readonly preview: z.infer<typeof ArtifactRefV1Schema>
  readonly artifact: z.infer<typeof RulePreviewArtifactV1Schema>
}): TenderWorkflowProjectionV2 {
  const { activeOperation: _activeOperation, lastFailure: _lastFailure, ...base } = input.previous
  return TenderWorkflowProjectionV2Schema.parse({
    ...base,
    revision: input.nextRevision,
    currentStage: 'rules',
    stages: { ...base.stages, rules: { status: 'succeeded', updatedAt: input.now } },
    rules: {
      ...base.rules,
      draft: input.draft,
      draftOrigin: input.args.mode.kind === 'user-dry-run' ? 'user' : 'agent',
      draftFingerprint: input.draftFingerprint,
      preview: input.preview,
      previewRevision: input.nextRevision,
      activeDatasetId: input.args.activeDatasetRef,
      ruleCount: input.args.rules.length,
      rawMatches: input.artifact.rawMatches,
      covered: input.artifact.covered,
      conflicts: input.artifact.conflicts,
    },
  })
}

async function validatePreviewMode(
  transaction: ArtifactTransaction,
  previous: TenderWorkflowProjectionV2,
  args: PreviewRulesToolInputV2,
  dataset: z.infer<typeof NormalizedDatasetV1Schema>,
): Promise<{ readonly draftFingerprint: string; readonly origin: 'agent' | 'user' }> {
  const draftFingerprint = ruleDraftFingerprint(args.rules)
  if (args.mode.kind === 'user-dry-run') {
    if (draftFingerprint !== args.mode.draftFingerprint) throw new Error('规则草案指纹与完整规则内容不匹配。')
    return { draftFingerprint, origin: 'user' }
  }
  if (args.mode.kind === 'agent-adjustment') {
    if (previous.rules?.draft?.id === undefined || previous.rules.draftFingerprint !== args.mode.baseDraftFingerprint) {
      throw new Error('规则调整所绑定的基础草案已变化。')
    }
    const baseDraft = RuleDraftArtifactV1Schema.parse(
      await transaction.readJsonArtifact(previous.rules.draft.id, 'rule-draft'),
    )
    if (baseDraft.draftFingerprint !== args.mode.baseDraftFingerprint
      || baseDraft.activeDatasetId !== args.activeDatasetRef) {
      throw new Error('规则调整所绑定的基础草案 Artifact 已失效。')
    }
    return { draftFingerprint, origin: 'agent' }
  }
  const query = previous.query
  if (query?.querySpec === undefined) throw new Error('当前 Session 缺少规则起草所需的查询范围。')
  const queryIntent = RunQueryToolInputV2Schema.parse(
    await transaction.readJsonArtifact(query.querySpec.id, 'query-spec'),
  )
  const context = ScreeningDraftContextV1Schema.parse(createScreeningDraftContext({
    activeDatasetRef: args.activeDatasetRef,
    projectionRevision: previous.revision,
    intent: queryIntent,
    dataset,
  }))
  if (context.contextFingerprint !== args.mode.contextFingerprint) {
    throw new Error('规则提议上下文已变化；请重新读取起草上下文。')
  }
  return { draftFingerprint, origin: 'agent' }
}

function samePreview(
  preview: z.infer<typeof RulePreviewArtifactV1Schema>,
  run: ReturnType<typeof classifyTenderProjects>,
): boolean {
  return JSON.stringify({
    counts: preview.counts, total: preview.total, covered: preview.covered,
    conflicts: preview.conflicts, rawMatches: preview.rawMatches, ruleImpacts: preview.ruleImpacts,
  }) === JSON.stringify({
    counts: run.counts, total: run.total, covered: run.covered,
    conflicts: run.conflicts, rawMatches: run.rawMatches, ruleImpacts: run.ruleImpacts,
  })
}

export function createTenderWorkbenchPreviewRulesTool(dependencies: RuleToolDependencies) {
  return defineTool({
    name: 'tender_workbench_preview_rules',
    description: 'Save one complete screening-rule draft and run a deterministic Dry Run against the current active dataset.',
    parameters: {
      schemaVersion: { type: 'integer', const: 2, required: true },
      origin: { ...toolOriginParameter({ autonomous: false }), required: true },
      activeDatasetRef: { type: 'string', required: true },
      projectionRevision: { type: 'integer', required: true },
      mode: { ...previewModeParameter(), required: true },
      rules: { type: 'array', items: ruleParameter(), required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_preview_rules', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', const: 'succeeded', required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(PreviewRulesResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = PreviewRulesToolInputV2Schema.parse(args)
        const parsed = PreviewRulesResultV2Schema.parse(value)
        return mutationMeta('tender_workbench_preview_rules', input.origin.kind, input.projectionRevision, parsed.intentId, parsed.state)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = PreviewRulesToolInputV2Schema.parse(rawArgs)
      const previous = currentProjection(dependencies, exec)
      const intentKind = args.mode.kind === 'agent-proposal'
        ? 'rules.propose'
        : args.mode.kind === 'agent-adjustment' ? 'rules.adjust' : 'rules.preview'
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previous,
        tool: 'tender_workbench_preview_rules', intentKind, mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('规则预览动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_preview_rules',
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => PreviewRulesResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          assertCurrentDataset(previous, args.activeDatasetRef, args.projectionRevision)
          const dataset = NormalizedDatasetV1Schema.parse(
            await transaction.readJsonArtifact(args.activeDatasetRef, 'normalized-data'),
          )
          const validated = await validatePreviewMode(transaction, previous, args, dataset)
          exec.signal.throwIfAborted()
          const run = classifyTenderProjects(dataset.rows, args.rules)
          const previewValue = createRulePreviewArtifact({
            activeDatasetId: args.activeDatasetRef,
            basedOnRevision: previous.revision,
            stateRevision: nextRevision,
            draftFingerprint: validated.draftFingerprint,
            origin: validated.origin,
            run,
          })
          const draftValue = RuleDraftArtifactV1Schema.parse({
            schemaVersion: 1,
            activeDatasetId: args.activeDatasetRef,
            basedOnRevision: previous.revision,
            draftFingerprint: validated.draftFingerprint,
            origin: validated.origin,
            rules: args.rules,
          })
          const draft = await transaction.stageJson('rule-draft', `rule-draft-${intentId}.json`, jsonValue(draftValue))
          const preview = await transaction.stageJson('rule-preview', `rule-preview-${intentId}.json`, jsonValue(previewValue))
          const now = new Date().toISOString()
          const state = previewState({
            previous, nextRevision, now, args,
            draftFingerprint: validated.draftFingerprint, draft, preview, artifact: previewValue,
          })
          return jsonValue(PreviewRulesResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_preview_rules', intentId, outcome: 'succeeded',
            message: `初筛口径预览完成：覆盖 ${run.covered}/${run.total} 个项目，发现 ${run.conflicts} 个跨动作冲突。`,
            result: {
              draftFingerprint: validated.draftFingerprint,
              draftArtifactRef: draft.id,
              previewArtifactRef: preview.id,
              counts: run.counts,
              total: run.total,
              covered: run.covered,
              conflicts: run.conflicts,
              rawMatches: run.rawMatches,
              ruleImpacts: run.ruleImpacts,
            },
            state,
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return PreviewRulesResultV2Schema.parse(receipt.result)
    },
  })
}

export function createTenderWorkbenchConfirmRulesTool(dependencies: RuleToolDependencies) {
  return defineTool({
    name: 'tender_workbench_confirm_rules',
    description: 'Confirm the current unexpired Dry Run, reload its rule draft, and classify the full active dataset deterministically.',
    parameters: {
      schemaVersion: { type: 'integer', const: 2, required: true },
      origin: { ...toolOriginParameter({ autonomous: false }), required: true },
      activeDatasetRef: { type: 'string', required: true },
      projectionRevision: { type: 'integer', required: true },
      previewArtifactRef: { type: 'string', required: true },
      draftFingerprint: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', const: 'dsh-tender-workbench', required: true },
          schemaVersion: { type: 'integer', const: 2, required: true },
          tool: { type: 'string', const: 'tender_workbench_confirm_rules', required: true },
          intentId: { type: 'string', required: true },
          outcome: { type: 'string', const: 'succeeded', required: true },
          message: { type: 'string', required: true },
          result: { type: 'json', required: true },
          state: { type: 'json', required: true },
          control: { type: 'json', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderTenderToolResult(ConfirmRulesResultV2Schema.parse(value)) }]
      },
      presentationMeta(args, value) {
        const input = ConfirmRulesToolInputV2Schema.parse(args)
        const parsed = ConfirmRulesResultV2Schema.parse(value)
        return mutationMeta('tender_workbench_confirm_rules', input.origin.kind, input.projectionRevision, parsed.intentId, parsed.state)
      },
    },
    async execute(rawArgs, exec) {
      const agent = requireAgent(exec)
      const args = ConfirmRulesToolInputV2Schema.parse(rawArgs)
      const previous = currentProjection(dependencies, exec)
      const invocation = resolveToolInvocation({
        rawOrigin: args.origin, rawArgs: args, exec, state: previous,
        tool: 'tender_workbench_confirm_rules', intentKind: 'rules.confirm', mutation: true,
      })
      if (invocation.intentId === undefined) throw new Error('规则确认动作缺少 intentId。')
      const intentId = invocation.intentId
      const transaction = createArtifactTransaction(dependencies.sessionPersistence, agent.session.header)
      const receipt = await dependencies.receipts.run(String(agent.session.id), {
        intentId,
        tool: 'tender_workbench_confirm_rules',
        arguments: jsonValue(args) as ReceiptJsonValue,
        observedProjectionRevision: args.projectionRevision,
        store: transaction,
        revisionOf: value => ConfirmRulesResultV2Schema.parse(value).state.revision,
        execute: async (nextRevision) => {
          assertCurrentDataset(previous, args.activeDatasetRef, args.projectionRevision)
          if (previous.rules?.preview?.id !== args.previewArtifactRef
            || previous.rules.previewRevision !== previous.revision
            || previous.rules.draftFingerprint !== args.draftFingerprint
            || previous.rules.activeDatasetId !== args.activeDatasetRef
            || previous.rules.draft === undefined) {
            throw new Error('规则预览已过期；请重新预览当前草案后再确认。')
          }
          const preview = RulePreviewArtifactV1Schema.parse(
            await transaction.readJsonArtifact(args.previewArtifactRef, 'rule-preview'),
          )
          const draft = RuleDraftArtifactV1Schema.parse(
            await transaction.readJsonArtifact(previous.rules.draft.id, 'rule-draft'),
          )
          if (preview.activeDatasetId !== args.activeDatasetRef
            || preview.stateRevision !== previous.revision
            || preview.draftFingerprint !== args.draftFingerprint
            || draft.activeDatasetId !== args.activeDatasetRef
            || draft.draftFingerprint !== args.draftFingerprint) {
            throw new Error('规则预览或草案 Artifact 与当前数据绑定不一致。')
          }
          const dataset = NormalizedDatasetV1Schema.parse(
            await transaction.readJsonArtifact(args.activeDatasetRef, 'normalized-data'),
          )
          const run = classifyTenderProjects(dataset.rows, draft.rules)
          if (!samePreview(preview, run)) throw new Error('规则预览与正式分类的确定性统计不一致。')
          exec.signal.throwIfAborted()
          const now = new Date().toISOString()
          const ruleSetVersion = `rsv-${nextRevision}-${args.draftFingerprint.slice(2)}`.slice(0, 128)
          const ruleSetValue = ConfirmedRuleSetV1Schema.parse({
            schemaVersion: 1,
            ruleSetVersion,
            activeDatasetId: args.activeDatasetRef,
            previewArtifactId: args.previewArtifactRef,
            confirmedAt: now,
            intentId,
            draftFingerprint: args.draftFingerprint,
            rules: draft.rules,
          })
          const classifiedValue = createClassifiedDataset({
            activeDatasetId: args.activeDatasetRef, ruleSetVersion, classifiedAt: now, run,
          })
          const confirmed = await transaction.stageJson('rule-set', `rule-set-${ruleSetVersion}.json`, jsonValue(ruleSetValue))
          const classified = await transaction.stageJson('classified-data', `classified-${ruleSetVersion}.json`, jsonValue(classifiedValue), run.total)
          const {
            activeOperation: _activeOperation, lastFailure: _lastFailure,
            analysis: _analysis, review: _review, report: _report, ...base
          } = previous
          const state = TenderWorkflowProjectionV2Schema.parse({
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
              ruleCount: draft.rules.length,
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
          return jsonValue(ConfirmRulesResultV2Schema.parse({
            domain: 'dsh-tender-workbench', schemaVersion: 2,
            tool: 'tender_workbench_confirm_rules', intentId, outcome: 'succeeded',
            message: `初筛口径版本 ${ruleSetVersion} 已确认并完成 ${run.total} 个项目的确定性分类。`,
            result: {
              ruleSetVersion,
              classificationArtifactRef: classified.id,
              counts: run.counts,
              total: run.total,
              covered: run.covered,
              conflicts: run.conflicts,
            },
            state,
            control: { status: 'complete' },
          })) as ReceiptJsonValue
        },
      })
      return ConfirmRulesResultV2Schema.parse(receipt.result)
    },
  })
}
