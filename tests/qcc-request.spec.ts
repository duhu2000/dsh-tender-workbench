import { describe, expect, it } from 'vitest'
import { QccRequestValidationError, toQccQueryBranches, toQccSearchRequest } from '../src/client/qcc-request.ts'
import { createInitialTenderFilters } from '../src/client/types.ts'

const NOW = new Date('2026-08-30T12:00:00+08:00')

describe('toQccSearchRequest', () => {
  it('maps every supported tender field and preserves schema spelling', () => {
    const request = toQccSearchRequest({
      ...createInitialTenderFilters(), noticeType: 'ifb', keywords: '大数据 招标', regionCodes: ['130102'],
      tenderStages: ['变更'], procurementMethods: ['竞谈', '竞磋'], procurementTypes: ['工程'],
      industries: ['工程建筑'], tenderAmountMin: '20.5', tenderAmountMax: '50',
    }, NOW)
    expect(request).toEqual({
      tool: 'mcp__qcc-tender__search_tenders',
      args: {
        keywords: ['大数据', '招标'], beginDate: '2026-05-30', regions: ['河北省石家庄市长安区'],
        infoTypes: ['招标公告'], bidStatuses: ['招标变更'], procurementMethods: ['竞争性谈判', '竞争性磋商'],
        procurementTypes: ['工程'], TenderIndustries: ['工程建筑'], budgetMin: 205000, budgetMax: 500000,
      },
    })
  })

  it('maps proposed fields and amount units independently', () => {
    expect(toQccSearchRequest({
      ...createInitialTenderFilters(), searchMode: 'proposed', proposedStages: ['项目备案'],
      approvalProgress: ['审批通过'], proposedInvestmentPreset: '1亿以上',
    }, NOW)).toEqual({
      tool: 'mcp__qcc-tender__search_proposed_projects',
      args: { beginDate: '2026-05-30', projectStages: ['项目备案'], approvalStatuses: ['审批通过'], investmentMin: 100000000 },
    })
  })

  it('converts date presets, prior year, and custom endpoint semantics', () => {
    expect(toQccSearchRequest({ ...createInitialTenderFilters(), publishPreset: 'today' }, NOW).args).toMatchObject({ beginDate: '2026-08-30' })
    expect(toQccSearchRequest({ ...createInitialTenderFilters(), publishPreset: 'year', publishYear: 2025 }, NOW).args).toMatchObject({ beginDate: '2024-12-31', endDate: '2026-01-01' })
    expect(toQccSearchRequest({ ...createInitialTenderFilters(), publishPreset: 'custom', startDate: '2026-01-01', endDate: '2026-03-31' }, NOW).args).toMatchObject({ beginDate: '2025-12-31', endDate: '2026-04-01' })
    expect(toQccSearchRequest({ ...createInitialTenderFilters(), publishPreset: 'custom', startDate: '2026-01-01' }, NOW).args).toEqual({ beginDate: '2026-01-01' })
  })

  it('omits unrestricted info type and hidden branch stages', () => {
    const request = toQccSearchRequest({ ...createInitialTenderFilters(), tenderStages: ['变更'], awardStages: ['变更'] }, NOW)
    expect(request.args).not.toHaveProperty('infoTypes')
    expect(request.args).not.toHaveProperty('bidStatuses')
    expect(request.args).not.toHaveProperty('smartSort')
  })

  it('rejects tool limits, unsupported regions, and an empty mapped request', () => {
    const expectCode = (run: () => unknown, code: string): void => {
      try { run(); throw new Error('expected validation error') } catch (error) {
        expect(error).toBeInstanceOf(QccRequestValidationError)
        expect((error as QccRequestValidationError).code).toBe(code)
      }
    }
    expectCode(() => toQccSearchRequest({ ...createInitialTenderFilters(), keywords: Array.from({ length: 11 }, (_, index) => `k${index}`).join(' ') }, NOW), 'keywords-limit')
    expectCode(() => toQccSearchRequest({ ...createInitialTenderFilters(), regionCodes: Array.from({ length: 21 }, () => 'BJ') }, NOW), 'regions-limit')
    expectCode(() => toQccSearchRequest({ ...createInitialTenderFilters(), regionCodes: ['HK'] }, NOW), 'unsupported-region')
    expectCode(() => toQccSearchRequest({ ...createInitialTenderFilters(), publishPreset: 'all' }, NOW), 'no-supported-filter')
  })

  it('builds isolated combined branches and never leaks hidden tender fields', () => {
    const filters = {
      ...createInitialTenderFilters(), noticeType: 'wtb' as const, keywords: '数据治理 信创',
      tenderStages: ['招标'], awardStages: ['中标成交'],
      tenderAmountMin: '300', awardAmountMin: '500',
      proposedStages: ['项目备案'], approvalProgress: ['审批通过'], proposedInvestmentMin: '1000',
    }
    expect(toQccQueryBranches(filters, 'combined', NOW)).toEqual({
      tender: {
        keywords: ['数据治理', '信创'], beginDate: '2026-05-30', infoTypes: ['中标公告'],
        bidStatuses: ['中标成交'], winningAmountMin: 5_000_000,
      },
      proposed: {
        keywords: ['数据治理', '信创'], beginDate: '2026-05-30', projectStages: ['项目备案'],
        approvalStatuses: ['审批通过'], investmentMin: 10_000_000,
      },
    })
    expect(toQccQueryBranches(filters, 'tender', NOW)).not.toHaveProperty('proposed')
    expect(toQccQueryBranches(filters, 'proposed', NOW)).not.toHaveProperty('tender')
  })
})
