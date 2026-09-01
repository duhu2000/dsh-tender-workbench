import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { JsonValue, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyCommandReceiptManifest } from '../src/host/artifacts/command-receipts.ts'
import { createArtifactRouteHandler } from '../src/host/artifacts/artifact-route.ts'
import {
  ArtifactManifestError,
  ArtifactTransaction,
  UnsupportedSessionPersistenceError,
  readArtifactManifest,
  resolveArtifactPath,
  sessionArtifactRoot,
} from '../src/host/artifacts/store.ts'
import { adaptQccProposedPayload, adaptQccTenderPayload } from '../src/host/pipeline/qcc-adapters.ts'
import { normalizeQccSources } from '../src/host/pipeline/normalize.ts'
import { classifyTenderProjects, createClassifiedDataset, createRulePreviewArtifact } from '../src/host/pipeline/classify.ts'
import { ruleDraftFingerprint } from '../src/contracts/screening.ts'
import type { TenderRuleV1 } from '../src/contracts/workflow.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function dataset() {
  const tender = adaptQccTenderPayload({
    查询摘要: { 命中总数: 2, 结果说明: 'loaded', 生效筛选: {} },
    标讯列表: [
      { 标讯ID: 't-1', 标题: '江苏数据项目', 信息类型: '招标公告', 公告子状态: '招标', 省市区: '江苏省', 招采单位: [], 项目编号: 'T-1', '预算金额（元）': '1000000', 发布时间: '2026-08-29', 投标截止时间: '2026-09-20' },
      { 标讯ID: 't-2', 标题: '上海云项目', 信息类型: '招标公告', 公告子状态: '招标', 省市区: '上海市', 招采单位: [], 项目编号: 'T-2', '预算金额（元）': '', 发布时间: '2026-08-28', 投标截止时间: '近期' },
    ],
  })
  const proposed = adaptQccProposedPayload({
    查询摘要: { 命中总数: 1, 结果说明: 'loaded', 生效筛选: {} },
    拟建项目列表: [{ 拟建项目ID: 'p-1', 项目名称: '浙江智算中心', 项目阶段: '项目备案', 审批进度: '审批中', 省市区: '浙江省', '项目总投资（元）': '2亿元', 发布时间: '2026-08-27', 建设单位: [], 项目编号: 'P-1' }],
  })
  return normalizeQccSources({
    tender,
    proposed,
    sources: {
      tender: { status: 'succeeded', loaded: 2 },
      proposed: { status: 'succeeded', loaded: 1 },
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  })
}

async function sessionFixture(id: string) {
  const root = await mkdtemp(join(tmpdir(), `dsh-artifact-${id}-`))
  roots.push(root)
  const transcript = join(root, 'session.jsonl.zstd')
  await writeFile(transcript, 'transcript-sentinel', 'utf8')
  const header: SessionHeader = { version: 0, id: id as SessionId, createdAt: 1 }
  return { root, transcript, header, session: { id: header.id, header } }
}

async function listen(handler: ReturnType<typeof createArtifactRouteHandler>) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  return { server, port: address.port }
}

interface ResponseResult {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

async function get(port: number, path: string, headers: Record<string, string | string[]> = {}, method = 'GET'): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method, headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers as ResponseResult['headers'],
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.once('error', reject)
    request.end()
  })
}

