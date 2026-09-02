import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NormalizedDatasetV1Schema } from '../src/contracts/dataset.ts'
import type { TenderQueryIntentV1 } from '../src/contracts/query-schema.ts'
import type { TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
import { CommandReceiptCoordinator } from '../src/host/artifacts/command-receipts.ts'
import {
  readArtifactManifest,
  readManifestArtifact,
  sessionArtifactRoot,
} from '../src/host/artifacts/store.ts'
import {
  createTenderWorkbenchQueryTool,
  extractMcpCanonicalPayload,
  type QueryToolResultV1,
} from '../src/host/tools/query-tool.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function summary(total: number) {
  return { 命中总数: total, 结果说明: '实际加载', 生效筛选: {} }
}

function tenderPayload(ids: readonly string[]) {
  return {
    查询摘要: summary(ids.length),
    标讯列表: ids.map(id => ({
      标讯ID: id, 标题: `项目 ${id}`, 信息类型: '招标公告', 公告子状态: '招标', 省市区: '江苏省',
      招采单位: [{ 企业ID: 'e-1', 企业名称: '采购单位' }], 项目编号: '', '预算金额（元）': '1000000',
      发布时间: '2026-08-29', 投标截止时间: '2026-09-20',
    })),
  }
}

function proposedPayload(ids: readonly string[]) {
  return {
    查询摘要: summary(ids.length),
    拟建项目列表: ids.map(id => ({
      拟建项目ID: id, 项目名称: `拟建 ${id}`, 项目阶段: '项目备案', 审批进度: '审批中', 省市区: '浙江省',
      '项目总投资（元）': '50000000', 发布时间: '2026-08-27', 建设单位: [], 项目编号: '',
    })),
  }
}

function success(payload: JsonValue): ToolExecutionResult {
  return {
    isError: false,
    value: { content: [], structuredContent: payload },
    content: [{ type: 'text', text: 'ok' }],
  }
}

function failure(message: string): ToolExecutionResult {
  return {
    isError: true,
    error: { message, info: { name: 'Error', code: 'SOURCE_FAILED' } },
    content: [{ type: 'text', text: message }],
  }
}

function combinedIntent(commandId: string): TenderQueryIntentV1 {
  return {
    schemaVersion: 1,
    commandId,
    kind: 'query.start',
    scope: 'combined',
    target: '测试活动快照替换',
    tender: { keywords: ['数据'] },
    proposed: { keywords: ['数据'] },
  }
}

async function harness(execute: (name: string) => Promise<ToolExecutionResult>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tender-query-'))
  temporaryRoots.push(root)
  const transcript = join(root, 'session.jsonl')
  await writeFile(transcript, 'transcript-sentinel\n', 'utf8')
  const sessionId = 'session-query-test' as SessionId
  const header = { version: 0, id: sessionId, createdAt: 1 }
  const session = { id: sessionId, header }
  let projection: TenderWorkflowProjectionV1 | null = null
  const tools = { execute: vi.fn((input: { readonly name: string }) => execute(input.name)) }
  const persistence = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const tool = createTenderWorkbenchQueryTool({
    tools: tools as never,
    sessionProjections: { stateOf: () => projection } as never,
    sessionPersistence: persistence,
    receipts: new CommandReceiptCoordinator(),
  })
  const run = async (intent: TenderQueryIntentV1, signal = new AbortController().signal): Promise<QueryToolResultV1> => {
    const result = await tool.execute(intent, {
      callId: `outer-${intent.commandId}`,
      rootCallId: `outer-${intent.commandId}`,
      token: Symbol(intent.commandId),
      signal,
      agent: { id: sessionId, session },
    } as unknown as ToolRunContext)
    return result as QueryToolResultV1
  }
  return {
    root,
    transcript,
    session,
    tools,
    persistence,
    tool,
    run,
    projection: () => projection,
    adopt: (next: TenderWorkflowProjectionV1) => { projection = next },
  }
}

