import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClassifiedDatasetV1Schema,
  ConfirmedRuleSetV1Schema,
  ruleDraftFingerprint,
} from '../src/contracts/screening.ts'
import type {
  ConfirmRulesToolInputV2,
  PreviewRulesToolInputV2,
} from '../src/contracts/tool-inputs.ts'
import type { TenderRuleV1, TenderWorkflowProjectionV2 } from '../src/contracts/workflow.ts'
import { IntentReceiptCoordinator } from '../src/host/artifacts/intent-receipts.ts'
import { readArtifactManifest, readManifestArtifact, sessionArtifactRoot } from '../src/host/artifacts/store.ts'
import { createTenderWorkbenchQueryTool, type QueryToolResultV2 } from '../src/host/tools/query-tool.ts'
import {
  createTenderWorkbenchConfirmRulesTool,
  createTenderWorkbenchPreviewRulesTool,
  type ConfirmRulesResultV2,
  type PreviewRulesResultV2,
} from '../src/host/tools/rule-tools.ts'
import { createTenderWorkbenchRuleDraftingContextTool, type RuleDraftingContextResultV2 } from '../src/host/tools/screening-context-tool.ts'

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
  const events: unknown[] = []
  const session = { id: sessionId, header: { version: 0, id: sessionId, createdAt: 1 }, events }
  let projection: TenderWorkflowProjectionV2 | null = null
  const persistence = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const receipts = new IntentReceiptCoordinator()
  const sessionProjections = { stateOf: () => projection }
  const dependencies = { sessionProjections: sessionProjections as never, sessionPersistence: persistence, receipts }
  const query = createTenderWorkbenchQueryTool({
    tools: { execute: vi.fn(async () => success(qccPayload())) } as never,
    ...dependencies,
  })
  const preview = createTenderWorkbenchPreviewRulesTool(dependencies)
  const confirm = createTenderWorkbenchConfirmRulesTool(dependencies)
  const drafting = createTenderWorkbenchRuleDraftingContextTool(dependencies)
  const setUser = (seq: number, text: string) => {
    events.splice(0, events.length, {
      type: 'user/message', seq, time: seq,
      data: { turn: seq, source: { kind: 'user' }, content: [{ type: 'text', text }] },
    })
  }
  const context = (label: string): ToolRunContext => ({
    callId: `call-${label}`, rootCallId: `call-${label}`, token: Symbol(label),
    signal: new AbortController().signal, agent: { id: sessionId, session },
  } as unknown as ToolRunContext)
  setUser(1, '查询数据项目')
  const queryResult = await query.execute({
    schemaVersion: 2, origin: { kind: 'conversation' }, projectionRevision: 0,
    scope: 'tender', target: '寻找数据治理项目', tender: { keywords: ['数据'] },
  }, context('query')) as QueryToolResultV2
  projection = queryResult.state
  return {
    root, session, persistence, preview, confirm, drafting, context, setUser,
    projection: () => projection,
    adopt: (state: TenderWorkflowProjectionV2) => { projection = state },
  }
}