describe('Session-private Artifact service', () => {
  it('uses locate(), isolates Sessions, preserves the transcript, and commits manifest entries atomically', async () => {
    const first = await sessionFixture('session-a')
    const second = await sessionFixture('session-b')
    const persistence = {
      locate: (header: SessionHeader) => ({ kind: 'jsonl', path: header.id === first.header.id ? first.transcript : second.transcript }),
    }
    const firstRoot = sessionArtifactRoot(persistence, first.header)
    const secondRoot = sessionArtifactRoot(persistence, second.header)
    expect(firstRoot).not.toBe(secondRoot)

    const transaction = new ArtifactTransaction(firstRoot)
    await transaction.load()
    const ref = await transaction.stageJson('normalized-data', 'dataset.json', json(dataset()), 3)
    await transaction.save(emptyCommandReceiptManifest())
    const manifest = await readArtifactManifest(firstRoot)
    expect(manifest.artifacts[ref.id]).toMatchObject({ id: ref.id, kind: 'normalized-data', rowCount: 3 })
    expect(await readArtifactManifest(secondRoot)).toEqual({ schemaVersion: 1, artifacts: {}, receipts: {} })
    expect(await readFile(first.transcript, 'utf8')).toBe('transcript-sentinel')
    expect(await readFile(second.transcript, 'utf8')).toBe('transcript-sentinel')
  })

  it('fails closed for missing/non-JSONL locations and path traversal', async () => {
    const fixture = await sessionFixture('unsupported')
    expect(() => sessionArtifactRoot({ locate: () => undefined }, fixture.header)).toThrow(UnsupportedSessionPersistenceError)
    expect(() => sessionArtifactRoot({ locate: () => ({ kind: 'sqlite', path: fixture.transcript }) }, fixture.header)).toThrow(UnsupportedSessionPersistenceError)
    expect(() => resolveArtifactPath(join(fixture.root, 'plugin'), '../session.jsonl')).toThrow(ArtifactManifestError)
    expect(() => resolveArtifactPath(join(fixture.root, 'plugin'), 'datasets\\escape.json')).toThrow(ArtifactManifestError)
    const artifactRoot = sessionArtifactRoot({ locate: () => ({ kind: 'jsonl', path: fixture.transcript }) }, fixture.header)
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(join(artifactRoot, 'manifest.json'), '{"schemaVersion":1,"artifacts":"broken"}', 'utf8')
    await expect(readArtifactManifest(artifactRoot)).rejects.toBeInstanceOf(ArtifactManifestError)
  })

  it('serves authenticated same-origin rows with filtering/pagination and rejects unsafe requests', async () => {
    const first = await sessionFixture('session-http-a')
    const second = await sessionFixture('session-http-b')
    const persistence = {
      locate: (header: SessionHeader) => ({ kind: 'jsonl', path: header.id === first.header.id ? first.transcript : second.transcript }),
    }
    const transaction = new ArtifactTransaction(sessionArtifactRoot(persistence, first.header))
    await transaction.load()
    const ref = await transaction.stageJson('normalized-data', 'dataset.json', json(dataset()), 3)
    await transaction.save(emptyCommandReceiptManifest())
    const sessions = {
      get: (id: SessionId) => id === first.header.id ? first.session : id === second.header.id ? second.session : undefined,
    }
    const { port } = await listen(createArtifactRouteHandler({ sessions: sessions as never, sessionPersistence: persistence }))
    const authority = `127.0.0.1:${port}`
    const headers = {
      Origin: `http://${authority}`,
      'Sec-Fetch-Site': 'same-origin',
      'X-Dsh-Tender-Session': String(first.header.id),
      'X-Dsh-Tender-Artifact-Token': ref.accessToken,
    }
    const page = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows?page=1&pageSize=1&source=tender&fieldStatus=missing&sort=amount-desc`, headers)
    expect(page.status).toBe(200)
    expect(JSON.parse(page.body)).toMatchObject({ page: 1, pageSize: 1, total: 2 })
    expect(page.headers['cache-control']).toBe('private, no-store')
    expect(page.headers['x-content-type-options']).toBe('nosniff')

    const proposed = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows?page=1&pageSize=50&source=proposed&q=%E6%99%BA%E7%AE%97`, headers)
    expect(JSON.parse(proposed.body)).toMatchObject({ total: 1, rows: [{ source: 'proposed', sourceId: 'p-1' }] })
    const overflow = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows?page=99&pageSize=1`, headers)
    expect(overflow.status).toBe(416)

    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, { ...headers, 'X-Dsh-Tender-Artifact-Token': 'wrong' })).status).toBe(404)
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, { ...headers, Origin: 'http://evil.example' })).status).toBe(404)
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status).toBe(404)
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, { ...headers, 'X-Dsh-Tender-Session': String(second.header.id) })).status).toBe(404)
    expect((await get(port, '/dsh-tender-workbench/api/v1/artifacts/../../session.jsonl/rows', headers)).status).toBe(404)
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, headers, 'POST')).status).toBe(405)

    const duplicateHeaders = { ...headers, 'X-Dsh-Tender-Session': [String(first.header.id), String(first.header.id)] }
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, duplicateHeaders)).status).toBe(404)

    const download = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/download`, headers)
    expect(download.status).toBe(200)
    expect(download.headers['content-disposition']).toContain('attachment')
    expect(download.body).toContain('normalizedProjectCount')
  })

  it('contains an aborted request and continues serving later requests', async () => {
    const fixture = await sessionFixture('session-abort')
    const persistence = { locate: () => ({ kind: 'jsonl', path: fixture.transcript }) }
    const transaction = new ArtifactTransaction(sessionArtifactRoot(persistence, fixture.header))
    await transaction.load()
    const ref = await transaction.stageJson('normalized-data', 'dataset.json', json(dataset()), 3)
    await transaction.save(emptyCommandReceiptManifest())
    const { port } = await listen(createArtifactRouteHandler({
      sessions: { get: () => fixture.session } as never,
      sessionPersistence: persistence,
    }))
    const headers = {
      Origin: `http://127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
      'X-Dsh-Tender-Session': String(fixture.header.id),
      'X-Dsh-Tender-Artifact-Token': ref.accessToken,
    }
    await new Promise<void>(resolve => {
      const request = httpRequest({ host: '127.0.0.1', port, path: `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, headers })
      request.on('error', () => resolve())
      request.end()
      request.destroy()
      setTimeout(resolve, 20)
    })
    const next = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${ref.id}/rows`, headers)
    expect(next.status).toBe(200)
  })

  it('serves S3 rule content and filterable classified rows without exposing either across Sessions', async () => {
    const first = await sessionFixture('session-s3-a')
    const second = await sessionFixture('session-s3-b')
    const persistence = {
      locate: (header: SessionHeader) => ({ kind: 'jsonl', path: header.id === first.header.id ? first.transcript : second.transcript }),
    }
    const normalized = dataset()
    const rules: readonly TenderRuleV1[] = [
      { id: 'include-data', name: '数据项目', enabled: true, action: 'include', sources: ['tender'], scope: 'title', keywords: ['数据'], priority: 100, exceptions: [], reason: '当前目标' },
      { id: 'observe-cloud', name: '云项目', enabled: true, action: 'observe', sources: ['tender'], scope: 'title', keywords: ['云'], priority: 90, exceptions: [], reason: '继续观察' },
    ]
    const run = classifyTenderProjects(normalized.rows, rules)
    const fingerprint = ruleDraftFingerprint(rules)
    const transaction = new ArtifactTransaction(sessionArtifactRoot(persistence, first.header))
    await transaction.load()
    const classified = await transaction.stageJson('classified-data', 'classified.json', json(createClassifiedDataset({
      activeDatasetId: 'active-data', ruleSetVersion: 'rsv-1', classifiedAt: '2026-09-01T00:00:00.000Z', run,
    })), run.total)
    const preview = await transaction.stageJson('rule-preview', 'preview.json', json(createRulePreviewArtifact({
      activeDatasetId: 'active-data', basedOnRevision: 1, stateRevision: 2, draftFingerprint: fingerprint, origin: 'user', run,
    })))
    await transaction.save(emptyCommandReceiptManifest())
    const sessions = { get: (id: SessionId) => id === first.header.id ? first.session : id === second.header.id ? second.session : undefined }
    const { port } = await listen(createArtifactRouteHandler({ sessions: sessions as never, sessionPersistence: persistence }))
    const baseHeaders = {
      Origin: `http://127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
      'X-Dsh-Tender-Session': String(first.header.id),
    }
    const classifiedHeaders = { ...baseHeaders, 'X-Dsh-Tender-Artifact-Token': classified.accessToken }
    const rows = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${classified.id}/rows?page=1&pageSize=50&classification=include&ruleId=include-data&conflict=false&fieldStatus=missing`, classifiedHeaders)
    expect(rows.status).toBe(200)
    expect(JSON.parse(rows.body)).toMatchObject({ total: 1, rows: [{ classification: 'include', finalRuleId: 'include-data', project: { title: '江苏数据项目', dataDisposition: 'normalized' } }] })

    const previewHeaders = { ...baseHeaders, 'X-Dsh-Tender-Artifact-Token': preview.accessToken }
    const content = await get(port, `/dsh-tender-workbench/api/v1/artifacts/${preview.id}/content`, previewHeaders)
    expect(content.status).toBe(200)
    expect(JSON.parse(content.body)).toMatchObject({ activeDatasetId: 'active-data', draftFingerprint: fingerprint, total: 3 })
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${classified.id}/content`, classifiedHeaders)).status).toBe(404)
    expect((await get(port, `/dsh-tender-workbench/api/v1/artifacts/${preview.id}/content`, { ...previewHeaders, 'X-Dsh-Tender-Session': String(second.header.id) })).status).toBe(404)
  })
})
