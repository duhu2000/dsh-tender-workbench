import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NormalizedDatasetV1Schema } from '../src/contracts/dataset.ts'
import type { RunQueryToolInputV2 } from '../src/contracts/tool-inputs.ts'
import type { TenderWorkflowProjectionV2 } from '../src/contracts/workflow.ts'
import { IntentReceiptCoordinator } from '../src/host/artifacts/intent-receipts.ts'
import { readArtifactManifest, readManifestArtifact, sessionArtifactRoot } from '../src/host/artifacts/store.ts'
import {
  createTenderWorkbenchQueryTool,
  extractMcpCanonicalPayload,
  extractMcpCanonicalPayloadCandidates,
  type QueryToolResultV2,
} from '../src/host/tools/query-tool.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function tenderPayload(ids: readonly string[]): JsonValue {
  return {
    查询摘要: { 命中总数: ids.length, 结果说明: '实际加载', 生效筛选: {} },
    标讯列表: ids.map(id => ({
      标讯ID: id, 标题: `项目 ${id}`, 信息类型: '招标公告', 公告子状态: '招标', 省市区: '江苏省',
      招采单位: [{ 企业ID: 'e-1', 企业名称: '采购单位' }], 项目编号: '', '预算金额（元）': '1000000',
      发布时间: '2026-08-29', 投标截止时间: '2026-09-20',
    })),
  }
}

function proposedPayload(ids: readonly string[]): JsonValue {
  return {
    查询摘要: { 命中总数: ids.length, 结果说明: '实际加载', 生效筛选: {} },
    拟建项目列表: ids.map(id => ({
      拟建项目ID: id, 项目名称: `拟建 ${id}`, 项目阶段: '项目备案', 审批进度: '审批中', 省市区: '浙江省',
      '项目总投资（元）': '50000000', 发布时间: '2026-08-27', 建设单位: [], 项目编号: '',
    })),
  }
}

function success(payload: JsonValue): ToolExecutionResult {
  return { isError: false, value: { content: [], structuredContent: payload }, content: [{ type: 'text', text: 'ok' }] }
}

function failure(message: string): ToolExecutionResult {
  return {
    isError: true,
    error: { message, info: { name: 'Error', code: 'SOURCE_FAILED' } },
    content: [{ type: 'text', text: message }],
  }
}

function queryInput(): RunQueryToolInputV2 {
  return {
    schemaVersion: 2,
    origin: { kind: 'conversation' },
    projectionRevision: 0,
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
  const session = {
    id: sessionId,
    header: { version: 0, id: sessionId, createdAt: 1 },
    events: [{
      type: 'user/message', seq: 1, time: 1,
      data: { turn: 1, source: { kind: 'user' }, content: [{ type: 'text', text: '查询数据项目' }] },
    }],
  }
  let projection: TenderWorkflowProjectionV2 | null = null
  const tools = { execute: vi.fn((input: { readonly name: string }) => execute(input.name)) }
  const persistence = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const tool = createTenderWorkbenchQueryTool({
    tools: tools as never,
    sessionProjections: { stateOf: () => projection } as never,
    sessionPersistence: persistence,
    receipts: new IntentReceiptCoordinator(),
  })
  const run = async (input = queryInput()): Promise<QueryToolResultV2> => tool.execute(input, {
    callId: 'query-call', rootCallId: 'query-call', token: Symbol('query'),
    signal: new AbortController().signal, agent: { id: sessionId, session },
  } as unknown as ToolRunContext) as Promise<QueryToolResultV2>
  return { root, transcript, session, tools, persistence, tool, run, adopt: (state: TenderWorkflowProjectionV2) => { projection = state } }
}

describe('tender_workbench_run_query', () => {
  it('calls exact qcc Tools and atomically creates one V2 active dataset', async () => {
    const test = await harness(async name => name.endsWith('search_tenders')
      ? success(tenderPayload(['t-1', 't-2']))
      : success(proposedPayload(['p-1'])))
    const result = await test.run()
    expect(result).toMatchObject({
      domain: 'dsh-tender-workbench', schemaVersion: 2,
      tool: 'tender_workbench_run_query', outcome: 'succeeded',
      state: { revision: 1, currentStage: 'overview', query: { total: 3 } },
      control: { status: 'complete' },
    })
    expect(test.tools.execute.mock.calls.map(call => call[0].name)).toEqual([
      'mcp__qcc-tender__search_tenders', 'mcp__qcc-tender__search_proposed_projects',
    ])
    const artifactRoot = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(artifactRoot)
    const normalizedEntry = Object.values(manifest.artifacts).find(entry => entry.kind === 'normalized-data')
    if (normalizedEntry === undefined) throw new Error('missing normalized data')
    const normalized = NormalizedDatasetV1Schema.parse(
      JSON.parse((await readManifestArtifact(artifactRoot, normalizedEntry)).toString('utf8')),
    )
    expect(normalized.rows).toHaveLength(3)
    expect(await readFile(test.transcript, 'utf8')).toBe('transcript-sentinel\n')
  })

  it('keeps a partial source result explicit and still completes the query', async () => {
    const test = await harness(async name => name.endsWith('search_tenders')
      ? failure('tender unavailable')
      : success(proposedPayload(['p-1'])))
    const result = await test.run()
    expect(result.outcome).toBe('partial')
    expect(result.state.query?.sources).toMatchObject({
      tender: { status: 'failed', loaded: 0 }, proposed: { status: 'succeeded', loaded: 1 },
    })
    expect(result.control).toEqual({ status: 'complete' })
  })

  it('returns structured failed control and preserves the prior active chain when all sources fail', async () => {
    const test = await harness(async () => failure('source unavailable'))
    const result = await test.run()
    expect(result).toMatchObject({
      outcome: 'failed', control: { status: 'failed', reasonCode: 'all-sources-failed', retryable: true },
      state: { revision: 1, stages: { query: { status: 'failed' } } },
    })
    expect(result.state.query).toBeUndefined()
  })

  it('exposes the complete structured envelope to the Agent renderer', async () => {
    const test = await harness(async () => success(tenderPayload(['t-1'])))
    const input: RunQueryToolInputV2 = {
      ...queryInput(), scope: 'tender', tender: { keywords: ['数据'] }, proposed: undefined,
    }
    const result = await test.run(input)
    const rendered = test.tool.output.render(input, result as unknown as JsonValue)
    expect(rendered[0]).toMatchObject({ type: 'text' })
    if (rendered[0]?.type !== 'text') throw new Error('query output must render as text')
    expect(rendered[0].text).toContain('<dsh_tender_workbench_tool_result>')
    expect(rendered[0].text).toContain('"control"')
    expect(rendered[0].text).toContain('"context"')
  })

  it('extracts canonical MCP JSON without accepting arbitrary text', () => {
    const payload = tenderPayload(['t-1'])
    expect(extractMcpCanonicalPayload({ structuredContent: payload, content: [] })).toEqual(payload)
    expect(extractMcpCanonicalPayloadCandidates({ content: [{ type: 'text', text: JSON.stringify(payload) }] })).toEqual([payload])
    expect(() => extractMcpCanonicalPayload({ content: [{ type: 'text', text: 'not-json' }] })).toThrow()
  })
})
