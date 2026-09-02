import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import {
  ArtifactRowsPageV1Schema,
  NormalizedDatasetV1Schema,
  OPPORTUNITY_LIFECYCLES,
  TENDER_DATA_SOURCES,
  type ArtifactRowsFilterV1,
  type NormalizedProjectV1,
} from '../../contracts/dataset.ts'
import {
  CLASSIFICATION_VALUES,
  ClassifiedDatasetV1Schema,
  ClassifiedRowsPageV1Schema,
  RuleArtifactContentV1Schema,
  type ClassifiedRecordV1,
  type ClassifiedRowsFilterV1,
} from '../../contracts/screening.ts'
import type { ArtifactRefV1 } from '../../contracts/workflow.ts'
import {
  AGENT_RECOMMENDATIONS,
  AnalysisDatasetV1Schema,
  DEADLINE_STATUSES,
  ReviewDatasetV1Schema,
  ReviewRecordV1Schema,
  ReviewRowsPageV1Schema,
  USER_DECISIONS,
  type ReviewRecordV1,
  type ReviewRowsFilterV1,
} from '../../contracts/analysis-review.ts'
import { artifactRequestIdentity } from '../http-trust.ts'
import { ARTIFACT_ROUTE_PREFIX } from './register-route.ts'
import {
  ArtifactManifestError,
  readArtifactManifest,
  readManifestArtifact,
  sessionArtifactRoot,
  type SessionPersistenceLocator,
} from './store.ts'

const SAFE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

interface ArtifactRouteServices {
  readonly sessions: Pick<SessionStore, 'get'>
  readonly sessionPersistence: SessionPersistenceLocator
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    ...SAFE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.byteLength),
  })
  res.end(body)
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message: message.slice(0, 512) } })
}

function constantTokenEqual(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual, 'utf8').digest()
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(actualHash, expectedHash)
}

function singleParameter(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name)
  if (values.length > 1) throw new RangeError(`duplicate query parameter: ${name}`)
  return values[0]
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!/^\d+$/u.test(value)) throw new RangeError('pagination must be a positive integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RangeError('pagination must be a positive integer')
  return parsed
}

function rowsFilter(parameters: URLSearchParams): ArtifactRowsFilterV1 {
  const page = positiveInteger(singleParameter(parameters, 'page'), 1)
  const pageSize = positiveInteger(singleParameter(parameters, 'pageSize'), 50)
  if (pageSize > 100) throw new RangeError('pageSize exceeds 100')
  const query = singleParameter(parameters, 'q')?.trim()
  const source = singleParameter(parameters, 'source')
  const lifecycle = singleParameter(parameters, 'lifecycle')
  const fieldStatus = singleParameter(parameters, 'fieldStatus')
  const region = singleParameter(parameters, 'region')?.trim()
  const sort = singleParameter(parameters, 'sort')
  if (query !== undefined && query.length > 200) throw new RangeError('query exceeds 200 characters')
  if (source !== undefined && !(TENDER_DATA_SOURCES as readonly string[]).includes(source)) throw new RangeError('unknown source filter')
  if (lifecycle !== undefined && !(OPPORTUNITY_LIFECYCLES as readonly string[]).includes(lifecycle)) throw new RangeError('unknown lifecycle filter')
  if (fieldStatus !== undefined && fieldStatus !== 'missing' && fieldStatus !== 'unparseable') throw new RangeError('unknown field status filter')
  if (region !== undefined && region.length > 128) throw new RangeError('region exceeds 128 characters')
  if (sort !== undefined && sort !== 'published-desc' && sort !== 'amount-desc' && sort !== 'deadline-asc') throw new RangeError('unknown sort')
  return {
    page,
    pageSize,
    ...(query === undefined || query === '' ? {} : { query }),
    ...(source === undefined ? {} : { source: source as ArtifactRowsFilterV1['source'] }),
    ...(lifecycle === undefined ? {} : { lifecycle: lifecycle as ArtifactRowsFilterV1['lifecycle'] }),
    ...(fieldStatus === undefined ? {} : { fieldStatus }),
    ...(region === undefined || region === '' ? {} : { region }),
    ...(sort === undefined ? {} : { sort }),
  }
}

