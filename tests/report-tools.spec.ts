import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewDatasetV1Schema, ReviewRecordV1Schema } from '../src/contracts/analysis-review.ts'
import { ReportDatasetV1Schema, type ReportDatasetV1, type ReportNarrativeV1 } from '../src/contracts/reporting.ts'
import { createEmptyTenderWorkflowProjection, type TenderWorkflowProjectionV1 } from '../src/contracts/workflow.ts'
import { CommandReceiptCoordinator, emptyCommandReceiptManifest } from '../src/host/artifacts/command-receipts.ts'
import { ArtifactTransaction, readArtifactManifest, readManifestArtifact, sessionArtifactRoot } from '../src/host/artifacts/store.ts'
import { adaptQccProposedPayload, adaptQccTenderPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { normalizeQccSources } from '../src/host/pipeline/normalize.ts'
import { escapeExcelText, renderReportExcel } from '../src/host/reporting/excel.ts'
import { renderReportPdf, reportNarrativeSummaryNote } from '../src/host/reporting/pdf.ts'
import { buildReportDataset, createReportContext } from '../src/host/reporting/report-dataset.ts'
import {
  createTenderWorkbenchGenerateReportTool,
  createTenderWorkbenchReportContextTool,
  type ReportContextResultV1,
  type ReportMutationResultV1,
} from '../src/host/tools/report-tools.ts'

const temporaryRoots: string[] = []
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function normalizedFixture() {
  const tender = adaptQccTenderPayload({
    查询摘要: { 命中总数: 2, 结果说明: '报告测试', 生效筛选: {} },
    标讯列表: [
      { 标讯ID: 't-1', 标题: '数据治理平台', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-1', 企业名称: '某银行' }], 发布时间: '2026-08-30', 投标截止时间: '2026-09-18', 预算金额: '860万元' },
      { 标讯ID: 't-2', 标题: '云平台扩容', 信息类型: '招标公告', 招采单位: [{ 企业ID: 'e-2', 企业名称: '某集团' }], 发布时间: '2026-08-29', 投标截止时间: '2026-09-12' },
    ],
  })
  const proposed = adaptQccProposedPayload({
    查询摘要: { 命中总数: 1, 结果说明: '报告测试', 生效筛选: {} },
    拟建项目列表: [
      { 拟建项目ID: 'p-1', 项目名称: '智算中心建设', 项目阶段: '备案', 审批进度: '审批中', 发布时间: '2026-08-31', '项目总投资（元）': '2亿元', 建设单位: [{ 企业ID: 'e-3', 企业名称: '某科技公司' }] },
    ],
  })
  return normalizeQccSources({
    tender,
    proposed,
    sources: { tender: { status: 'succeeded', loaded: 2 }, proposed: { status: 'succeeded', loaded: 1 } },
    createdAt: '2026-09-01T08:00:00.000+08:00',
  })
}

async function harness(options: { readonly complete?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tender-report-tools-'))
  temporaryRoots.push(root)
  const transcript = join(root, 'session.jsonl')
  await writeFile(transcript, 'transcript-sentinel\n', 'utf8')
  const sessionId = 'session-report-test' as SessionId
  const session = { id: sessionId, header: { version: 0, id: sessionId, createdAt: 1 } }
  const persistence = { locate: () => ({ kind: 'jsonl', path: transcript }) }
  const normalized = normalizedFixture()
  const seed = new ArtifactTransaction(sessionArtifactRoot(persistence, session.header))
  await seed.load()
  const querySpec = await seed.stageJson('query-spec', 'query.json', { schemaVersion: 1 })
  const normalizedRef = await seed.stageJson('normalized-data', 'normalized.json', JSON.parse(JSON.stringify(normalized)), normalized.rows.length)
  const rows = normalized.rows.map(project => ReviewRecordV1Schema.parse({
    schemaVersion: 1,
    project,
    ...(project.sourceId === 't-1' ? {
      recommendation: {
        recordRef: project.recordId,
        recommendation: 'priority-review',
        reason: '方向相关，仍需用户核验。',
        verificationItems: ['核验采购范围'],
        limitations: ['没有企业能力画像'],
        batchId: 'batch-report',
        committedAt: '2026-09-01T08:10:00.000+08:00',
        evidence: [{ ref: `ev:${project.recordId}:title`, kind: 'source-field', label: '项目名称', value: project.title }],
      },
    } : {}),
    review: {
      decision: project.sourceId === 't-1' || project.source === 'proposed'
        ? 'confirmed-candidate'
        : options.complete === true ? 'exclude' : 'pending',
      note: project.sourceId === 't-1' ? '用户确认进入候选。' : '',
    },
  }))
  const reviewDataset = ReviewDatasetV1Schema.parse({
    schemaVersion: 1,
    activeDatasetId: normalizedRef.id,
    revision: 2,
    updatedAt: '2026-09-01T08:20:00.000+08:00',
    revertedOperationCount: 0,
    operations: [],
    rows,
  })
  const reviewRef = await seed.stageJson('review-data', 'review.json', JSON.parse(JSON.stringify(reviewDataset)), rows.length)
  await seed.save(emptyCommandReceiptManifest())
  const empty = createEmptyTenderWorkflowProjection()
  let projection: TenderWorkflowProjectionV1 = {
    ...empty,
    revision: 4,
    currentStage: 'review',
    stages: {
      ...empty.stages,
      query: { status: 'succeeded', updatedAt: normalized.createdAt },
      overview: { status: 'succeeded', updatedAt: normalized.createdAt },
      review: { status: 'succeeded', updatedAt: reviewDataset.updatedAt },
    },
    query: {
      scope: 'combined',
      targetSummary: '寻找数据基础设施机会',
      querySpec,
      sources: {
        tender: { status: 'succeeded', loaded: 2 },
        proposed: { status: 'succeeded', loaded: 1 },
      },
      normalizedData: normalizedRef,
      sourceRecordCount: 3,
      total: 3,
      duplicateCount: 0,
      invalidCount: 0,
      missingFieldCount: normalized.summary.missingFieldCount,
      unparseableFieldCount: normalized.summary.unparseableFieldCount,
    },
    review: {
      revision: reviewDataset.revision,
      data: reviewRef,
      pending: options.complete === true ? 0 : 1,
      confirmedCandidate: 2,
      watch: 0,
      exclude: options.complete === true ? 1 : 0,
      canRevert: false,
    },
  }
  const sessionProjections = { stateOf: () => projection }
  const receipts = new CommandReceiptCoordinator()
  const context = (id: string): ToolRunContext => ({
    callId: `call-${id}`, rootCallId: `call-${id}`, token: Symbol(id),
    signal: new AbortController().signal, agent: { id: sessionId, session },
  } as unknown as ToolRunContext)
  const binding = () => ({
    schemaVersion: 1 as const,
    kind: 'report.context' as const,
    activeDatasetRef: normalizedRef.id,
    reviewArtifactRef: reviewRef.id,
    reviewRevision: 2,
    projectionRevision: projection.revision,
  })
  return {
    session,
    persistence,
    receipts,
    normalized,
    reviewDataset,
    sessionProjections,
    context,
    binding,
    projection: () => projection,
    adopt: (value: TenderWorkflowProjectionV1) => { projection = value },
  }
}

function narrativeFor(recordRef: string): ReportNarrativeV1 {
  return {
    executiveSummary: {
      title: '复核范围形成可交付结论',
      statement: '当前用户决定已形成候选与待复核的清晰分层，后续应继续核验证据边界。',
      metricRefs: ['reviewed-projects', 'pending-review'],
      recordRefs: [],
      limitations: ['该判断不涉及企业适配、资格符合或投标决策。'],
    },
    keyFindings: [],
    priorityVerification: [{
      title: '优先核验采购范围',
      statement: '该记录具备当前可定位证据，仍需用户核验采购范围和截止要求。',
      metricRefs: [],
      recordRefs: [recordRef],
      limitations: ['来源披露范围可能不完整。'],
    }],
    risksAndLimitations: [],
  }
}

describe('S5 report context, immutable snapshot, and renderer retry', () => {
  it('returns stable bounded Host context and rejects stale, unknown, or numeric Agent narrative', async () => {
    const test = await harness()
    const root = sessionArtifactRoot(test.persistence, test.session.header)
    const before = await readArtifactManifest(root)
    const tool = createTenderWorkbenchReportContextTool({
      sessionProjections: test.sessionProjections as never,
      sessionPersistence: test.persistence,
      receipts: test.receipts,
    })
    const first = await tool.execute(test.binding(), test.context('context-1')) as ReportContextResultV1
    const repeated = await tool.execute(test.binding(), test.context('context-2')) as ReportContextResultV1
    expect(repeated.context).toEqual(first.context)
    expect(first.context.priorityRecords).toHaveLength(2)
    expect(first.context.priorityRecords.map(record => record.source)).toEqual(['tender', 'proposed'])
    expect(first.context.metrics.find(metric => metric.metricId === 'pending-review')?.value).toBe(1)
    expect(first.context.contextFingerprint).toMatch(/^rc_[a-f0-9]{64}$/u)
    const rendered = tool.output.render(test.binding(), first)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toMatchObject({ type: 'text' })
    if (rendered[0]?.type !== 'text') throw new Error('report context must render as text')
    expect(rendered[0].text).toContain(first.context.contextFingerprint)
    expect(rendered[0].text).toContain(first.context.metrics[0]?.metricId)
    expect(rendered[0].text).toContain(first.context.priorityRecords[0]?.recordRef)
    expect(await readArtifactManifest(root)).toEqual(before)

    const generate = createTenderWorkbenchGenerateReportTool({
      sessionProjections: test.sessionProjections as never,
      sessionPersistence: test.persistence,
      receipts: test.receipts,
      renderers: {
        excel: vi.fn(async () => ({ bytes: Buffer.from('xlsx'), fileName: 'report.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })),
        pdf: vi.fn(async () => ({ bytes: Buffer.from('%PDF-test'), fileName: 'report.pdf', mediaType: 'application/pdf' })),
      },
    })
    expect(generate).toMatchObject({
      parameters: {
        activeDatasetRef: { type: 'string' },
        reviewRevision: { type: 'integer' },
        narrative: {
          type: 'object',
          additionalProperties: false,
          properties: {
            executiveSummary: { type: 'object' },
            keyFindings: { type: 'array' },
            priorityVerification: { type: 'array' },
            risksAndLimitations: { type: 'array' },
          },
        },
      },
    })
    if (!('parameters' in generate) || typeof generate.parameters !== 'object' || generate.parameters === null) {
      throw new Error('generate tool must expose its public parameter schema')
    }
    const publicParameters = generate.parameters as Record<string, unknown>
    expect(publicParameters['activeDatasetRef']).not.toHaveProperty('required')
    expect(publicParameters['reviewRevision']).not.toHaveProperty('required')
    const recordRef = first.context.priorityRecords[0]?.recordRef
    if (recordRef === undefined) throw new Error('missing priority record')
    const binding = test.binding()
    const createInput = {
      schemaVersion: 1 as const, kind: 'report.generate' as const, mode: 'create' as const,
      commandId: 'report-invalid',
      activeDatasetRef: binding.activeDatasetRef,
      reviewArtifactRef: binding.reviewArtifactRef,
      reviewRevision: binding.reviewRevision,
      projectionRevision: binding.projectionRevision,
      contextFingerprint: first.context.contextFingerprint,
      narrative: narrativeFor(recordRef),
      confirmPending: false,
    }
    await expect(generate.execute(createInput, test.context('pending-not-confirmed'))).rejects.toThrow('必须明确确认')
    await expect(generate.execute({
      ...createInput,
      commandId: 'report-stale-fingerprint', confirmPending: true,
      contextFingerprint: `rc_${'0'.repeat(64)}`,
    }, test.context('stale-fingerprint'))).rejects.toThrow('指纹')
    await expect(generate.execute({
      ...createInput,
      commandId: 'report-numeric', confirmPending: true,
      narrative: {
        ...narrativeFor(recordRef),
        keyFindings: [{ title: '发现', statement: '覆盖率为百分之五十并包含 2 个项目。', metricRefs: ['agent-analysis-coverage'], recordRefs: [], limitations: [] }],
      },
    }, test.context('numeric-narrative'))).rejects.toThrow('不得在自由文本中写入数字')
    await expect(tool.execute({ ...test.binding(), projectionRevision: 3 }, test.context('stale-context'))).rejects.toThrow('revision')
  })

  it('uses the exact same validated narrative for both formats and retries only a failed format from the same snapshot', async () => {
    const test = await harness()
    const contextTool = createTenderWorkbenchReportContextTool({
      sessionProjections: test.sessionProjections as never,
      sessionPersistence: test.persistence,
      receipts: test.receipts,
    })
    const reportContext = (await contextTool.execute(test.binding(), test.context('context')) as ReportContextResultV1).context
    const recordRef = reportContext.priorityRecords[0]?.recordRef
    if (recordRef === undefined) throw new Error('missing priority record')
    const expectedNarrative = narrativeFor(recordRef)
    const excelDatasets: ReportDatasetV1[] = []
    const pdfDatasets: ReportDatasetV1[] = []
    let excelAttempt = 0
    const excel = vi.fn(async (dataset: ReportDatasetV1) => {
      excelDatasets.push(structuredClone(dataset))
      excelAttempt += 1
      if (excelAttempt === 1) throw new Error('forced excel failure')
      return { bytes: Buffer.from('xlsx-success'), fileName: 'report.xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    })
    const pdf = vi.fn(async (dataset: ReportDatasetV1) => {
      pdfDatasets.push(structuredClone(dataset))
      return { bytes: Buffer.from('%PDF-success'), fileName: 'report.pdf', mediaType: 'application/pdf' }
    })
    const generate = createTenderWorkbenchGenerateReportTool({
      sessionProjections: test.sessionProjections as never,
      sessionPersistence: test.persistence,
      receipts: test.receipts,
      renderers: { excel, pdf },
    })
    const binding = test.binding()
    const created = await generate.execute({
      schemaVersion: 1, kind: 'report.generate', mode: 'create', commandId: 'report-create',
      activeDatasetRef: binding.activeDatasetRef,
      reviewArtifactRef: binding.reviewArtifactRef,
      reviewRevision: binding.reviewRevision,
      projectionRevision: binding.projectionRevision,
      confirmPending: true,
      contextFingerprint: reportContext.contextFingerprint,
      narrative: expectedNarrative,
    }, test.context('report-create')) as ReportMutationResultV1
    test.adopt(created.state)
    expect(created.state.report).toMatchObject({ completeness: 'partial', pending: 1, excel: { status: 'failed' }, pdf: { status: 'succeeded' } })
    expect(excelDatasets[0]?.narrative).toEqual(expectedNarrative)
    expect(pdfDatasets[0]?.narrative).toEqual(expectedNarrative)
    expect(excelDatasets[0]?.finalSnapshotId).toBe(pdfDatasets[0]?.finalSnapshotId)

    const snapshotId = created.state.report?.finalSnapshotId
    const pdfArtifactId = created.state.report?.pdf.artifact?.id
    if (snapshotId === undefined) throw new Error('missing final snapshot')
    const retried = await generate.execute({
      schemaVersion: 1, kind: 'report.generate', mode: 'retry', commandId: 'report-retry-excel',
      projectionRevision: created.state.revision,
      finalSnapshotId: snapshotId,
      formats: ['excel'],
    }, test.context('report-retry-excel')) as ReportMutationResultV1
    test.adopt(retried.state)
    expect(retried.state.report).toMatchObject({ finalSnapshotId: snapshotId, excel: { status: 'succeeded' }, pdf: { status: 'succeeded', artifact: { id: pdfArtifactId } } })
    expect(excel).toHaveBeenCalledTimes(2)
    expect(pdf).toHaveBeenCalledTimes(1)
    expect(excelDatasets[1]).toEqual(excelDatasets[0])

    const root = sessionArtifactRoot(test.persistence, test.session.header)
    const manifest = await readArtifactManifest(root)
    const snapshots = Object.values(manifest.artifacts).filter(entry => entry.kind === 'final-snapshot')
    expect(snapshots).toHaveLength(1)
    const snapshot = snapshots[0]
    if (snapshot === undefined) throw new Error('missing snapshot entry')
    const stored = ReportDatasetV1Schema.parse(JSON.parse((await readManifestArtifact(root, snapshot)).toString('utf8')) as unknown)
    expect(stored.finalSnapshotId).toBe(snapshotId)
    expect(stored.narrative).toEqual(expectedNarrative)
    expect(stored.contextFingerprint).toBe(reportContext.contextFingerprint)
  })

  it('renders the fixed real workbook/PDF with narrative only in the designated Excel summary area', async () => {
    const test = await harness()
    const context = createReportContext({ normalized: test.normalized, review: test.reviewDataset, stateRevision: 4 })
    const recordRef = context.priorityRecords[0]?.recordRef
    if (recordRef === undefined) throw new Error('missing priority record')
    const narrative = narrativeFor(recordRef)
    const dataset = buildReportDataset({
      finalSnapshotId: 'fs_renderer_test',
      createdAt: '2026-09-02T14:00:00.000+08:00',
      stateRevision: 4,
      normalized: test.normalized,
      review: test.reviewDataset,
      query: {
        scope: 'combined',
        targetSummary: '寻找数据基础设施机会',
        sources: { tender: { status: 'succeeded', loaded: 2 }, proposed: { status: 'succeeded', loaded: 1 } },
      },
      narrative,
    })
    expect(reportNarrativeSummaryNote(dataset)).toBeUndefined()
    expect(reportNarrativeSummaryNote({
      ...dataset,
      narrative: { ...narrative, executiveSummary: undefined },
    })).toContain('未提供 Agent 管理摘要')
    expect(reportNarrativeSummaryNote({ ...dataset, narrative: undefined })).toContain('未包含 Agent 叙述')
    const signal = new AbortController().signal
    const [xlsx, pdf] = await Promise.all([renderReportExcel(dataset, signal), renderReportPdf(dataset, signal)])
    const qaOutput = process.env['DSH_TENDER_REPORT_QA_OUTPUT']
    if (qaOutput !== undefined) {
      await mkdir(qaOutput, { recursive: true })
      await Promise.all([
        writeFile(join(qaOutput, 's5-report-qa.xlsx'), xlsx.bytes),
        writeFile(join(qaOutput, 's5-report-qa.pdf'), pdf.bytes),
      ])
    }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsx.bytes as never)
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      '分析概况', '招投标候选', '拟建重点线索', '观察与待复核', '排除与异常', '全量规范化数据',
    ])
    const statement = narrative.executiveSummary?.statement ?? ''
    expect(JSON.stringify(workbook.getWorksheet('分析概况')?.model)).toContain(statement)
    workbook.worksheets.slice(1).forEach(sheet => expect(JSON.stringify(sheet.model)).not.toContain(statement))
    expect(pdf.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(pdf.bytes.byteLength).toBeGreaterThan(10_000)
    ;['=2+2', '+SUM(A1:A2)', '-1+1', '@cmd', '\t=HYPERLINK("https://evil.test")', '\n+SUM(A1:A2)']
      .forEach(value => expect(escapeExcelText(value)).toMatch(/^'/u))
    expect(escapeExcelText('line one\tline two\nline three')).not.toMatch(/[\t\r\n]/u)
    expect(escapeExcelText('长文本'.repeat(20_000)).length).toBeLessThanOrEqual(32_000)
  })

  it('creates a complete deterministic report without calling for or storing Agent narrative', async () => {
    const test = await harness({ complete: true })
    const datasets: ReportDatasetV1[] = []
    const renderer = vi.fn(async (dataset: ReportDatasetV1, _signal: AbortSignal) => {
      datasets.push(structuredClone(dataset))
      return { bytes: Buffer.from('deterministic'), fileName: 'report.bin', mediaType: 'application/octet-stream' }
    })
    const generate = createTenderWorkbenchGenerateReportTool({
      sessionProjections: test.sessionProjections as never,
      sessionPersistence: test.persistence,
      receipts: test.receipts,
      renderers: { excel: renderer, pdf: renderer },
    })
    const binding = test.binding()
    const created = await generate.execute({
      schemaVersion: 1, kind: 'report.generate', mode: 'create', commandId: 'deterministic-report',
      activeDatasetRef: binding.activeDatasetRef,
      reviewArtifactRef: binding.reviewArtifactRef,
      reviewRevision: binding.reviewRevision,
      projectionRevision: binding.projectionRevision,
      confirmPending: false,
    }, test.context('deterministic-report')) as ReportMutationResultV1
    expect(created.state.report).toMatchObject({
      completeness: 'complete', pending: 0, narrativeIncluded: false,
      excel: { status: 'succeeded' }, pdf: { status: 'succeeded' },
    })
    expect(datasets).toHaveLength(2)
    expect(datasets[0]?.narrative).toBeUndefined()
    expect(datasets[1]).toEqual(datasets[0])
  })
})
