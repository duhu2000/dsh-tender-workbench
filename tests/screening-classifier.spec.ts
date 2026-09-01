import { describe, expect, it } from 'vitest'
import type { NormalizedProjectV1 } from '../src/contracts/dataset.ts'
import {
  TenderRuleSetV1Schema,
  TenderRuleV1Schema,
  type TenderRuleV1,
} from '../src/contracts/workflow.ts'
import { ruleDraftFingerprint } from '../src/contracts/screening.ts'
import {
  classifyTenderProjects,
  createClassifiedDataset,
  createRulePreviewArtifact,
} from '../src/host/pipeline/classify.ts'

function project(input: {
  readonly id: string
  readonly source?: 'tender' | 'proposed'
  readonly title: string
  readonly purchaser?: string
  readonly missing?: readonly string[]
  readonly unparseable?: readonly string[]
}): NormalizedProjectV1 {
  const source = input.source ?? 'tender'
  const purchaser = input.purchaser ?? ''
  return {
    schemaVersion: 1,
    recordId: input.id,
    source,
    sourceId: `${source}-${input.id}`,
    title: input.title,
    lifecycle: source === 'tender' ? 'active-procurement' : 'early-signal',
    dataDisposition: 'normalized',
    stage: { original: '', status: 'missing' },
    projectNumber: { original: '', status: 'missing' },
    region: { original: '', parts: [], status: 'missing' },
    counterparty: purchaser === '' ? { original: '', status: 'missing' } : { original: purchaser, value: purchaser, status: 'normalized' },
    amount: { original: '', type: source === 'tender' ? 'budget' : 'total-investment', parseStatus: 'missing', display: '未披露' },
    publishedAt: { original: '', precision: 'unknown', timeZone: 'Asia/Shanghai', parseStatus: 'missing' },
    announcements: [{
      sourceRecordId: `${source}-${input.id}`,
      title: input.title,
      lifecycle: source === 'tender' ? 'active-procurement' : 'early-signal',
      stage: { original: '', status: 'missing' },
      projectNumber: { original: '', status: 'missing' },
      region: { original: '', parts: [], status: 'missing' },
      amount: { original: '', type: source === 'tender' ? 'budget' : 'total-investment', parseStatus: 'missing', display: '未披露' },
      publishedAt: { original: '', precision: 'unknown', timeZone: 'Asia/Shanghai', parseStatus: 'missing' },
      parties: purchaser === '' ? [] : [{ id: `party-${input.id}`, name: purchaser }],
    }],
    disclosure: {
      missingFields: [...(input.missing ?? [])],
      unparseableFields: [...(input.unparseable ?? [])],
    },
  }
}

function rule(input: Partial<TenderRuleV1> & Pick<TenderRuleV1, 'id' | 'action'>): TenderRuleV1 {
  return TenderRuleV1Schema.parse({
    id: input.id,
    name: input.name ?? input.id,
    enabled: input.enabled ?? true,
    action: input.action,
    sources: input.sources ?? ['tender', 'proposed'],
    scope: input.scope ?? 'all',
    keywords: input.keywords ?? ['数据'],
    priority: input.priority ?? 0,
    exceptions: input.exceptions ?? [],
    reason: input.reason ?? '当前 Session 用户确认的测试口径',
  })
}

