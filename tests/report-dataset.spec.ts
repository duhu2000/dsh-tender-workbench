import { describe, expect, it } from 'vitest'
import { ReviewDatasetV1Schema, ReviewRecordV1Schema, type ReviewRecordV1 } from '../src/contracts/analysis-review.ts'
import { ReportDatasetSchema } from '../src/contracts/reporting.ts'
import { adaptQccProposedPayload, adaptQccTenderPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { normalizeDate, normalizeQccSources } from '../src/host/pipeline/normalize.ts'
import {
  amountDistribution,
  buildReportDataset,
  createReportDeliveryView,
  deadlineWindowOf,
  formatReportDateTime,
  selectHomepageRecordRefs,
} from '../src/host/reporting/report-dataset.ts'

const summary = { 命中总数: 20, 结果说明: 'S5.3 统计边界', 生效筛选: {} }

function tenderItems(amounts: readonly (string | undefined)[]) {
  return amounts.map((amount, index) => ({
    标讯ID: `t-${index + 1}`,
    标题: `招投标项目 ${index + 1}`,
    信息类型: '招标公告',
    公告子状态: '招标',
    省市区: '上海市',
    招采单位: [{ 企业ID: `e-${index + 1}`, 企业名称: `采购单位 ${index + 1}` }],
    招采方式: index % 2 === 0 ? '公开招标' : '竞争性磋商',
    招采类型: '服务',
    项目编号: '',
    ...(amount === undefined ? {} : { '预算金额（元）': amount }),
    发布时间: '2026-09-01',
    投标截止时间: '2026-09-20',
  }))
}

function datasetFixture(tenderAmounts: readonly (string | undefined)[], proposedInput: number | readonly (string | undefined)[] = 0) {
  const tender = adaptQccTenderPayload({ 查询摘要: summary, 标讯列表: tenderItems(tenderAmounts) })
  const proposedAmounts = typeof proposedInput === 'number'
    ? Array.from({ length: proposedInput }, () => '5000万元')
    : proposedInput
  const proposed = proposedAmounts.length === 0 ? undefined : adaptQccProposedPayload({
    查询摘要: summary,
    拟建项目列表: proposedAmounts.map((amount, index) => ({
      拟建项目ID: `p-${index + 1}`,
      项目名称: `拟建项目 ${index + 1}`,
      项目阶段: '项目备案',
      审批进度: '审批中',
      省市区: '浙江省',
      ...(amount === undefined ? {} : { '项目总投资（元）': amount }),
      发布时间: `2026-09-0${index + 1}`,
      建设单位: [{ 企业ID: `b-${index + 1}`, 企业名称: `建设单位 ${index + 1}` }],
      审批单位: [],
      项目编号: '',
    })),
  })
  return normalizeQccSources({
    tender,
    ...(proposed === undefined ? {} : { proposed }),
    sources: {
      tender: { status: 'succeeded', loaded: tender.items.length },
      ...(proposed === undefined ? {} : { proposed: { status: 'succeeded' as const, loaded: proposed.items.length } }),
    },
    createdAt: '2026-09-03T10:00:00.000+08:00',
  })
}

function reviewedRows(dataset: ReturnType<typeof datasetFixture>, classification?: ReviewRecordV1['classification']): ReviewRecordV1[] {
  return dataset.rows.map(project => ReviewRecordV1Schema.parse({
    schemaVersion: 1,
    project,
    ...(classification === undefined ? {} : { classification }),
    review: { decision: 'confirmed-candidate', note: '' },
  }))
}

describe('S5.3 report statistics', () => {
  it('accepts only the current report dataset schema', () => {
    expect(() => ReportDatasetSchema.parse({ schemaVersion: 1 })).toThrow()
  })

  it('formats report timestamps in business-readable Beijing time', () => {
    expect(formatReportDateTime('2026-09-02T14:00:00.000+08:00')).toBe('2026-09-02 14:00')
  })

  it('uses five deadline windows and treats a date-only deadline on the report date as today, not expired', () => {
    const project = datasetFixture(['100万元']).rows[0]
    if (project === undefined) throw new Error('missing project')
    const row = (deadline: string) => ReviewRecordV1Schema.parse({
      schemaVersion: 1,
      project: { ...project, deadline: normalizeDate(deadline) },
      review: { decision: 'confirmed-candidate', note: '' },
    })
    const createdAt = '2026-09-03T10:00:00.000+08:00'
    expect(deadlineWindowOf(row('2026-09-03 09:00:00'), createdAt)).toBe('expired')
    expect(deadlineWindowOf(row('2026-09-03'), createdAt)).toBe('within-7-days')
    expect(deadlineWindowOf(row('2026-09-10'), createdAt)).toBe('within-7-days')
    expect(deadlineWindowOf(row('2026-09-11'), createdAt)).toBe('within-8-to-30-days')
    expect(deadlineWindowOf(row('2026-10-04'), createdAt)).toBe('after-30-days')
    expect(deadlineWindowOf(row('近期'), createdAt)).toBe('unavailable')
  })

  it('derives dynamic amount bands, uses only single amounts for the median, and keeps cross-band or open ranges separate', () => {
    const dataset = datasetFixture([
      '100万元', '约500万元', '400万-600万', '200万-400万', '1000万元以上', undefined, '金额待议',
    ])
    const distribution = amountDistribution(reviewedRows(dataset), 'tender')
    expect(distribution).toMatchObject({
      eligibleCount: 7,
      singleValueCount: 2,
      bandedRangeCount: 1,
      indeterminateCount: 2,
      missingCount: 1,
      unparseableCount: 1,
      medianCny: 3_000_000,
      axis: {
        unit: 'ten-thousand-yuan', unitLabel: '万元', minCny: 0, maxCny: 6_000_000,
        ticksCny: [0, 2_000_000, 4_000_000, 6_000_000],
      },
    })
    expect(distribution.bands.map(band => [band.id, band.count])).toEqual([
      ['low', 1], ['middle', 0], ['high', 2],
    ])
    expect(distribution.bands.map(band => band.label)).toEqual([
      '0 至 200 万元', '200 至 400 万元', '400 至 600 万元',
    ])
  })

  it.each([
    { name: 'yuan', amounts: ['100元', '400元'], unit: 'yuan', unitLabel: '元' },
    { name: 'ten-thousand-yuan', amounts: ['100万元', '300万元'], unit: 'ten-thousand-yuan', unitLabel: '万元' },
    { name: 'hundred-million-yuan', amounts: ['1亿元', '3亿元'], unit: 'hundred-million-yuan', unitLabel: '亿元' },
  ])('chooses the $name axis unit from the current tender amount range', ({ amounts, unit, unitLabel }) => {
    const distribution = amountDistribution(reviewedRows(datasetFixture(amounts)), 'tender')
    expect(distribution.axis).toMatchObject({ unit, unitLabel })
    expect(distribution.axis?.minCny).toBeLessThanOrEqual(Math.min(...reviewedRows(datasetFixture(amounts)).map(row => row.project.amount.minCny ?? Infinity)))
    expect(distribution.axis?.maxCny).toBeGreaterThanOrEqual(Math.max(...reviewedRows(datasetFixture(amounts)).map(row => row.project.amount.maxCny ?? -Infinity)))
    expect(distribution.bands.every(band => band.label.endsWith(unitLabel))).toBe(true)
  })

  it('keeps equal values readable and expands a multi-order range to three nice intervals', () => {
    const equal = amountDistribution(reviewedRows(datasetFixture(['860万元', '860万元'])), 'tender')
    expect(equal.axis).toEqual({
      unit: 'ten-thousand-yuan', unitLabel: '万元', minCny: 7_000_000, maxCny: 10_000_000,
      ticksCny: [7_000_000, 8_000_000, 9_000_000, 10_000_000],
    })
    expect(equal.bands.map(band => band.count)).toEqual([0, 2, 0])

    const wide = amountDistribution(reviewedRows(datasetFixture(['1万元', '10亿元'])), 'tender')
    expect(wide.axis).toEqual({
      unit: 'hundred-million-yuan', unitLabel: '亿元', minCny: 0, maxCny: 1_500_000_000,
      ticksCny: [0, 500_000_000, 1_000_000_000, 1_500_000_000],
    })
    expect(wide.bands.map(band => band.count)).toEqual([1, 0, 1])
  })

  it('uses the same dynamic unit policy for proposed projects and omits the axis when no closed amount is available', () => {
    const smallProposed = amountDistribution(reviewedRows(datasetFixture([], ['500元', '900元'])), 'proposed')
    expect(smallProposed.axis).toMatchObject({ unit: 'yuan', unitLabel: '元' })

    const unavailable = amountDistribution(reviewedRows(datasetFixture([undefined, '金额待议', '1000万元以上'])), 'tender')
    expect(unavailable.axis).toBeUndefined()
    expect(unavailable.bands.map(band => band.count)).toEqual([0, 0, 0])
    expect(unavailable).toMatchObject({ missingCount: 1, unparseableCount: 1, indeterminateCount: 1 })
  })

  it('selects at most two tender records and one proposed record for the homepage, then fills missing source slots', () => {
    const dataset = datasetFixture(['100万元', '200万元', '300万元'], 2)
    const rows = reviewedRows(dataset)
    const selected = selectHomepageRecordRefs(rows, '2026-09-03T10:00:00.000+08:00')
    const byRef = new Map(rows.map(row => [row.project.recordId, row.project.source]))
    expect(selected).toHaveLength(3)
    expect(selected.map(ref => byRef.get(ref))).toEqual(['tender', 'tender', 'proposed'])
  })

  it('derives a bounded Client delivery view from the immutable V2 snapshot without exposing full rows', () => {
    const normalized = datasetFixture(['100万元', '200万元', '300万元'], 2)
    const review = ReviewDatasetV1Schema.parse({
      schemaVersion: 1,
      activeDatasetId: 'active-dataset',
      ruleSetVersion: 'rules-v1',
      analysisVersion: 'analysis-v1',
      revision: 3,
      updatedAt: '2026-09-03T10:00:00.000+08:00',
      revertedOperationCount: 0,
      operations: [],
      rows: reviewedRows(normalized, 'include'),
    })
    const dataset = buildReportDataset({
      finalSnapshotId: 'snapshot-v2',
      createdAt: '2026-09-03T10:00:00.000+08:00',
      stateRevision: 8,
      normalized,
      review,
      query: {
        scope: 'combined',
        targetSummary: '金融科技机会',
        sources: {
          tender: { status: 'succeeded', loaded: 3 },
          proposed: { status: 'succeeded', loaded: 2 },
        },
      },
    })
    const view = createReportDeliveryView(dataset)
    expect(view).toMatchObject({
      schemaVersion: 1,
      finalSnapshotId: 'snapshot-v2',
      completeness: 'complete',
      rulesIncluded: true,
      analysisIncluded: true,
      analysisCoverage: { completed: 0, total: 5 },
    })
    expect(view.priorityRecords).toHaveLength(5)
    expect(view.homepageRecords).toHaveLength(3)
    expect(view.priorityRecords[0]).not.toHaveProperty('evidenceRefs')
    expect(view).not.toHaveProperty('rows')
    expect(view).not.toHaveProperty('invalidRecords')
    expect(view).not.toHaveProperty('contextFingerprint')
  })

})
