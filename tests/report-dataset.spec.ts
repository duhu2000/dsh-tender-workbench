import { describe, expect, it } from 'vitest'
import { ReviewDatasetV1Schema, ReviewRecordV1Schema, type ReviewRecordV1 } from '../src/contracts/analysis-review.ts'
import { ReportDatasetSchema } from '../src/contracts/reporting.ts'
import { adaptQccProposedPayload, adaptQccTenderPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { normalizeDate, normalizeQccSources } from '../src/host/pipeline/normalize.ts'
import {
  amountDistribution,
  buildReportDataset,
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

function datasetFixture(tenderAmounts: readonly (string | undefined)[], proposedCount = 0) {
  const tender = adaptQccTenderPayload({ 查询摘要: summary, 标讯列表: tenderItems(tenderAmounts) })
  const proposed = proposedCount === 0 ? undefined : adaptQccProposedPayload({
    查询摘要: summary,
    拟建项目列表: Array.from({ length: proposedCount }, (_, index) => ({
      拟建项目ID: `p-${index + 1}`,
      项目名称: `拟建项目 ${index + 1}`,
      项目阶段: '项目备案',
      审批进度: '审批中',
      省市区: '浙江省',
      '项目总投资（元）': '5000万元',
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

  it('uses only single amounts for the median and never assigns cross-band or open ranges to a band', () => {
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
    })
    expect(distribution.bands.map(band => [band.id, band.count])).toEqual([
      ['low', 1], ['middle', 2], ['high', 0],
    ])
  })

  it('selects at most two tender records and one proposed record for the homepage, then fills missing source slots', () => {
    const dataset = datasetFixture(['100万元', '200万元', '300万元'], 2)
    const rows = reviewedRows(dataset)
    const selected = selectHomepageRecordRefs(rows, '2026-09-03T10:00:00.000+08:00')
    const byRef = new Map(rows.map(row => [row.project.recordId, row.project.source]))
    expect(selected).toHaveLength(3)
    expect(selected.map(ref => byRef.get(ref))).toEqual(['tender', 'tender', 'proposed'])
  })

})
