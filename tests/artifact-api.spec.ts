import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import {
  ArtifactApiError,
  fetchArtifactRows,
  fetchClassifiedArtifactRows,
  fetchReviewArtifactRows,
  fetchReportDeliveryView,
  fetchRuleArtifactContent,
  type ArtifactFetch,
} from '../src/client/artifact-api.ts'

const artifact = {
  id: 'a_0123456789abcdef0123456789abcdef',
  kind: 'normalized-data' as const,
  fileName: 'dataset.json',
  mediaType: 'application/json',
  rowCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  accessToken: 'secret-token',
}

describe('Client Artifact rows API', () => {
  it('keeps Session identity and the capability token in same-origin headers, never the URL', async () => {
    const fetcher = vi.fn<ArtifactFetch>(async (_input, _init) => new Response(JSON.stringify({
      schemaVersion: 1,
      artifactId: artifact.id,
      page: 1,
      pageSize: 50,
      total: 0,
      rows: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const page = await fetchArtifactRows(
      fetcher,
      'session-1' as SessionId,
      artifact,
      { page: 1, pageSize: 50, source: 'tender', fieldStatus: 'missing' },
    )
    expect(page.total).toBe(0)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(String(url)).toContain('/rows?page=1&pageSize=50&source=tender&fieldStatus=missing')
    expect(String(url)).not.toContain('secret-token')
    expect(init).toMatchObject({
      method: 'GET', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: {
        'X-Dsh-Tender-Session': 'session-1',
        'X-Dsh-Tender-Artifact-Token': 'secret-token',
      },
    })
  })

  it('rejects HTTP failures and incompatible rows payloads', async () => {
    await expect(fetchArtifactRows(
      async () => new Response('{}', { status: 404 }),
      'session-1' as SessionId,
      artifact,
      { page: 1, pageSize: 50 },
    )).rejects.toBeInstanceOf(ArtifactApiError)
    await expect(fetchArtifactRows(
      async () => new Response('{"rows":"invalid"}', { status: 200 }),
      'session-1' as SessionId,
      artifact,
      { page: 1, pageSize: 50 },
    )).rejects.toThrow()
  })

  it('reads only validated classified pages and bounded rule content through the same header boundary', async () => {
    const classified = { ...artifact, id: 'a_11111111111111111111111111111111', kind: 'classified-data' as const, accessToken: 'classified-token' }
    const fetchRows = vi.fn<ArtifactFetch>(async () => new Response(JSON.stringify({
      schemaVersion: 1, artifactId: classified.id, page: 1, pageSize: 50, total: 0,
      datasetTotal: 0, covered: 0, conflicts: 0, rawMatches: 0,
      counts: { include: 0, observe: 0, manualReview: 0, exclude: 0, unmatched: 0 },
      ruleImpacts: [], rows: [],
    }), { status: 200 }))
    await fetchClassifiedArtifactRows(fetchRows, 'session-1' as SessionId, classified, {
      page: 1, pageSize: 50, classification: 'include', ruleId: 'r1', conflict: true, fieldStatus: 'missing',
    })
    const [rowsUrl, rowsInit] = fetchRows.mock.calls[0] ?? []
    expect(String(rowsUrl)).toContain('classification=include&ruleId=r1&conflict=true&fieldStatus=missing')
    expect(String(rowsUrl)).not.toContain('classified-token')
    expect(rowsInit?.headers).toMatchObject({ 'X-Dsh-Tender-Artifact-Token': 'classified-token' })

    const review = { ...artifact, id: 'a_12121212121212121212121212121212', kind: 'review-data' as const, accessToken: 'review-token' }
    const fetchReview = vi.fn<ArtifactFetch>(async () => new Response(JSON.stringify({
      schemaVersion: 1, artifactId: review.id, page: 1, pageSize: 20, total: 0, pending: 0, reviewed: 0,
      facets: { regions: [], stages: [], procurementMethods: [], procurementTypes: [], ruleIds: [] },
      audit: [], rows: [],
    }), { status: 200 }))
    await fetchReviewArtifactRows(fetchReview, 'session-1' as SessionId, review, {
      page: 1, pageSize: 20, queue: 'pending', sort: 'recommendation', query: '数据方向', queryRuleIds: ['rule-data', 'rule-cloud'],
    })
    const [reviewUrl, reviewInit] = fetchReview.mock.calls[0] ?? []
    expect(String(reviewUrl)).toContain('queue=pending&sort=recommendation&q=')
    expect(String(reviewUrl)).toContain('queryRuleId=rule-data&queryRuleId=rule-cloud')
    expect(reviewInit?.headers).toMatchObject({ 'X-Dsh-Tender-Artifact-Token': 'review-token' })

    const rule = { ...artifact, id: 'a_22222222222222222222222222222222', kind: 'rule-draft' as const, accessToken: 'rule-token' }
    const contentValue = {
      schemaVersion: 1, activeDatasetId: artifact.id, basedOnRevision: 1,
      draftFingerprint: 'r_0000000000000000', origin: 'user',
      rules: [{ id: 'r1', name: '数据', enabled: true, action: 'include', sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 1, exceptions: [], reason: '用户目标' }],
    }
    const fetchContent = vi.fn<ArtifactFetch>(async () => new Response(JSON.stringify(contentValue), { status: 200 }))
    expect(await fetchRuleArtifactContent(fetchContent, 'session-1' as SessionId, rule)).toEqual(contentValue)
    const [contentUrl, contentInit] = fetchContent.mock.calls[0] ?? []
    expect(String(contentUrl)).toContain(`/${rule.id}/content`)
    expect(String(contentUrl)).not.toContain('rule-token')
    expect(contentInit?.headers).toMatchObject({ 'X-Dsh-Tender-Artifact-Token': 'rule-token' })
  })

  it('reads a validated bounded report view only from a final snapshot', async () => {
    const snapshot = { ...artifact, id: 'a_33333333333333333333333333333333', kind: 'final-snapshot' as const, accessToken: 'report-token' }
    const amount = (source: 'tender' | 'proposed', amountType: 'budget' | 'total-investment') => ({
      source, amountType, eligibleCount: 0, singleValueCount: 0, bandedRangeCount: 0,
      indeterminateCount: 0, missingCount: 0, unparseableCount: 0,
      bands: [{ id: 'low', label: '低', count: 0 }, { id: 'middle', label: '中', count: 0 }, { id: 'high', label: '高', count: 0 }],
      limitation: '只展示可用事实。',
    })
    const value = {
      schemaVersion: 1,
      finalSnapshotId: 'snapshot-v2',
      createdAt: '2026-09-03T10:00:00.000+08:00',
      timeZone: 'Asia/Shanghai',
      completeness: 'complete',
      query: { scope: 'combined', targetSummary: '金融科技', sources: {} },
      rulesIncluded: false,
      analysisIncluded: false,
      analysisCoverage: { completed: 0, total: 0 },
      metricDefinitions: [{ id: 'raw-records', label: '来源记录', description: '来源记录。', unit: 'record', scopeDescription: '当前范围。' }],
      metricValues: [{ metricId: 'raw-records', value: 0 }],
      distributions: [{ id: 'review-decisions', label: '人工确认结果', scopeDescription: '当前范围。', buckets: [] }],
      amountDistributions: [amount('tender', 'budget'), amount('proposed', 'total-investment')],
      homepageRecords: [],
      priorityRecords: [],
      limitations: ['不推断缺失事实。'],
    }
    const fetcher = vi.fn<ArtifactFetch>(async () => new Response(JSON.stringify(value), { status: 200 }))
    expect(await fetchReportDeliveryView(fetcher, 'session-1' as SessionId, snapshot)).toEqual(value)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(String(url)).toContain(`/${snapshot.id}/report-view`)
    expect(String(url)).not.toContain('report-token')
    expect(init?.headers).toMatchObject({
      'X-Dsh-Tender-Session': 'session-1',
      'X-Dsh-Tender-Artifact-Token': 'report-token',
    })
    await expect(fetchReportDeliveryView(fetcher, 'session-1' as SessionId, artifact)).rejects.toThrow(/final-snapshot/u)
    await expect(fetchReportDeliveryView(
      async () => new Response('{"schemaVersion":1}', { status: 200 }),
      'session-1' as SessionId,
      snapshot,
    )).rejects.toThrow()
  })
})