function filteredRows(rows: readonly NormalizedProjectV1[], filter: ArtifactRowsFilterV1): NormalizedProjectV1[] {
  const needle = filter.query?.toLocaleLowerCase('zh-CN')
  const filtered = rows.filter(row => {
    if (filter.source !== undefined && row.source !== filter.source) return false
    if (filter.lifecycle !== undefined && row.lifecycle !== filter.lifecycle) return false
    if (filter.region !== undefined && row.region.value !== filter.region && row.region.original !== filter.region) return false
    if (filter.fieldStatus === 'missing' && row.disclosure.missingFields.length === 0) return false
    if (filter.fieldStatus === 'unparseable' && row.disclosure.unparseableFields.length === 0) return false
    if (needle !== undefined) {
      const haystack = [row.title, row.counterparty.original, row.projectNumber.original, row.sourceId]
        .join('\n').toLocaleLowerCase('zh-CN')
      if (!haystack.includes(needle)) return false
    }
    return true
  })
  const sort = filter.sort ?? 'published-desc'
  return filtered.sort((left, right) => {
    if (sort === 'amount-desc') {
      const leftAmount = left.amount.maxCny ?? left.amount.minCny ?? -1
      const rightAmount = right.amount.maxCny ?? right.amount.minCny ?? -1
      if (leftAmount !== rightAmount) return rightAmount - leftAmount
    } else if (sort === 'deadline-asc') {
      const leftDeadline = left.deadline?.value ?? '9999'
      const rightDeadline = right.deadline?.value ?? '9999'
      if (leftDeadline !== rightDeadline) return leftDeadline.localeCompare(rightDeadline)
    } else {
      const leftPublished = left.publishedAt.value ?? ''
      const rightPublished = right.publishedAt.value ?? ''
      if (leftPublished !== rightPublished) return rightPublished.localeCompare(leftPublished)
    }
    return left.recordId.localeCompare(right.recordId)
  })
}

function classifiedRowsFilter(parameters: URLSearchParams): ClassifiedRowsFilterV1 {
  const page = positiveInteger(singleParameter(parameters, 'page'), 1)
  const pageSize = positiveInteger(singleParameter(parameters, 'pageSize'), 50)
  if (pageSize > 100) throw new RangeError('pageSize exceeds 100')
  const query = singleParameter(parameters, 'q')?.trim()
  const source = singleParameter(parameters, 'source')
  const classification = singleParameter(parameters, 'classification')
  const ruleId = singleParameter(parameters, 'ruleId')?.trim()
  const conflict = singleParameter(parameters, 'conflict')
  const fieldStatus = singleParameter(parameters, 'fieldStatus')
  if (query !== undefined && query.length > 200) throw new RangeError('query exceeds 200 characters')
  if (source !== undefined && !(TENDER_DATA_SOURCES as readonly string[]).includes(source)) throw new RangeError('unknown source filter')
  if (classification !== undefined && !(CLASSIFICATION_VALUES as readonly string[]).includes(classification)) throw new RangeError('unknown classification filter')
  if (ruleId !== undefined && ruleId.length > 128) throw new RangeError('ruleId exceeds 128 characters')
  if (conflict !== undefined && conflict !== 'true' && conflict !== 'false') throw new RangeError('unknown conflict filter')
  if (fieldStatus !== undefined && fieldStatus !== 'normalized' && fieldStatus !== 'missing' && fieldStatus !== 'unparseable') throw new RangeError('unknown field status filter')
  return {
    page,
    pageSize,
    ...(query === undefined || query === '' ? {} : { query }),
    ...(source === undefined ? {} : { source: source as ClassifiedRowsFilterV1['source'] }),
    ...(classification === undefined ? {} : { classification: classification as ClassifiedRowsFilterV1['classification'] }),
    ...(ruleId === undefined || ruleId === '' ? {} : { ruleId }),
    ...(conflict === undefined ? {} : { conflict: conflict === 'true' }),
    ...(fieldStatus === undefined ? {} : { fieldStatus }),
  }
}

