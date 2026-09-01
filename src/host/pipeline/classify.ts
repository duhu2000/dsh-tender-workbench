import type { NormalizedProjectV1 } from '../../contracts/dataset.ts'
import {
  ClassifiedDatasetV1Schema,
  ClassifiedRecordV1Schema,
  ClassificationCountsV1Schema,
  RulePreviewArtifactV1Schema,
  type ClassifiedDatasetV1,
  type ClassifiedRecordV1,
  type ClassificationCountsV1,
  type RulePreviewArtifactV1,
} from '../../contracts/screening.ts'
import {
  TenderRuleSetV1Schema,
  type TenderRuleV1,
} from '../../contracts/workflow.ts'

export interface ClassificationRunV1 {
  readonly rows: readonly ClassifiedRecordV1[]
  readonly counts: ClassificationCountsV1
  readonly total: number
  readonly covered: number
  readonly conflicts: number
  readonly rawMatches: number
  readonly ruleImpacts: RulePreviewArtifactV1['ruleImpacts']
}

function searchableText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN')
}

function scopedValues(project: NormalizedProjectV1, scope: TenderRuleV1['scope']): readonly string[] {
  const title = project.title
  const purchaser = project.counterparty.value ?? project.counterparty.original
  if (scope === 'title') return [title]
  if (scope === 'purchaser') return [purchaser]
  return [title, purchaser]
}

function matchingTerms(values: readonly string[], terms: readonly string[]): string[] {
  const haystacks = values.map(searchableText)
  return terms.filter(term => {
    const needle = searchableText(term)
    return haystacks.some(value => value.includes(needle))
  })
}

function classifyProject(project: NormalizedProjectV1, rules: readonly TenderRuleV1[]): ClassifiedRecordV1 {
  const rawMatches = rules.flatMap((rule, ruleIndex) => {
    if (!rule.enabled || !rule.sources.includes(project.source)) return []
    const values = scopedValues(project, rule.scope)
    const matchedKeywords = matchingTerms(values, rule.keywords)
    if (matchedKeywords.length === 0) return []
    const exceptionKeywords = matchingTerms(values, rule.exceptions)
    return [{
      ruleId: rule.id,
      ruleIndex,
      action: rule.action,
      priority: rule.priority,
      matchedKeywords,
      exceptionKeywords,
      eligible: exceptionKeywords.length === 0,
    }]
  })
  const eligible = rawMatches.filter(match => match.eligible)
  if (eligible.length === 0) {
    return ClassifiedRecordV1Schema.parse({
      schemaVersion: 1,
      project,
      classification: 'unmatched',
      rawMatches,
      conflictRuleIds: [],
      decision: { kind: 'unmatched' },
    })
  }

  const actionCount = new Set(eligible.map(match => match.action)).size
  const conflictRuleIds = actionCount > 1 ? eligible.map(match => match.ruleId) : []
  const maximumPriority = Math.max(...eligible.map(match => match.priority))
  const top = eligible.filter(match => match.priority === maximumPriority)
  const winner = top[0]
  if (winner === undefined) throw new Error('classification winner unexpectedly missing')
  const decision = actionCount === 1
    ? { kind: 'single-action' as const, winningPriority: winner.priority }
    : new Set(top.map(match => match.action)).size > 1
      ? { kind: 'stable-order' as const, winningPriority: winner.priority }
      : { kind: 'priority' as const, winningPriority: winner.priority }
  return ClassifiedRecordV1Schema.parse({
    schemaVersion: 1,
    project,
    classification: winner.action,
    rawMatches,
    conflictRuleIds,
    finalRuleId: winner.ruleId,
    decision,
  })
}

function countsOf(rows: readonly ClassifiedRecordV1[]): ClassificationCountsV1 {
  const counts: ClassificationCountsV1 = {
    include: 0,
    observe: 0,
    manualReview: 0,
    exclude: 0,
    unmatched: 0,
  }
  rows.forEach((row) => {
    if (row.classification === 'manual-review') counts.manualReview += 1
    else counts[row.classification] += 1
  })
  return ClassificationCountsV1Schema.parse(counts)
}

