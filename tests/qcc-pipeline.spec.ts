import { describe, expect, it } from 'vitest'
import {
  adaptQccProposedPayload,
  adaptQccTenderPayload,
  QccSourceContractError,
} from '../src/host/pipeline/qcc-adapters.ts'
import {
  normalizeAmount,
  normalizeDate,
  normalizeQccSources,
} from '../src/host/pipeline/normalize.ts'

const summary = { 命中总数: 2, 结果说明: '实际加载范围', 生效筛选: { keywords: ['数据'] } }

function tenderPayload(items: readonly unknown[]) {
  return { 查询摘要: summary, 标讯列表: items }
}

function proposedPayload(items: readonly unknown[]) {
  return { 查询摘要: summary, 拟建项目列表: items }
}

function tenderItem(overrides: Record<string, unknown> = {}) {
  return {
    标讯ID: 't-1',
    标题: '某银行数据治理项目',
    信息类型: '招标公告',
    公告子状态: '招标',
    省市区: '江苏省',
    招采单位: [{ 企业ID: 'e-1', 企业名称: '某银行' }],
    项目编号: '',
    '预算金额（元）': '8,600,000',
    发布时间: '2026-08-29',
    投标截止时间: '2026-09-09 17:00:00',
    ...overrides,
  }
}

describe('qcc source adapters and deterministic normalization', () => {
  it('keeps schema-valid source facts unchanged while adding separate normalized values', () => {
    const sourceTitle = ' 某银行数据治理项目（来源原值） '
    const amount = '约 860 万元'
    const adapted = adaptQccTenderPayload(tenderPayload([tenderItem({ 标题: sourceTitle, '预算金额（元）': amount })]))
    const dataset = normalizeQccSources({
      tender: adapted,
      sources: { tender: { status: 'succeeded', loaded: 1 } },
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(dataset.rows).toHaveLength(1)
    expect(dataset.rows[0]?.title).toBe(sourceTitle)
    expect(dataset.rows[0]?.amount).toMatchObject({
      original: amount,
      minCny: 8_600_000,
      maxCny: 8_600_000,
      parseStatus: 'approximate',
    })
    expect(dataset.rows[0]?.announcements[0]?.sourceRecordId).toBe('t-1')
    expect(dataset).not.toHaveProperty('confidence')
  })

  it('distinguishes missing, unparseable, and definite technical schema errors', () => {
    const adapted = adaptQccTenderPayload(tenderPayload([
      tenderItem({ 标讯ID: 'missing', 省市区: undefined, '预算金额（元）': undefined, 发布时间: undefined }),
      tenderItem({ 标讯ID: 'unparseable', 省市区: '浙江省', '预算金额（元）': '金额待议', 发布时间: '近期' }),
      tenderItem({ 标讯ID: 42 }),
    ]))
    const dataset = normalizeQccSources({
      tender: adapted,
      sources: { tender: { status: 'succeeded', loaded: 3 } },
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(adapted.invalidRecords).toHaveLength(1)
    expect(adapted.invalidRecords[0]?.code).toBe('invalid-item-schema')
    expect(dataset.summary.invalidRecordCount).toBe(1)
    expect(dataset.rows.find(row => row.sourceId === 'missing')?.amount.parseStatus).toBe('missing')
    expect(dataset.rows.find(row => row.sourceId === 'unparseable')?.amount).toMatchObject({
      original: '金额待议', parseStatus: 'unparseable',
    })
    expect(dataset.rows.find(row => row.sourceId === 'unparseable')?.publishedAt).toMatchObject({
      original: '近期', parseStatus: 'unparseable',
    })
  })

  it('never fuzzy-merges records by title or company and only links explicit stable relations', () => {
    const separate = adaptQccTenderPayload(tenderPayload([
      tenderItem({ 标讯ID: 'one', 项目编号: '' }),
      tenderItem({ 标讯ID: 'two', 项目编号: '' }),
    ]))
    const separateDataset = normalizeQccSources({
      tender: separate,
      sources: { tender: { status: 'succeeded', loaded: 2 } },
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(separateDataset.rows).toHaveLength(2)
    expect(separateDataset.summary.linkedRecordCount).toBe(0)

    const linked = adaptQccTenderPayload(tenderPayload([
      tenderItem({ 标讯ID: 'notice-1', 项目编号: 'EXPLICIT-001', 公告子状态: '招标', 发布时间: '2026-08-20' }),
      tenderItem({ 标讯ID: 'notice-2', 项目编号: 'EXPLICIT-001', 公告子状态: '更正公告', 发布时间: '2026-08-21', '预算金额（元）': undefined }),
    ]))
    const linkedDataset = normalizeQccSources({
      tender: linked,
      sources: { tender: { status: 'succeeded', loaded: 2 } },
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(linkedDataset.rows).toHaveLength(1)
    expect(linkedDataset.rows[0]?.announcements).toHaveLength(2)
    expect(linkedDataset.rows[0]?.lifecycle).toBe('amended')
    expect(linkedDataset.rows[0]?.amount.original).toBe('8,600,000')
    expect(linkedDataset.summary.linkedRecordCount).toBe(1)
  })

  it('keeps tender and proposed-project source semantics separate', () => {
    const tender = adaptQccTenderPayload(tenderPayload([tenderItem({ 标讯ID: 'award', 信息类型: '中标公告', 公告子状态: '中标成交' })]))
    const proposed = adaptQccProposedPayload(proposedPayload([{
      拟建项目ID: 'p-1', 项目名称: '智算中心拟建项目', 项目阶段: '项目备案', 审批进度: '审批中',
      省市区: '浙江省', '项目总投资（元）': '4.6亿元', 发布时间: '2026-08-27', 建设单位: [], 项目编号: 'P-1',
    }]))
    const dataset = normalizeQccSources({
      tender,
      proposed,
      sources: {
        tender: { status: 'succeeded', loaded: 1 },
        proposed: { status: 'succeeded', loaded: 1 },
      },
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(dataset.rows.find(row => row.source === 'tender')?.lifecycle).toBe('awarded')
    expect(dataset.rows.find(row => row.source === 'proposed')?.lifecycle).toBe('early-signal')
    expect(dataset.rows.find(row => row.source === 'proposed')?.amount.type).toBe('total-investment')
  })

  it('rejects only definite payload-envelope contract violations and parses strict dates/amounts', () => {
    expect(() => adaptQccTenderPayload({ 查询摘要: summary, 标讯列表: 'not-an-array' }))
      .toThrow(QccSourceContractError)
    expect(normalizeDate('2026-02-30').parseStatus).toBe('unparseable')
    expect(normalizeDate('2026-08').precision).toBe('month')
    expect(normalizeAmount('300万元以上', 'budget')).toMatchObject({ minCny: 3_000_000, parseStatus: 'range' })
  })
})
