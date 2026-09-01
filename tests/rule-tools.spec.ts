import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConfirmedRuleSetV1Schema,
  ClassifiedDatasetV1Schema,
  RulePreviewArtifactV1Schema,
  ruleDraftFingerprint,
  type ConfirmRulesCommandV1,
  type PreviewRulesCommandV1,
} from '../src/contracts/screening.ts'
import type { TenderWorkflowProjectionV1, TenderRuleV1 } from '../src/contracts/workflow.ts'
import { CommandReceiptCoordinator } from '../src/host/artifacts/command-receipts.ts'
import { readArtifactManifest, readManifestArtifact, sessionArtifactRoot } from '../src/host/artifacts/store.ts'
import { createTenderWorkbenchQueryTool, type QueryToolResultV1 } from '../src/host/tools/query-tool.ts'
import {
  createTenderWorkbenchConfirmRulesTool,
  createTenderWorkbenchPreviewRulesTool,
  type RuleToolResultV1,
} from '../src/host/tools/rule-tools.ts'
import { createTenderWorkbenchScreeningContextTool } from '../src/host/tools/screening-context-tool.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function success(payload: JsonValue): ToolExecutionResult {
  return { isError: false, value: { content: [], structuredContent: payload }, content: [{ type: 'text', text: 'ok' }] }
}

function qccPayload(): JsonValue {
  return {
    查询摘要: { 命中总数: 4, 结果说明: '测试活动数据', 生效筛选: { keywords: ['数据'] } },
    标讯列表: [
      { 标讯ID: 't-1', 标题: '数据治理平台项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-1', 企业名称: '某银行' }], 发布时间: '2026-08-29' },
      { 标讯ID: 't-2', 标题: '数据治理培训项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-2', 企业名称: '某银行' }], 发布时间: '2026-08-30' },
      { 标讯ID: 't-3', 标题: '物业云服务项目', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-3', 企业名称: '某集团' }], 发布时间: '2026-08-31' },
      { 标讯ID: 't-4', 标题: '普通采购项目', 信息类型: '招标公告', 招采单位: [], 发布时间: 'bad-date' },
    ],
  }
}

function rules(): readonly TenderRuleV1[] {
  return [
    { id: 'include-data', name: '数据方向', enabled: true, action: 'include', sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 100, exceptions: ['培训'], reason: '用户目标关注数据项目' },
    { id: 'exclude-property', name: '非目标物业', enabled: true, action: 'exclude', sources: ['tender'], scope: 'title', keywords: ['物业'], priority: 90, exceptions: [], reason: '用户明确排除物业范围' },
    { id: 'observe-cloud', name: '云方向观察', enabled: true, action: 'observe', sources: ['tender'], scope: 'title', keywords: ['云'], priority: 80, exceptions: [], reason: '云方向需要继续观察' },
  ]
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tender-rules-'))
  temporaryRoots.push(root)
  const transcript = join(root, 'session.jsonl')
  await writeFile(transcript, 'transcript-sentinel\n', 'utf8')
  const sessionId = 'session-rules-test' as SessionId
  const session = { id: sessionId, header: { version: 0, id: sessionId, createdAt: 1 } }
  let projection: TenderWorkflowProjectionV1 | null = null
  const persistence = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const receipts = new CommandReceiptCoordinator()
  const sessionProjections = { stateOf: () => projection }
  const query = createTenderWorkbenchQueryTool({
    tools: { execute: vi.fn(async () => success(qccPayload())) } as never,
    sessionProjections: sessionProjections as never,
    sessionPersistence: persistence,
    receipts,
  })
  const dependencies = { sessionProjections: sessionProjections as never, sessionPersistence: persistence, receipts }
  const preview = createTenderWorkbenchPreviewRulesTool(dependencies)
  const confirm = createTenderWorkbenchConfirmRulesTool(dependencies)
  const screeningContext = createTenderWorkbenchScreeningContextTool({
    sessionProjections: sessionProjections as never,
    sessionPersistence: persistence,
  })
  const context = (commandId: string): ToolRunContext => ({
    callId: `call-${commandId}`, rootCallId: `call-${commandId}`, token: Symbol(commandId),
    signal: new AbortController().signal, agent: { id: sessionId, session },
  } as unknown as ToolRunContext)
  const queryResult = await query.execute({
    schemaVersion: 1, commandId: 'query-1', kind: 'query.start', scope: 'tender',
    target: '寻找数据治理项目', tender: { keywords: ['数据'] },
  }, context('query-1')) as QueryToolResultV1
  projection = queryResult.state
  return {
    root, transcript, session, persistence, query, preview, confirm, screeningContext,
    projection: () => projection,
    adopt: (state: TenderWorkflowProjectionV1) => { projection = state },
    context,
    queryResult,
    recreateConfirm: () => createTenderWorkbenchConfirmRulesTool({
      sessionProjections: sessionProjections as never,
      sessionPersistence: persistence,
      receipts: new CommandReceiptCoordinator(),
    }),
  }
}