function filteredClassifiedRows(
  rows: readonly ClassifiedRecordV1[],
  filter: ClassifiedRowsFilterV1,
): ClassifiedRecordV1[] {
  const needle = filter.query?.toLocaleLowerCase('zh-CN')
  return rows.filter(row => {
    const project = row.project
    if (filter.source !== undefined && project.source !== filter.source) return false
    if (filter.classification !== undefined && row.classification !== filter.classification) return false
    if (filter.ruleId !== undefined && !row.rawMatches.some(match => match.ruleId === filter.ruleId)) return false
    if (filter.conflict !== undefined && (row.conflictRuleIds.length > 0) !== filter.conflict) return false
    if (filter.fieldStatus === 'normalized' && (project.disclosure.missingFields.length > 0 || project.disclosure.unparseableFields.length > 0)) return false
    if (filter.fieldStatus === 'missing' && project.disclosure.missingFields.length === 0) return false
    if (filter.fieldStatus === 'unparseable' && project.disclosure.unparseableFields.length === 0) return false
    if (needle !== undefined) {
      const haystack = [project.title, project.counterparty.original, project.sourceId, ...row.rawMatches.map(match => match.ruleId)]
        .join('\n').toLocaleLowerCase('zh-CN')
      if (!haystack.includes(needle)) return false
    }
    return true
  }).sort((left, right) => left.project.recordId.localeCompare(right.project.recordId))
}

function reviewRowsFilter(parameters: URLSearchParams): ReviewRowsFilterV1 {
  const page = positiveInteger(singleParameter(parameters, 'page'), 1)
  const pageSize = positiveInteger(singleParameter(parameters, 'pageSize'), 50)
  if (pageSize > 100) throw new RangeError('pageSize exceeds 100')
  const query = singleParameter(parameters, 'q')?.trim()
  const source = singleParameter(parameters, 'source')
  const classification = singleParameter(parameters, 'classification')
  const recommendation = singleParameter(parameters, 'recommendation')
  const userDecision = singleParameter(parameters, 'userDecision')
  const deadlineStatus = singleParameter(parameters, 'deadlineStatus')
  if (query !== undefined && query.length > 200) throw new RangeError('query exceeds 200 characters')
  if (source !== undefined && !(TENDER_DATA_SOURCES as readonly string[]).includes(source)) throw new RangeError('unknown source filter')
  if (classification !== undefined && !(CLASSIFICATION_VALUES as readonly string[]).includes(classification)) throw new RangeError('unknown classification filter')
  if (recommendation !== undefined && recommendation !== 'unanalyzed' && !(AGENT_RECOMMENDATIONS as readonly string[]).includes(recommendation)) throw new RangeError('unknown recommendation filter')
  if (userDecision !== undefined && !(USER_DECISIONS as readonly string[]).includes(userDecision)) throw new RangeError('unknown user decision filter')
  if (deadlineStatus !== undefined && !(DEADLINE_STATUSES as readonly string[]).includes(deadlineStatus)) throw new RangeError('unknown deadline status filter')
  return {
    page,
    pageSize,
    ...(query === undefined || query === '' ? {} : { query }),
    ...(source === undefined ? {} : { source: source as ReviewRowsFilterV1['source'] }),
    ...(classification === undefined ? {} : { classification: classification as ReviewRowsFilterV1['classification'] }),
    ...(recommendation === undefined ? {} : { recommendation: recommendation as ReviewRowsFilterV1['recommendation'] }),
    ...(userDecision === undefined ? {} : { userDecision: userDecision as ReviewRowsFilterV1['userDecision'] }),
    ...(deadlineStatus === undefined ? {} : { deadlineStatus: deadlineStatus as ReviewRowsFilterV1['deadlineStatus'] }),
  }
}

function rowsForReview(kind: ArtifactRefV1['kind'], value: unknown): ReviewRecordV1[] {
  if (kind === 'review-data') return ReviewDatasetV1Schema.parse(value).rows
  if (kind === 'analysis-data') {
    return AnalysisDatasetV1Schema.parse(value).rows.map(row => ReviewRecordV1Schema.parse({
      ...row,
      review: { decision: 'pending', note: '' },
    }))
  }
  if (kind === 'classified-data') {
    return ClassifiedDatasetV1Schema.parse(value).rows.map(row => ReviewRecordV1Schema.parse({
      schemaVersion: 1,
      project: row.project,
      classification: row.classification,
      ...(row.finalRuleId === undefined ? {} : { finalRuleId: row.finalRuleId }),
      review: { decision: 'pending', note: '' },
    }))
  }
  return NormalizedDatasetV1Schema.parse(value).rows.map(project => ReviewRecordV1Schema.parse({
    schemaVersion: 1,
    project,
    review: { decision: 'pending', note: '' },
  }))
}

function deadlineStatus(row: ReviewRecordV1, now: number): 'active' | 'expired' | 'missing' {
  const value = row.project.deadline?.value
  if (value === undefined) return 'missing'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'missing'
  return parsed < now ? 'expired' : 'active'
}

