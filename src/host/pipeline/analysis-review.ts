import { createHash } from 'node:crypto'
import {
  AgentRecommendationV1Schema,
  AnalysisEvidenceV1Schema,
  AnalysisBatchV1Schema,
  AnalysisDatasetV1Schema,
  AnalysisRecordV1Schema,
  ReviewDatasetV1Schema,
  ReviewRecordV1Schema,
  reviewCounts,
  type AgentRecommendationInputV1,
  type AnalysisBatchV1,
  type AnalysisDatasetV1,
  type AnalysisRecordV1,
  type AnalysisScopeV1,
  type ReviewDatasetV1,
  type ReviewRecordV1,
} from '../../contracts/analysis-review.ts'
import type { NormalizedDatasetV1 } from '../../contracts/dataset.ts'
import type { ClassifiedDatasetV1 } from '../../contracts/screening.ts'

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex').slice(0, 32)}`
}

export function analysisVersion(input: {
  readonly activeDatasetId: string
  readonly classificationArtifactId?: string
  readonly ruleSetVersion?: string
}): string {
  return stableId('anv', input)
}

export function analysisBaseRows(
  dataset: NormalizedDatasetV1,
  classified?: ClassifiedDatasetV1,
): AnalysisRecordV1[] {
  const classifications = new Map(classified?.rows.map(row => [row.project.recordId, row]))
  return dataset.rows
    .map((project) => {
      const classifiedRow = classifications.get(project.recordId)
      return AnalysisRecordV1Schema.parse({
        schemaVersion: 1,
        project,
        ...(classifiedRow === undefined ? {} : {
          classification: classifiedRow.classification,
          ...(classifiedRow.finalRuleId === undefined ? {} : { finalRuleId: classifiedRow.finalRuleId }),
        }),
      })
    })
    .sort((left, right) => left.project.recordId.localeCompare(right.project.recordId))
}

function evidenceRef(recordId: string, field: string): string {
  return `ev:${recordId}:${field}`
}

export function allowedAnalysisEvidence(row: AnalysisRecordV1) {
  const project = row.project
  const evidence = [
    { ref: evidenceRef(project.recordId, 'title'), kind: 'source-field', label: '项目名称', value: project.title },
    { ref: evidenceRef(project.recordId, 'source'), kind: 'source-field', label: '来源记录', value: `${project.source}:${project.sourceId}` },
    { ref: evidenceRef(project.recordId, 'counterparty'), kind: 'source-field', label: '采购人/建设单位', value: project.counterparty.original || '未披露' },
    { ref: evidenceRef(project.recordId, 'region'), kind: 'source-field', label: '地区', value: project.region.original || '未披露' },
    { ref: evidenceRef(project.recordId, 'stage'), kind: 'source-field', label: '阶段', value: project.stage.original || '未披露' },
    { ref: evidenceRef(project.recordId, 'amount'), kind: 'source-field', label: '金额', value: project.amount.display, limitation: project.source === 'tender' ? '公告预算不等于收入或利润。' : '拟建总投资不等于可参与采购金额。' },
    { ref: evidenceRef(project.recordId, 'publishedAt'), kind: 'source-field', label: '发布时间/更新时间', value: project.publishedAt.original || '未披露' },
    { ref: evidenceRef(project.recordId, 'deadline'), kind: 'source-field', label: '截止时间', value: project.deadline?.original || '未披露' },
    {
      ref: evidenceRef(project.recordId, 'disclosure'), kind: 'disclosure', label: '字段披露与解析',
      value: `未披露 ${project.disclosure.missingFields.length} 项；无法解析 ${project.disclosure.unparseableFields.length} 项`,
      limitation: '披露/解析状态不表示来源准确率。',
    },
    ...(row.classification === undefined ? [] : [{
      ref: evidenceRef(project.recordId, 'classification'), kind: 'classification', label: '初筛分类', value: row.classification,
      limitation: '初筛分类不是 Agent 建议或用户决定。',
    }]),
    ...(row.finalRuleId === undefined ? [] : [{
      ref: evidenceRef(project.recordId, 'finalRule'), kind: 'rule', label: '生效初筛规则', value: row.finalRuleId,
    }]),
  ]
  return evidence.map(item => AnalysisEvidenceV1Schema.parse(item))
}

function scopeRows(rows: readonly AnalysisRecordV1[], scope: AnalysisScopeV1): AnalysisRecordV1[] {
  if (scope.kind === 'records') {
    const byId = new Map(rows.map(row => [row.project.recordId, row]))
    const selected = scope.recordRefs.map((recordRef) => {
      const row = byId.get(recordRef)
      if (row === undefined) throw new Error(`分析范围包含未知 recordRef：${recordRef}`)
      return row
    })
    return selected.sort((left, right) => left.project.recordId.localeCompare(right.project.recordId))
  }
  if (rows.every(row => row.classification === undefined)) {
    throw new Error('classification 分析范围要求当前存在已确认的分类版本；请改为明确 recordRef 范围。')
  }
  return rows.filter(row => row.classification !== undefined && scope.classifications.includes(row.classification))
}