describe('S5.6 rule context, preview, and confirmation', () => {
  it('binds an Agent proposal to the current bounded context fingerprint', async () => {
    const test = await harness()
    const active = test.projection()?.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    test.setUser(2, '生成初筛规则')
    const contextInput = {
      schemaVersion: 2 as const,
      origin: { kind: 'conversation' as const },
      activeDatasetRef: active.id,
      projectionRevision: test.projection()?.revision ?? 0,
    }
    const drafting = await test.drafting.execute(contextInput, test.context('drafting')) as RuleDraftingContextResultV2
    expect(drafting.context).toMatchObject({ total: 4, contextFingerprint: expect.stringMatching(/^sc_/u) })
    expect(drafting.context.samples).toHaveLength(4)
    expect(drafting.control).toEqual({ status: 'continue', nextTool: 'tender_workbench_preview_rules' })

    const previewInput: PreviewRulesToolInputV2 = {
      ...contextInput,
      mode: { kind: 'agent-proposal', contextFingerprint: drafting.context.contextFingerprint },
      rules: [...rules()],
    }
    const preview = await test.preview.execute(previewInput, test.context('preview')) as PreviewRulesResultV2
    expect(preview).toMatchObject({
      schemaVersion: 2, tool: 'tender_workbench_preview_rules',
      result: { total: 4, draftFingerprint: ruleDraftFingerprint(rules()) },
      state: { revision: 2, currentStage: 'rules' },
      control: { status: 'complete' },
    })
    await expect(test.preview.execute({
      ...previewInput,
      origin: { kind: 'conversation' },
      mode: { kind: 'agent-proposal', contextFingerprint: 'sc_stale' },
    }, test.context('stale'))).rejects.toThrow(/different arguments|上下文/u)
  })

  it('confirms by reloading the preview and draft Artifacts without accepting rules', async () => {
    const test = await harness()
    const active = test.projection()?.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    test.setUser(2, '保存规则并预览')
    const draft = [...rules()]
    const previewInput: PreviewRulesToolInputV2 = {
      schemaVersion: 2,
      origin: { kind: 'conversation' },
      activeDatasetRef: active.id,
      projectionRevision: 1,
      mode: { kind: 'user-dry-run', draftFingerprint: ruleDraftFingerprint(draft) },
      rules: draft,
    }
    const preview = await test.preview.execute(previewInput, test.context('preview')) as PreviewRulesResultV2
    test.adopt(preview.state)
    test.setUser(3, '确认口径并分类')
    const confirmInput: ConfirmRulesToolInputV2 = {
      schemaVersion: 2,
      origin: { kind: 'conversation' },
      activeDatasetRef: active.id,
      projectionRevision: preview.state.revision,
      previewArtifactRef: preview.result.previewArtifactRef,
      draftFingerprint: preview.result.draftFingerprint,
    }
    const confirmed = await test.confirm.execute(confirmInput, test.context('confirm')) as ConfirmRulesResultV2
    expect(confirmed).toMatchObject({
      tool: 'tender_workbench_confirm_rules',
      state: {
        revision: 3, currentStage: 'classification',
        classification: { include: 1, exclude: 1, unmatched: 2, conflicts: 1 },
      },
      control: { status: 'complete' },
    })
    const artifactRoot = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(artifactRoot)
    const ruleSetEntry = manifest.artifacts[confirmed.state.rules?.confirmed?.id ?? '']
    const classifiedEntry = manifest.artifacts[confirmed.state.classification?.data.id ?? '']
    if (ruleSetEntry === undefined || classifiedEntry === undefined) throw new Error('missing rule artifacts')
    const ruleSet = ConfirmedRuleSetV1Schema.parse(
      JSON.parse((await readManifestArtifact(artifactRoot, ruleSetEntry)).toString('utf8')),
    )
    const classified = ClassifiedDatasetV1Schema.parse(
      JSON.parse((await readManifestArtifact(artifactRoot, classifiedEntry)).toString('utf8')),
    )
    expect(ruleSet.intentId).toBe(confirmed.intentId)
    expect(ruleSet.rules).toEqual(draft)
    expect(classified.counts).toEqual(confirmed.result.counts)
  })

  it('rejects a client fingerprint mismatch and an expired confirmation', async () => {
    const test = await harness()
    const active = test.projection()?.query?.normalizedData
    if (active === undefined) throw new Error('missing active dataset')
    test.setUser(2, '预览规则')
    const input: PreviewRulesToolInputV2 = {
      schemaVersion: 2, origin: { kind: 'conversation' }, activeDatasetRef: active.id,
      projectionRevision: 1, mode: { kind: 'user-dry-run', draftFingerprint: 'r_wrong' }, rules: [...rules()],
    }
    await expect(test.preview.execute(input, test.context('bad-fingerprint'))).rejects.toThrow('指纹')
    await expect(test.confirm.execute({
      schemaVersion: 2, origin: { kind: 'conversation' }, activeDatasetRef: active.id,
      projectionRevision: 1, previewArtifactRef: 'missing-preview', draftFingerprint: ruleDraftFingerprint(rules()),
    }, test.context('expired'))).rejects.toThrow('预览已过期')
  })
})