describe('tender_workbench_query', () => {
  it('calls both exact qcc tools, creates one active snapshot, and keeps commandId retries idempotent', async () => {
    let tender = tenderPayload(['t-1', 't-2']) as JsonValue
    let proposed = proposedPayload(['p-1']) as JsonValue
    const test = await harness(async name => name.endsWith('search_tenders') ? success(tender) : success(proposed))
    const first = await test.run(combinedIntent('command-1'))
    expect(first.outcome).toBe('succeeded')
    expect(first.state).toMatchObject({ revision: 1, currentStage: 'overview', query: { total: 3 } })
    expect(test.tool.output.presentationMeta?.(combinedIntent('command-1'), first as unknown as JsonValue)).toMatchObject({
      domain: 'dsh-tender-workbench', commandId: 'command-1', command: 'tender_workbench_query', state: { revision: 1 },
    })
    expect(JSON.stringify(test.tool.output.render(combinedIntent('command-1'), first as unknown as JsonValue)))
      .not.toContain(first.state.query?.normalizedData?.accessToken)
    expect(test.tools.execute.mock.calls.map(call => call[0].name)).toEqual([
      'mcp__qcc-tender__search_tenders',
      'mcp__qcc-tender__search_proposed_projects',
    ])
    expect(test.tools.execute.mock.calls[0]?.[0]).toMatchObject({
      rootCallId: 'outer-command-1', parent: expect.any(Symbol), agent: expect.any(Object), arguments: { keywords: ['数据'] },
    })
    test.adopt(first.state)

    const replay = await test.run(combinedIntent('command-1'))
    expect(replay).toEqual(first)
    expect(test.tools.execute).toHaveBeenCalledTimes(2)

    const createdAt = '2026-09-01T00:00:00.000Z'
    const artifact = (kind: 'rule-set' | 'classified-data' | 'analysis-data' | 'review-data' | 'final-snapshot', id: string) => ({
      id, kind, fileName: `${id}.json`, mediaType: 'application/json', createdAt, accessToken: `${id}-token`,
    })
    test.adopt({
      ...first.state,
      rules: { confirmed: artifact('rule-set', 'old-rules'), ruleSetVersion: 'v1', ruleCount: 1, rawMatches: 1, conflicts: 0 },
      classification: {
        data: artifact('classified-data', 'old-classification'),
        include: 1, observe: 0, exclude: 0, manualReview: 0, unmatched: 0,
        covered: 1, conflicts: 0, ruleSetVersion: 'v1', activeDatasetId: first.state.query?.normalizedData?.id ?? 'old-data',
      },
      analysis: { version: 'a1', activeDatasetId: first.state.query?.normalizedData?.id ?? 'old-data', data: artifact('analysis-data', 'old-analysis'), total: 1, completed: 1, priorityReview: 1, watch: 0, notRecommended: 0 },
      review: { revision: 1, data: artifact('review-data', 'old-review'), pending: 0, confirmedCandidate: 1, watch: 0, exclude: 0, canRevert: true },
      report: { finalSnapshot: artifact('final-snapshot', 'old-report'), excel: { status: 'not-started' }, pdf: { status: 'not-started' } },
    })

    tender = tenderPayload(['new-tender']) as JsonValue
    proposed = proposedPayload(['new-proposed']) as JsonValue
    const second = await test.run(combinedIntent('command-2'))
    expect(second.state.revision).toBe(2)
    expect(second.state.query?.total).toBe(2)
    expect(second.state.query?.normalizedData?.id).not.toBe(first.state.query?.normalizedData?.id)
    expect(second.state.rules).toBeUndefined()
    expect(second.state.classification).toBeUndefined()
    expect(second.state.analysis).toBeUndefined()
    expect(second.state.review).toBeUndefined()
    expect(second.state.report).toBeUndefined()
    expect(second.state.stages.rules.status).toBe('not-started')
    expect(test.tools.execute).toHaveBeenCalledTimes(4)

    const artifactRoot = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(artifactRoot)
    const datasets = Object.values(manifest.artifacts).filter(entry => entry.kind === 'normalized-data')
    expect(datasets).toHaveLength(2)
    expect(manifest.artifacts[first.state.query?.normalizedData?.id ?? '']).toBeDefined()
    const activeEntry = manifest.artifacts[second.state.query?.normalizedData?.id ?? '']
    expect(activeEntry).toBeDefined()
    if (activeEntry === undefined) throw new Error('missing active dataset')
    const activeBytes = await readManifestArtifact(artifactRoot, activeEntry)
    const activeDataset = NormalizedDatasetV1Schema.parse(JSON.parse(activeBytes.toString('utf8')) as unknown)
    expect(activeDataset.rows.map(row => row.sourceId).sort()).toEqual(['new-proposed', 'new-tender'])
    expect(await readFile(test.transcript, 'utf8')).toBe('transcript-sentinel\n')
  })

  it('commits partial success but never fabricates an empty success when every source fails', async () => {
    let failTender = false
    let failProposed = true
    const test = await harness(async name => {
      if (name.endsWith('search_tenders')) return failTender ? failure('tender unavailable') : success(tenderPayload(['usable']) as JsonValue)
      return failProposed ? failure('proposed unavailable') : success(proposedPayload(['p']) as JsonValue)
    })
    const partial = await test.run(combinedIntent('partial'))
    expect(partial.outcome).toBe('partial')
    expect(partial.state).toMatchObject({
      revision: 1,
      stages: { query: { status: 'succeeded' }, overview: { status: 'succeeded' } },
      query: { total: 1, sources: { tender: { status: 'succeeded' }, proposed: { status: 'failed' } } },
    })
    test.adopt(partial.state)
    const activeId = partial.state.query?.normalizedData?.id

    failTender = true
    failProposed = true
    const failed = await test.run(combinedIntent('all-failed'))
    expect(failed.outcome).toBe('failed')
    expect(failed.state).toMatchObject({ revision: 2, stages: { query: { status: 'failed' } } })
    expect(failed.state.query?.normalizedData?.id).toBe(activeId)
    expect(failed.state.query?.total).toBe(1)
  })

  it('does not commit artifacts or receipts after cancellation', async () => {
    const abort = new AbortController()
    const test = await harness(async () => {
      abort.abort(new Error('cancelled by user'))
      return failure('cancelled')
    })
    await expect(test.run(combinedIntent('cancelled'), abort.signal)).rejects.toThrow('cancelled by user')
    const root = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(root)
    expect(manifest.artifacts).toEqual({})
    expect(manifest.receipts).toEqual({})
  })

  it('prefers structuredContent and otherwise validates text JSON', () => {
    expect(extractMcpCanonicalPayload({ content: [], structuredContent: { ok: true } })).toEqual({ ok: true })
    expect(extractMcpCanonicalPayload({ content: [{ type: 'text', text: '{"ok":true}' }] })).toEqual({ ok: true })
    expect(() => extractMcpCanonicalPayload({ content: [{ type: 'text', text: 'not-json' }] })).toThrow()
  })
})
