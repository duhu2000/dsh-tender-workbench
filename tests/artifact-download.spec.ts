// @vitest-environment jsdom
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadArtifact, type ArtifactFetch } from '../src/client/artifact-api.ts'

afterEach(() => { vi.restoreAllMocks() })

describe('report artifact download', () => {
  it('uses Session identity headers, clicks an opaque download, and releases the Blob URL', async () => {
    const artifact = {
      id: 'a_0123456789abcdef0123456789abcdef', kind: 'pdf' as const,
      fileName: '招投标报告.pdf', mediaType: 'application/pdf',
      createdAt: '2026-09-02T00:00:00.000Z', accessToken: 'download-token',
    }
    const fetcher = vi.fn<ArtifactFetch>(async () => new Response(new Blob(['%PDF-test'], { type: 'application/pdf' }), { status: 200 }))
    const createObjectURL = vi.fn(() => 'blob:report-download')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await downloadArtifact(fetcher, 'session-download' as SessionId, artifact)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(String(url)).toContain(`/${artifact.id}/download`)
    expect(String(url)).not.toContain('download-token')
    expect(init?.headers).toMatchObject({
      'X-Dsh-Tender-Session': 'session-download',
      'X-Dsh-Tender-Artifact-Token': 'download-token',
    })
    expect(click).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report-download')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
