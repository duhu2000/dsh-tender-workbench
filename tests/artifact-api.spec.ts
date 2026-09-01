import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { ArtifactApiError, fetchArtifactRows, type ArtifactFetch } from '../src/client/artifact-api.ts'

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
})