function filteredReviewRows(rows: readonly ReviewRecordV1[], filter: ReviewRowsFilterV1): ReviewRecordV1[] {
  const needle = filter.query?.toLocaleLowerCase('zh-CN')
  const now = Date.now()
  return rows.filter(row => {
    if (filter.source !== undefined && row.project.source !== filter.source) return false
    if (filter.classification !== undefined && row.classification !== filter.classification) return false
    if (filter.recommendation === 'unanalyzed' && row.recommendation !== undefined) return false
    if (filter.recommendation !== undefined && filter.recommendation !== 'unanalyzed' && row.recommendation?.recommendation !== filter.recommendation) return false
    if (filter.userDecision !== undefined && row.review.decision !== filter.userDecision) return false
    if (filter.deadlineStatus !== undefined && deadlineStatus(row, now) !== filter.deadlineStatus) return false
    if (needle !== undefined) {
      const haystack = [row.project.title, row.project.counterparty.original, row.project.sourceId, row.review.note]
        .join('\n').toLocaleLowerCase('zh-CN')
      if (!haystack.includes(needle)) return false
    }
    return true
  }).sort((left, right) => left.project.recordId.localeCompare(right.project.recordId))
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replaceAll(/[^A-Za-z0-9._-]/gu, '_').slice(0, 128) || 'artifact'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

async function handleRows(
  res: ServerResponse,
  artifactId: string,
  kind: ArtifactRefV1['kind'],
  bytes: Buffer,
  parameters: URLSearchParams,
): Promise<void> {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new ArtifactManifestError('数据 Artifact 不是合法 JSON。')
  }
  if (kind === 'classified-data') {
    const dataset = ClassifiedDatasetV1Schema.parse(value)
    const filter = classifiedRowsFilter(parameters)
    const rows = filteredClassifiedRows(dataset.rows, filter)
    const maximumPage = Math.max(1, Math.ceil(rows.length / filter.pageSize))
    if (filter.page > maximumPage) {
      error(res, 416, 'page-out-of-range', '请求页超出当前筛选结果范围。')
      return
    }
    const start = (filter.page - 1) * filter.pageSize
    json(res, 200, ClassifiedRowsPageV1Schema.parse({
      schemaVersion: 1,
      artifactId,
      page: filter.page,
      pageSize: filter.pageSize,
      total: rows.length,
      rows: rows.slice(start, start + filter.pageSize),
    }))
    return
  }
  if (kind === 'analysis-data' || kind === 'review-data') {
    const filter = reviewRowsFilter(parameters)
    const rows = filteredReviewRows(rowsForReview(kind, value), filter)
    const maximumPage = Math.max(1, Math.ceil(rows.length / filter.pageSize))
    if (filter.page > maximumPage) {
      error(res, 416, 'page-out-of-range', '请求页超出当前筛选结果范围。')
      return
    }
    const start = (filter.page - 1) * filter.pageSize
    json(res, 200, ReviewRowsPageV1Schema.parse({
      schemaVersion: 1,
      artifactId,
      page: filter.page,
      pageSize: filter.pageSize,
      total: rows.length,
      rows: rows.slice(start, start + filter.pageSize),
    }))
    return
  }
  const dataset = NormalizedDatasetV1Schema.parse(value)
  const filter = rowsFilter(parameters)
  const rows = filteredRows(dataset.rows, filter)
  const maximumPage = Math.max(1, Math.ceil(rows.length / filter.pageSize))
  if (filter.page > maximumPage) {
    error(res, 416, 'page-out-of-range', '请求页超出当前筛选结果范围。')
    return
  }
  const start = (filter.page - 1) * filter.pageSize
  json(res, 200, ArtifactRowsPageV1Schema.parse({
    schemaVersion: 1,
    artifactId,
    page: filter.page,
    pageSize: filter.pageSize,
    total: rows.length,
    rows: rows.slice(start, start + filter.pageSize),
  }))
}

