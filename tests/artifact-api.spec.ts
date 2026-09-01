import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import {
  ArtifactApiError,
  fetchArtifactRows,
  fetchClassifiedArtifactRows,
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
      schemaVersion: 1, artifactId: classified.id, page: 1, pageSize: 50, total: 0, rows: [],
    }), { status: 200 }))
    await fetchClassifiedArtifactRows(fetchRows, 'session-1' as SessionId, classified, {
      page: 1, pageSize: 50, classification: 'include', ruleId: 'r1', conflict: true, fieldStatus: 'missing',
    })
    const [rowsUrl, rowsInit] = fetchRows.mock.calls[0] ?? []
    expect(String(rowsUrl)).toContain('classification=include&ruleId=r1&conflict=true&fieldStatus=missing')
    expect(String(rowsUrl)).not.toContain('classified-token')
    expect(rowsInit?.headers).toMatchObject({ 'X-Dsh-Tender-Artifact-Token': 'classified-token' })

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
})