export function createAnalysisBatch(input: {
  readonly analysisVersion: string
  readonly activeDatasetRef: string
  readonly classificationArtifactRef?: string
  readonly ruleSetVersion?: string
  readonly basedOnRevision: number
  readonly scope: AnalysisScopeV1
  readonly batchSize: number
  readonly rows: readonly AnalysisRecordV1[]
}): AnalysisBatchV1 {
  const uncommitted = scopeRows(input.rows, input.scope).filter(row => row.recommendation === undefined)
  const selected = uncommitted.slice(0, input.batchSize)
  const recordRefs = selected.map(row => row.project.recordId)
  const batchId = stableId('anb', {
    analysisVersion: input.analysisVersion,
    activeDatasetRef: input.activeDatasetRef,
    classificationArtifactRef: input.classificationArtifactRef,
    ruleSetVersion: input.ruleSetVersion,
    scope: input.scope,
    recordRefs,
  })
  return AnalysisBatchV1Schema.parse({
    schemaVersion: 1,
    analysisVersion: input.analysisVersion,
    activeDatasetRef: input.activeDatasetRef,
    ...(input.classificationArtifactRef === undefined ? {} : { classificationArtifactRef: input.classificationArtifactRef }),
    ...(input.ruleSetVersion === undefined ? {} : { ruleSetVersion: input.ruleSetVersion }),
    basedOnRevision: input.basedOnRevision,
    scope: input.scope,
    batchSize: input.batchSize,
    batchId,
    remaining: uncommitted.length,
    records: selected.map(row => ({
      recordRef: row.project.recordId,
      source: row.project.source,
      title: row.project.title,
      ...(row.classification === undefined ? {} : { classification: row.classification }),
      evidence: allowedAnalysisEvidence(row),
    })),
  })
}

export function commitAnalysisBatch(input: {
  readonly previous?: AnalysisDatasetV1
  readonly baseRows: readonly AnalysisRecordV1[]
  readonly batch: AnalysisBatchV1
  readonly recommendations: readonly AgentRecommendationInputV1[]
  readonly now: string
}): AnalysisDatasetV1 {
  if (input.batch.records.length === 0) throw new Error('当前分析范围没有尚未提交的记录。')
  const expected = input.batch.records.map(record => record.recordRef).sort()
  const actual = input.recommendations.map(record => record.recordRef).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Agent 建议必须与当前 batch 的 recordRef 一一对应，不能缺项、多项或越界。')
  }
  const recommendationById = new Map(input.recommendations.map(value => [value.recordRef, value]))
  const previousById = new Map(input.previous?.rows.map(row => [row.project.recordId, row]))
  const rows = input.baseRows.map((base) => {
    const previous = previousById.get(base.project.recordId)
    const recommendation = recommendationById.get(base.project.recordId)
    if (recommendation === undefined) {
      return AnalysisRecordV1Schema.parse({ ...base, ...(previous?.recommendation === undefined ? {} : { recommendation: previous.recommendation }) })
    }
    const allowed = new Map(allowedAnalysisEvidence(base).map(item => [item.ref, item]))
    const referenced = recommendation.evidenceRefs.map((ref) => {
      const item = allowed.get(ref)
      if (item === undefined) throw new Error(`recordRef ${base.project.recordId} 包含无法定位的 evidenceRef：${ref}`)
      return item
    })
    return AnalysisRecordV1Schema.parse({
      ...base,
      recommendation: AgentRecommendationV1Schema.parse({
        recordRef: recommendation.recordRef,
        recommendation: recommendation.recommendation,
        reason: recommendation.reason,
        verificationItems: recommendation.verificationItems,
        limitations: recommendation.limitations,
        batchId: input.batch.batchId,
        committedAt: input.now,
        evidence: referenced,
      }),
    })
  })
  return AnalysisDatasetV1Schema.parse({
    schemaVersion: 1,
    analysisVersion: input.batch.analysisVersion,
    activeDatasetId: input.batch.activeDatasetRef,
    ...(input.batch.classificationArtifactRef === undefined ? {} : { classificationArtifactId: input.batch.classificationArtifactRef }),
    ...(input.batch.ruleSetVersion === undefined ? {} : { ruleSetVersion: input.batch.ruleSetVersion }),
    updatedAt: input.now,
    rows,
  })
}

export function syncReviewDataset(input: {
  readonly previous?: ReviewDatasetV1
  readonly rows: readonly AnalysisRecordV1[]
  readonly activeDatasetId: string
  readonly classificationArtifactId?: string
  readonly ruleSetVersion?: string
  readonly analysisVersion?: string
  readonly now: string
}): ReviewDatasetV1 {
  const prior = new Map(input.previous?.rows.map(row => [row.project.recordId, row.review]))
  const rows = input.rows.map(row => ReviewRecordV1Schema.parse({
    ...row,
    review: prior.get(row.project.recordId) ?? { decision: 'pending', note: '' },
  }))
  return ReviewDatasetV1Schema.parse({
    schemaVersion: 1,
    activeDatasetId: input.activeDatasetId,
    ...(input.classificationArtifactId === undefined ? {} : { classificationArtifactId: input.classificationArtifactId }),
    ...(input.ruleSetVersion === undefined ? {} : { ruleSetVersion: input.ruleSetVersion }),
    ...(input.analysisVersion === undefined ? {} : { analysisVersion: input.analysisVersion }),
    revision: input.previous?.revision ?? 0,
    updatedAt: input.now,
    revertedOperationCount: input.previous?.revertedOperationCount ?? 0,
    operations: input.previous?.operations ?? [],
    rows,
  })
}

export function reviewProjectionCounts(rows: readonly ReviewRecordV1[]) {
  return reviewCounts(rows)
}