async function handleReviewRows(
  res: ServerResponse,
  artifactId: string,
  kind: ArtifactRefV1['kind'],
  bytes: Buffer,
  parameters: URLSearchParams,
): Promise<void> {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new ArtifactManifestError('复核数据 Artifact 不是合法 JSON。')
  }
  const filter = reviewRowsFilter(parameters)
  const rows = filteredReviewRows(rowsForReview(kind, value), filter)
  const maximumPage = Math.max(1, Math.ceil(rows.length / filter.pageSize))
  if (filter.page > maximumPage) {
    error(res, 416, 'page-out-of-range', '请求页超出当前筛选结果范围。')
    return
  }
  const start = (filter.page - 1) * filter.pageSize
  json(res, 200, ReviewRowsPageV1Schema.parse({
    schemaVersion: 1,
    artifactId,
    page: filter.page,
    pageSize: filter.pageSize,
    total: rows.length,
    rows: rows.slice(start, start + filter.pageSize),
  }))
}

export function createArtifactRouteHandler(services: ArtifactRouteServices) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.on('error', () => undefined)
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      error(res, 405, 'method-not-allowed', '只允许 GET。')
      return
    }
    const identity = artifactRequestIdentity(req)
    if (identity === undefined) {
      error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
      return
    }
    let requestUrl: URL
    try {
      requestUrl = new URL(req.url ?? '', `http://${identity.host}`)
    } catch {
      error(res, 400, 'invalid-request', '请求地址无效。')
      return
    }
    const suffix = requestUrl.pathname.slice(ARTIFACT_ROUTE_PREFIX.length)
    const parts = suffix.split('/').filter(Boolean)
    const artifactId = parts[0]
    const action = parts[1]
    if (parts.length !== 2 || artifactId === undefined || !/^a_[a-f0-9]{32}$/u.test(artifactId) || (action !== 'rows' && action !== 'review-rows' && action !== 'download' && action !== 'content')) {
      error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
      return
    }
    const session = services.sessions.get(identity.sessionId as SessionId)
    if (session === undefined) {
      error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
      return
    }
    const abort = new AbortController()
    const onAborted = () => { abort.abort(new Error('request aborted')) }
    const onClosed = () => { if (!res.writableEnded) abort.abort(new Error('response closed')) }
    req.once('aborted', onAborted)
    res.once('close', onClosed)
    try {
      const root = sessionArtifactRoot(services.sessionPersistence, session.header)
      const manifest = await readArtifactManifest(root)
      const entry = manifest.artifacts[artifactId]
      const expectedToken = entry?.accessToken ?? randomBytesFallback(32)
      if (!constantTokenEqual(identity.artifactToken, expectedToken) || entry === undefined) {
        error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
        return
      }
      if (action === 'rows' && entry.kind !== 'normalized-data' && entry.kind !== 'classified-data' && entry.kind !== 'analysis-data' && entry.kind !== 'review-data') {
        error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
        return
      }
      if (action === 'review-rows' && entry.kind !== 'normalized-data' && entry.kind !== 'classified-data' && entry.kind !== 'analysis-data' && entry.kind !== 'review-data') {
        error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
        return
      }
      if (action === 'content' && entry.kind !== 'rule-draft' && entry.kind !== 'rule-preview' && entry.kind !== 'rule-set') {
        error(res, 404, 'artifact-not-found', 'Artifact 不存在或不可访问。')
        return
      }
      const bytes = await readManifestArtifact(root, entry, abort.signal)
      if (action === 'rows') {
        await handleRows(res, artifactId, entry.kind, bytes, requestUrl.searchParams)
        return
      }
      if (action === 'review-rows') {
        await handleReviewRows(res, artifactId, entry.kind, bytes, requestUrl.searchParams)
        return
      }
      if (action === 'content') {
        if (bytes.byteLength > 2 * 1_024 * 1_024) throw new ArtifactManifestError('规则 Artifact 超出读取上限。')
        const content = RuleArtifactContentV1Schema.parse(JSON.parse(bytes.toString('utf8')) as unknown)
        json(res, 200, content)
        return
      }
      res.writeHead(200, {
        ...SAFE_HEADERS,
        'Content-Type': entry.mediaType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': contentDisposition(entry.fileName),
      })
      res.end(bytes)
    } catch (caught) {
      if (abort.signal.aborted || res.writableEnded || res.destroyed) return
      if (caught instanceof RangeError) {
        error(res, 400, 'invalid-request', caught.message)
      } else {
        error(res, 500, 'artifact-read-failed', 'Artifact 读取失败。')
      }
    } finally {
      req.off('aborted', onAborted)
      res.off('close', onClosed)
    }
  }
}

function randomBytesFallback(length: number): string {
  return createHash('sha256').update(`missing:${length}`, 'utf8').digest('base64url')
}