function previewArgs(test: Awaited<ReturnType<typeof harness>>, commandId = 'preview-1'): PreviewRulesCommandV1 {
  const active = test.projection()?.query?.normalizedData
  if (active === undefined) throw new Error('missing active dataset')
  const draft = rules()
  return {
    schemaVersion: 1, commandId, kind: 'rules.preview', origin: 'user',
    activeDatasetRef: active.id, projectionRevision: test.projection()?.revision ?? 0,
    draftFingerprint: ruleDraftFingerprint(draft), rules: [...draft],
  }
}

describe('S3 rule preview and confirmation tools', () => {
  it('reads bounded drafting context from the current S2 artifacts without re-querying or changing Projection', async () => {
    const test = await harness()
    const active = test.projection()?.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    const before = test.projection()
    const result = await test.screeningContext.execute({
      schemaVersion: 1,
      activeDatasetRef: active.id,
      projectionRevision: before?.revision ?? 0,
    }, test.context('screening-context')) as { readonly context: { readonly total: number; readonly query: { readonly scope: string; readonly tender?: unknown }; readonly samples: readonly unknown[] } }
    expect(result.context).toMatchObject({
      total: 4,
      query: { scope: 'tender', tender: { keywords: ['数据'] } },
      samples: expect.arrayContaining([expect.objectContaining({ source: 'tender', title: '数据治理平台项目' })]),
    })
    expect(result.context.samples.length).toBeLessThanOrEqual(8)
    expect(test.projection()).toBe(before)
    await expect(test.screeningContext.execute({
      schemaVersion: 1, activeDatasetRef: 'old-data', projectionRevision: before?.revision ?? 0,
    }, test.context('stale-context'))).rejects.toThrow('活动数据快照')
  })

  it('previews without a formal version, then confirms immutable rules and classified data with identical statistics', async () => {
    const test = await harness()
    expect(test.queryResult.screeningContext).toMatchObject({ total: 4, targetSummary: '寻找数据治理项目', samples: expect.any(Array) })
    const { draftFingerprint: _clientFingerprint, ...previewInputWithoutFingerprint } = previewArgs(test)
    const previewInput: PreviewRulesCommandV1 = { ...previewInputWithoutFingerprint, origin: 'agent' }
    const preview = await test.preview.execute(previewInput, test.context(previewInput.commandId)) as RuleToolResultV1
    expect(preview.state).toMatchObject({
      revision: 2,
      currentStage: 'rules',
      rules: {
        ruleCount: 3,
        activeDatasetId: previewInput.activeDatasetRef,
        draftFingerprint: ruleDraftFingerprint(previewInput.rules),
      },
    })
    expect(preview.state.rules?.ruleSetVersion).toBeUndefined()
    expect(preview.state.classification).toBeUndefined()
    const root = sessionArtifactRoot(test.persistence, test.session.header)
    let manifest = await readArtifactManifest(root)
    expect(Object.values(manifest.artifacts).filter(entry => entry.kind === 'rule-set')).toHaveLength(0)
    expect(Object.values(manifest.artifacts).filter(entry => entry.kind === 'classified-data')).toHaveLength(0)
    const previewEntry = manifest.artifacts[preview.state.rules?.preview?.id ?? '']
    if (previewEntry === undefined) throw new Error('missing preview artifact')
    const previewArtifact = RulePreviewArtifactV1Schema.parse(JSON.parse((await readManifestArtifact(root, previewEntry)).toString('utf8')) as unknown)
    expect(previewArtifact).toMatchObject({ total: 4, counts: { include: 1, observe: 0, exclude: 1, unmatched: 2 }, conflicts: 1 })
    test.adopt(preview.state)

    const confirmInput: ConfirmRulesCommandV1 = {
      schemaVersion: 1, commandId: 'confirm-1', kind: 'rules.confirm',
      activeDatasetRef: previewInput.activeDatasetRef,
      projectionRevision: preview.state.revision,
      draftFingerprint: ruleDraftFingerprint(previewInput.rules),
      previewArtifactId: preview.state.rules?.preview?.id ?? '',
      rules: previewInput.rules,
    }
    const confirmed = await test.confirm.execute(confirmInput, test.context(confirmInput.commandId)) as RuleToolResultV1
    expect(confirmed.state).toMatchObject({
      revision: 3, currentStage: 'classification',
      rules: { ruleSetVersion: expect.stringMatching(/^rsv-/u), confirmed: { kind: 'rule-set' } },
      classification: { data: { kind: 'classified-data', rowCount: 4 }, include: 1, exclude: 1, unmatched: 2, conflicts: 1 },
    })
    expect(confirmed.state.analysis).toBeUndefined()
    expect(confirmed.state.review).toBeUndefined()
    expect(confirmed.state.report).toBeUndefined()
    manifest = await readArtifactManifest(root)
    const ruleSetEntry = manifest.artifacts[confirmed.state.rules?.confirmed?.id ?? '']
    const classifiedEntry = manifest.artifacts[confirmed.state.classification?.data.id ?? '']
    if (ruleSetEntry === undefined || classifiedEntry === undefined) throw new Error('missing confirmed artifacts')
    const ruleSet = ConfirmedRuleSetV1Schema.parse(JSON.parse((await readManifestArtifact(root, ruleSetEntry)).toString('utf8')) as unknown)
    const classified = ClassifiedDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, classifiedEntry)).toString('utf8')) as unknown)
    expect(ruleSet.rules).toEqual(previewInput.rules)
    expect(ruleSet.activeDatasetId).toBe(previewInput.activeDatasetRef)
    expect(classified.counts).toEqual(previewArtifact.counts)
    expect(classified.ruleImpacts).toEqual(previewArtifact.ruleImpacts)
    expect(await readFile(test.transcript, 'utf8')).toBe('transcript-sentinel\n')
  })

  it('rejects stale data/revision/preview and preserves command idempotency across restart', async () => {
    const test = await harness()
    const previewInput = previewArgs(test)
    const preview = await test.preview.execute(previewInput, test.context(previewInput.commandId)) as RuleToolResultV1
    test.adopt(preview.state)

    const replay = await test.preview.execute(previewInput, test.context(previewInput.commandId)) as RuleToolResultV1
    expect(replay).toEqual(preview)
    const changedRules = [...previewInput.rules, { ...previewInput.rules[0]!, id: 'different' }]
    await expect(test.preview.execute({
      ...previewInput,
      rules: changedRules,
      draftFingerprint: ruleDraftFingerprint(changedRules),
    }, test.context(previewInput.commandId))).rejects.toThrow('different arguments')

    await expect(test.preview.execute({ ...previewInput, commandId: 'stale-revision' }, test.context('stale-revision')))
      .rejects.toThrow('revision')
    await expect(test.preview.execute({ ...previewInput, commandId: 'stale-data', projectionRevision: preview.state.revision, activeDatasetRef: 'old-data' }, test.context('stale-data')))
      .rejects.toThrow('活动数据快照')

    const confirmInput: ConfirmRulesCommandV1 = {
      schemaVersion: 1, commandId: 'confirm-1', kind: 'rules.confirm',
      activeDatasetRef: previewInput.activeDatasetRef, projectionRevision: preview.state.revision,
      draftFingerprint: ruleDraftFingerprint(previewInput.rules),
      previewArtifactId: preview.state.rules?.preview?.id ?? '', rules: previewInput.rules,
    }
    await expect(test.confirm.execute({ ...confirmInput, commandId: 'bad-preview', previewArtifactId: 'a_00000000000000000000000000000000' }, test.context('bad-preview')))
      .rejects.toThrow('预览已过期')
    const confirmed = await test.confirm.execute(confirmInput, test.context(confirmInput.commandId)) as RuleToolResultV1
    test.adopt(confirmed.state)
    expect(await test.confirm.execute(confirmInput, test.context(confirmInput.commandId))).toEqual(confirmed)
    expect(await test.recreateConfirm().execute(confirmInput, test.context(confirmInput.commandId))).toEqual(confirmed)
  })

  it('a successful new query removes old S3 state from the active chain while retaining historical artifacts', async () => {
    const test = await harness()
    const previewInput = previewArgs(test)
    const preview = await test.preview.execute(previewInput, test.context(previewInput.commandId)) as RuleToolResultV1
    test.adopt(preview.state)
    const confirmInput: ConfirmRulesCommandV1 = {
      schemaVersion: 1, commandId: 'confirm-1', kind: 'rules.confirm', activeDatasetRef: previewInput.activeDatasetRef,
      projectionRevision: preview.state.revision, draftFingerprint: ruleDraftFingerprint(previewInput.rules),
      previewArtifactId: preview.state.rules?.preview?.id ?? '', rules: previewInput.rules,
    }
    const confirmed = await test.confirm.execute(confirmInput, test.context(confirmInput.commandId)) as RuleToolResultV1
    test.adopt(confirmed.state)
    const historicalClassificationId = confirmed.state.classification?.data.id
    const next = await test.query.execute({
      schemaVersion: 1, commandId: 'query-2', kind: 'query.start', scope: 'tender',
      target: '新活动查询', tender: { keywords: ['新'] },
    }, test.context('query-2')) as QueryToolResultV1
    expect(next.state.rules).toBeUndefined()
    expect(next.state.classification).toBeUndefined()
    expect(next.state.stages.rules.status).toBe('not-started')
    const manifest = await readArtifactManifest(sessionArtifactRoot(test.persistence, test.session.header))
    expect(manifest.artifacts[historicalClassificationId ?? '']).toBeDefined()
  })

  it('a newly confirmed version on the same dataset becomes active and invalidates S4/S5 dependents while retaining old S3 artifacts', async () => {
    const test = await harness()
    const firstPreviewInput = previewArgs(test)
    const firstPreview = await test.preview.execute(firstPreviewInput, test.context(firstPreviewInput.commandId)) as RuleToolResultV1
    test.adopt(firstPreview.state)
    const firstConfirmInput: ConfirmRulesCommandV1 = {
      schemaVersion: 1, commandId: 'confirm-1', kind: 'rules.confirm', activeDatasetRef: firstPreviewInput.activeDatasetRef,
      projectionRevision: firstPreview.state.revision, draftFingerprint: ruleDraftFingerprint(firstPreviewInput.rules),
      previewArtifactId: firstPreview.state.rules?.preview?.id ?? '', rules: firstPreviewInput.rules,
    }
    const firstConfirmed = await test.confirm.execute(firstConfirmInput, test.context(firstConfirmInput.commandId)) as RuleToolResultV1
    const oldRuleSet = firstConfirmed.state.rules?.confirmed?.id
    const oldClassification = firstConfirmed.state.classification?.data.id
    const fakeArtifact = (kind: 'analysis-data' | 'review-data' | 'final-snapshot', id: string) => ({
      id, kind, fileName: `${id}.json`, mediaType: 'application/json', createdAt: '2026-09-01T00:00:00.000Z', accessToken: `${id}-token`,
    })
    test.adopt({
      ...firstConfirmed.state,
      analysis: { version: 'analysis-old', data: fakeArtifact('analysis-data', 'analysis-old'), total: 4, completed: 4, priorityReview: 1, watch: 2, notRecommended: 1 },
      review: { revision: 1, data: fakeArtifact('review-data', 'review-old'), pending: 1, final: 1, observe: 1, exclude: 1, canRevert: true },
      report: { finalSnapshot: fakeArtifact('final-snapshot', 'snapshot-old'), excel: { status: 'not-started' }, pdf: { status: 'not-started' } },
    })
    const changedRules = firstPreviewInput.rules.map(rule => rule.id === 'observe-cloud' ? { ...rule, priority: 120 } : rule)
    const secondPreviewInput: PreviewRulesCommandV1 = {
      ...firstPreviewInput,
      commandId: 'preview-2',
      projectionRevision: firstConfirmed.state.revision,
      draftFingerprint: ruleDraftFingerprint(changedRules),
      rules: changedRules,
    }
    const secondPreview = await test.preview.execute(secondPreviewInput, test.context(secondPreviewInput.commandId)) as RuleToolResultV1
    expect(secondPreview.state.classification?.data.id).toBe(oldClassification)
    expect(secondPreview.state.analysis?.version).toBe('analysis-old')
    test.adopt(secondPreview.state)
    const secondConfirmInput: ConfirmRulesCommandV1 = {
      schemaVersion: 1, commandId: 'confirm-2', kind: 'rules.confirm', activeDatasetRef: secondPreviewInput.activeDatasetRef,
      projectionRevision: secondPreview.state.revision, draftFingerprint: ruleDraftFingerprint(secondPreviewInput.rules),
      previewArtifactId: secondPreview.state.rules?.preview?.id ?? '', rules: secondPreviewInput.rules,
    }
    const secondConfirmed = await test.confirm.execute(secondConfirmInput, test.context(secondConfirmInput.commandId)) as RuleToolResultV1
    expect(secondConfirmed.state.rules?.ruleSetVersion).not.toBe(firstConfirmed.state.rules?.ruleSetVersion)
    expect(secondConfirmed.state.rules?.confirmed?.id).not.toBe(oldRuleSet)
    expect(secondConfirmed.state.classification?.data.id).not.toBe(oldClassification)
    expect(secondConfirmed.state.analysis).toBeUndefined()
    expect(secondConfirmed.state.review).toBeUndefined()
    expect(secondConfirmed.state.report).toBeUndefined()
    const manifest = await readArtifactManifest(sessionArtifactRoot(test.persistence, test.session.header))
    expect(manifest.artifacts[oldRuleSet ?? '']).toBeDefined()
    expect(manifest.artifacts[oldClassification ?? '']).toBeDefined()
  })
})