/** The only S3 classifier used by both preview and immutable confirmation. */
export function classifyTenderProjects(
  projects: readonly NormalizedProjectV1[],
  inputRules: readonly TenderRuleV1[],
): ClassificationRunV1 {
  const rules = TenderRuleSetV1Schema.parse(inputRules)
  const rows = projects.map(project => classifyProject(project, rules))
  const counts = countsOf(rows)
  const total = rows.length
  const covered = total - counts.unmatched
  const conflicts = rows.filter(row => row.conflictRuleIds.length > 0).length
  const rawMatches = rows.reduce((sum, row) => sum + row.rawMatches.length, 0)
  const ruleImpacts = rules.map(rule => ({
    ruleId: rule.id,
    rawMatchCount: rows.filter(row => row.rawMatches.some(match => match.ruleId === rule.id)).length,
    exceptionCount: rows.filter(row => row.rawMatches.some(match => match.ruleId === rule.id && !match.eligible)).length,
    conflictCount: rows.filter(row => row.conflictRuleIds.includes(rule.id)).length,
    finalCount: rows.filter(row => row.finalRuleId === rule.id).length,
  }))
  const totalFromCounts = counts.include + counts.observe + counts.manualReview + counts.exclude + counts.unmatched
  if (totalFromCounts !== total) throw new Error('classification totals are not mutually exclusive')
  return { rows, counts, total, covered, conflicts, rawMatches, ruleImpacts }
}

function sample(
  kind: RulePreviewArtifactV1['samples'][number]['kind'],
  rows: readonly ClassifiedRecordV1[],
): RulePreviewArtifactV1['samples'] {
  return rows.slice(0, 5).map(row => ({
    kind,
    recordId: row.project.recordId,
    title: row.project.title,
    source: row.project.source,
    classification: row.classification,
    matchedRuleIds: row.rawMatches.map(match => match.ruleId),
    ...(row.finalRuleId === undefined ? {} : { finalRuleId: row.finalRuleId }),
  }))
}

export function createRulePreviewArtifact(input: {
  readonly activeDatasetId: string
  readonly basedOnRevision: number
  readonly stateRevision: number
  readonly draftFingerprint: string
  readonly origin: 'agent' | 'user'
  readonly run: ClassificationRunV1
}): RulePreviewArtifactV1 {
  const matchRows = input.run.rows.filter(row => row.classification !== 'unmatched' && row.conflictRuleIds.length === 0)
  const boundaryRows = input.run.rows.filter(row => row.classification === 'unmatched'
    && (row.project.disclosure.missingFields.length > 0 || row.project.disclosure.unparseableFields.length > 0))
  const unmatchedRows = input.run.rows.filter(row => row.classification === 'unmatched')
  const conflictRows = input.run.rows.filter(row => row.conflictRuleIds.length > 0)
  const exceptionRows = input.run.rows.filter(row => row.rawMatches.some(match => !match.eligible))
  return RulePreviewArtifactV1Schema.parse({
    schemaVersion: 1,
    activeDatasetId: input.activeDatasetId,
    basedOnRevision: input.basedOnRevision,
    stateRevision: input.stateRevision,
    draftFingerprint: input.draftFingerprint,
    origin: input.origin,
    counts: input.run.counts,
    total: input.run.total,
    covered: input.run.covered,
    conflicts: input.run.conflicts,
    rawMatches: input.run.rawMatches,
    ruleImpacts: input.run.ruleImpacts,
    samples: [
      ...sample('match', matchRows),
      ...sample('boundary', boundaryRows.length === 0 ? unmatchedRows : boundaryRows),
      ...sample('conflict', conflictRows),
      ...sample('exception', exceptionRows),
    ].slice(0, 20),
  })
}

export function createClassifiedDataset(input: {
  readonly activeDatasetId: string
  readonly ruleSetVersion: string
  readonly classifiedAt: string
  readonly run: ClassificationRunV1
}): ClassifiedDatasetV1 {
  return ClassifiedDatasetV1Schema.parse({
    schemaVersion: 1,
    activeDatasetId: input.activeDatasetId,
    ruleSetVersion: input.ruleSetVersion,
    classifiedAt: input.classifiedAt,
    counts: input.run.counts,
    total: input.run.total,
    covered: input.run.covered,
    conflicts: input.run.conflicts,
    rawMatches: input.run.rawMatches,
    ruleImpacts: input.run.ruleImpacts,
    rows: input.run.rows,
  })
}
