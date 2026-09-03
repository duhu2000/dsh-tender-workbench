import { describe, expect, it } from 'vitest'
import { TenderQueryIntentV1Schema } from '../src/contracts/query-schema.ts'
import {
  MAX_PROJECTION_BYTES,
  TenderRuleV1Schema,
  createEmptyTenderWorkflowProjection,
  parseTenderWorkflowProjectionV1,
  projectionSizeBytes,
} from '../src/contracts/workflow.ts'

describe('V1 workflow contracts', () => {
  it('accepts exact query branches and rejects Session identity or branch drift', () => {
    const valid = {
      schemaVersion: 1,
      commandId: 'command-1',
      kind: 'query.start',
      scope: 'combined',
      target: '查找北京大数据相关项目',
      tender: { keywords: ['大数据'], regions: ['北京市'] },
      proposed: { keywords: ['大数据'], regions: ['北京市'] },
    }
    expect(TenderQueryIntentV1Schema.parse(valid)).toEqual(valid)
    expect(() => TenderQueryIntentV1Schema.parse({ ...valid, sessionId: 'must-not-cross-the-tool-boundary' })).toThrow()
    expect(() => TenderQueryIntentV1Schema.parse({ ...valid, scope: 'tender' })).toThrow()
  })

  it('enforces the UI keyword limit and a real filter in every Host query branch', () => {
    const base = {
      schemaVersion: 1, commandId: 'command-limits', kind: 'query.start', scope: 'tender', target: '目标',
    } as const
    expect(() => TenderQueryIntentV1Schema.parse({ ...base, tender: {} })).toThrow()
    expect(() => TenderQueryIntentV1Schema.parse({ ...base, tender: { smartSort: true } })).toThrow()
    expect(() => TenderQueryIntentV1Schema.parse({
      ...base,
      tender: { keywords: Array.from({ length: 11 }, (_, index) => `关键词${index}`) },
    })).toThrow()
  })

  it('fixes the flat OR-keyword rule shape without a generic expression tree', () => {
    const rule = {
      id: 'rule-1',
      name: '大数据项目',
      enabled: true,
      action: 'include',
      sources: ['tender'],
      scope: 'all',
      keywords: ['大数据', '数据平台'],
      priority: 10,
      exceptions: ['培训'],
      reason: '优先识别目标项目',
    }
    expect(TenderRuleV1Schema.parse(rule)).toEqual(rule)
    expect(() => TenderRuleV1Schema.parse({ ...rule, keywords: [] })).toThrow()
    expect(() => TenderRuleV1Schema.parse({ ...rule, condition: { any: ['大数据'] } })).toThrow()
  })

  it('keeps the complete legal projection below the 64 KiB wire guard', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const error = '错'.repeat(512)
    const stages = Object.fromEntries(Object.keys(empty.stages).map(stage => [stage, {
      status: 'failed',
      errorCode: 'E'.repeat(128),
      errorMessage: error,
    }]))
    const largestCore = parseTenderWorkflowProjectionV1({
      ...empty,
      currentStage: 'report',
      stages,
      lastFailure: {
        command: 'tender_workbench_generate_report',
        code: 'E'.repeat(128),
        message: error,
      },
    })
    expect(projectionSizeBytes(largestCore)).toBeLessThan(MAX_PROJECTION_BYTES)
    expect(() => parseTenderWorkflowProjectionV1({ ...largestCore, unownedRecords: [] })).toThrow()
  })

  it('keeps S3 rules/classification as summaries and Artifact refs rather than record arrays', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const ref = (kind: 'rule-draft' | 'rule-preview' | 'rule-set' | 'classified-data', suffix: string) => ({
      id: `artifact-${suffix}`, kind, fileName: `${suffix}.json`, mediaType: 'application/json', rowCount: 20_000,
      createdAt: '2026-09-01T00:00:00.000Z', accessToken: `token-${suffix}`,
    })
    const projection = parseTenderWorkflowProjectionV1({
      ...empty,
      revision: 3,
      currentStage: 'classification',
      rules: {
        draft: ref('rule-draft', 'draft'), draftOrigin: 'user', draftFingerprint: 'r_0123456789abcdef',
        preview: ref('rule-preview', 'preview'), previewRevision: 2, activeDatasetId: 'active-data',
        confirmed: ref('rule-set', 'confirmed'), ruleSetVersion: 'rsv-3', ruleCount: 100,
        rawMatches: 2_000_000, covered: 20_000, conflicts: 20_000,
      },
      classification: {
        data: ref('classified-data', 'classified'), include: 4_000, observe: 4_000, manualReview: 4_000,
        exclude: 4_000, unmatched: 4_000, covered: 16_000, conflicts: 2_000,
        ruleSetVersion: 'rsv-3', activeDatasetId: 'active-data',
      },
    })
    expect(projectionSizeBytes(projection)).toBeLessThan(MAX_PROJECTION_BYTES)
    expect(JSON.stringify(projection)).not.toContain('rawMatches":[')
    expect(JSON.stringify(projection)).not.toContain('"rows"')
  })

  it('keeps S5 Projection bounded to delivery summaries and opaque Artifact refs', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const ref = (kind: 'final-snapshot' | 'excel' | 'pdf', suffix: string) => ({
      id: `artifact-${suffix}`, kind, fileName: `${suffix}.${kind === 'excel' ? 'xlsx' : kind === 'pdf' ? 'pdf' : 'json'}`,
      mediaType: kind === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : kind === 'pdf' ? 'application/pdf' : 'application/json',
      createdAt: '2026-09-02T00:00:00.000Z', accessToken: `token-${suffix}`,
    })
    const projection = parseTenderWorkflowProjectionV1({
      ...empty,
      revision: 9,
      currentStage: 'report',
      stages: { ...empty.stages, report: { status: 'succeeded', updatedAt: '2026-09-02T00:00:00.000Z' } },
      report: {
        finalSnapshot: ref('final-snapshot', 'snapshot'), finalSnapshotId: 'fs-1', completeness: 'partial',
        createdAt: '2026-09-02T00:00:00.000Z', rawRecords: 20_000, normalizedProjects: 18_000,
        reviewed: 12_000, confirmedTender: 1_000, priorityProposed: 500, watch: 3_000, pending: 6_000,
        exclude: 7_500, analysisCompleted: 4_000, analysisTotal: 18_000, narrativeIncluded: true,
        excel: { status: 'succeeded', artifact: ref('excel', 'excel') },
        pdf: { status: 'failed', errorMessage: 'renderer failed' },
      },
    })
    expect(projectionSizeBytes(projection)).toBeLessThan(MAX_PROJECTION_BYTES)
    expect(JSON.stringify(projection)).not.toContain('keyFindings')
    expect(JSON.stringify(projection)).not.toContain('rows')
  })
})