describe('S3 deterministic screening classifier', () => {
  it('rejects unknown fields, unknown sources, extra expression trees, empty keywords, and illegal priority', () => {
    const valid = rule({ id: 'r1', action: 'include' })
    expect(TenderRuleSetV1Schema.parse([valid])).toEqual([valid])
    expect(() => TenderRuleV1Schema.parse({ ...valid, scope: 'summary' })).toThrow()
    expect(() => TenderRuleV1Schema.parse({ ...valid, sources: ['web'] })).toThrow()
    expect(() => TenderRuleV1Schema.parse({ ...valid, keywords: [] })).toThrow()
    expect(() => TenderRuleV1Schema.parse({ ...valid, priority: 1001 })).toThrow()
    expect(() => TenderRuleV1Schema.parse({ ...valid, condition: { any: ['数据'] } })).toThrow()
    expect(() => TenderRuleSetV1Schema.parse([valid, { ...valid }])).toThrow()
  })

  it('matches any keyword in the declared field/source and records exception suppression', () => {
    const rows = [
      project({ id: 'a', title: '数据治理平台', purchaser: '甲方' }),
      project({ id: 'b', title: '数据治理培训', purchaser: '甲方' }),
      project({ id: 'c', source: 'proposed', title: '数据治理中心', purchaser: '建设单位' }),
      project({ id: 'd', title: '普通项目', purchaser: '数据集团' }),
    ]
    const rules = [
      rule({ id: 'title', action: 'include', sources: ['tender'], scope: 'title', keywords: ['云', '数据'], exceptions: ['培训'] }),
      rule({ id: 'party', action: 'observe', sources: ['tender'], scope: 'purchaser', keywords: ['数据集团'] }),
    ]
    const run = classifyTenderProjects(rows, rules)
    expect(run.rows.map(row => row.classification)).toEqual(['include', 'unmatched', 'unmatched', 'observe'])
    expect(run.rows[1]?.rawMatches).toMatchObject([{ ruleId: 'title', eligible: false, exceptionKeywords: ['培训'] }])
    expect(run.ruleImpacts).toContainEqual({ ruleId: 'title', rawMatchCount: 2, exceptionCount: 1, conflictCount: 0, finalCount: 1 })
  })

  it('keeps all raw matches, resolves cross-action priority, and uses stable array order for ties', () => {
    const row = project({ id: 'a', title: '数据平台云服务' })
    const priority = classifyTenderProjects([row], [
      rule({ id: 'exclude', action: 'exclude', priority: 10, keywords: ['云'] }),
      rule({ id: 'include', action: 'include', priority: 20, keywords: ['数据'] }),
      rule({ id: 'observe', action: 'observe', priority: 5, keywords: ['平台'] }),
    ]).rows[0]
    expect(priority).toMatchObject({
      classification: 'include', finalRuleId: 'include',
      conflictRuleIds: ['exclude', 'include', 'observe'], decision: { kind: 'priority', winningPriority: 20 },
    })
    expect(priority?.rawMatches.map(match => match.ruleId)).toEqual(['exclude', 'include', 'observe'])

    const tie = classifyTenderProjects([row], [
      rule({ id: 'first', action: 'observe', priority: 20, keywords: ['数据'] }),
      rule({ id: 'second', action: 'include', priority: 20, keywords: ['数据'] }),
    ]).rows[0]
    expect(tie).toMatchObject({ classification: 'observe', finalRuleId: 'first', decision: { kind: 'stable-order' } })
  })

  it('classifies unmatched and disclosure/parse boundary records without changing data disposition', () => {
    const missing = project({ id: 'missing', title: '普通项目', missing: ['采购人'], unparseable: ['金额'] })
    const matching = project({ id: 'matching', title: '数据项目', missing: ['截止时间'] })
    const run = classifyTenderProjects([missing, matching], [rule({ id: 'include', action: 'include' })])
    expect(run.rows[0]).toMatchObject({ classification: 'unmatched', project: { dataDisposition: 'normalized', disclosure: { missingFields: ['采购人'], unparseableFields: ['金额'] } } })
    expect(run.rows[1]).toMatchObject({ classification: 'include', project: { dataDisposition: 'normalized' } })
  })

  it('uses the same run for preview and formal data, with mutually exclusive totals', () => {
    const rows = [project({ id: 'a', title: '数据项目' }), project({ id: 'b', title: '普通项目' })]
    const rules = [rule({ id: 'include', action: 'include' })]
    const run = classifyTenderProjects(rows, rules)
    const fingerprint = ruleDraftFingerprint(rules)
    const preview = createRulePreviewArtifact({
      activeDatasetId: 'dataset', basedOnRevision: 1, stateRevision: 2,
      draftFingerprint: fingerprint, origin: 'user', run,
    })
    const classified = createClassifiedDataset({ activeDatasetId: 'dataset', ruleSetVersion: 'v1', classifiedAt: '2026-09-01T00:00:00.000Z', run })
    expect(classified.counts).toEqual(preview.counts)
    expect(classified.ruleImpacts).toEqual(preview.ruleImpacts)
    expect(classified.covered).toBe(preview.covered)
    expect(Object.values(classified.counts).reduce((sum, value) => sum + value, 0)).toBe(rows.length)
    expect(ruleDraftFingerprint(rules)).toBe(fingerprint)
  })

  it('contains no built-in or enabled default industry rules', () => {
    expect(() => classifyTenderProjects([project({ id: 'a', title: '金融数据平台' })], [])).toThrow()
    expect(TenderRuleSetV1Schema.safeParse([]).success).toBe(false)
  })
})
