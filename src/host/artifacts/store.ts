import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { SessionHeader, JsonValue } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import {
  ArtifactRefV1Schema,
  type ArtifactRefV1,
} from '../../contracts/workflow.ts'
import {
  type CommandReceiptManifestV1,
  type CommandReceiptStore,
} from './command-receipts.ts'

export const ARTIFACT_PLUGIN_DIRECTORY = 'dsh-tender-workbench'
export const ARTIFACT_LAYOUT_VERSION = 'v1'

export interface SessionPersistenceLocator {
  locate(header: SessionHeader): { readonly kind: string; readonly path: string } | undefined
}

export interface ArtifactManifestEntryV1 extends ArtifactRefV1 {
  readonly relativePath: string
  readonly size: number
  readonly sha256: string
}

export interface ArtifactManifestV1 {
  readonly schemaVersion: 1
  readonly artifacts: Readonly<Record<string, ArtifactManifestEntryV1>>
  readonly receipts: CommandReceiptManifestV1<JsonValue>['receipts']
}

const manifestEntrySchema = ArtifactRefV1Schema.extend({
  relativePath: z.string().min(1).max(512).regex(/^[^\\/]+(?:\/[^\\/]+)+$/u),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()

const receiptSchema = z.object({
  commandId: z.string().min(1).max(128),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  previousRevision: z.number().int().nonnegative(),
  resultRevision: z.number().int().positive(),
  result: z.unknown(),
}).strict()

const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifacts: z.record(z.string(), manifestEntrySchema),
  receipts: z.record(z.string(), receiptSchema),
}).strict()

export class UnsupportedSessionPersistenceError extends Error {
  constructor(message = '当前 Session Persistence 不支持招投标 Artifact。') {
    super(message)
    this.name = 'UnsupportedSessionPersistenceError'
  }
}

export class ArtifactManifestError extends Error {
  constructor(message = '招投标 Artifact manifest 无法读取。') {
    super(message)
    this.name = 'ArtifactManifestError'
  }
}

export function sessionArtifactRoot(
  persistence: SessionPersistenceLocator,
  header: SessionHeader,
): string {
  const location = persistence.locate(header)
  if (location === undefined || location.kind !== 'jsonl' || !isAbsolute(location.path)) {
    throw new UnsupportedSessionPersistenceError()
  }
  const sessionRoot = dirname(resolve(location.path))
  if (!isAbsolute(sessionRoot)) throw new UnsupportedSessionPersistenceError()
  return resolve(sessionRoot, ARTIFACT_PLUGIN_DIRECTORY, ARTIFACT_LAYOUT_VERSION)
}

export function resolveArtifactPath(root: string, relativePath: string): string {
  if (!isAbsolute(root) || relativePath.includes('\\') || relativePath.startsWith('/')) {
    throw new ArtifactManifestError('Artifact 路径不安全。')
  }
  const target = resolve(root, ...relativePath.split('/'))
  const relation = relative(root, target)
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new ArtifactManifestError('Artifact 路径越界。')
  }
  return target
}

function emptyManifest(): ArtifactManifestV1 {
  return { schemaVersion: 1, artifacts: {}, receipts: {} }
}

function manifestPath(root: string): string {
  return resolve(root, 'manifest.json')
}

export async function readArtifactManifest(root: string): Promise<ArtifactManifestV1> {
  let raw: string
  try {
    raw = await readFile(manifestPath(root), 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return emptyManifest()
    throw new ArtifactManifestError()
  }
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new ArtifactManifestError()
  }
  const parsed = artifactManifestSchema.safeParse(value)
  if (!parsed.success) throw new ArtifactManifestError()
  return parsed.data as ArtifactManifestV1
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function writeManifest(root: string, manifest: ArtifactManifestV1): Promise<void> {
  const parsed = artifactManifestSchema.parse(manifest)
  await atomicWrite(manifestPath(root), Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8'))
}

function artifactDirectory(kind: ArtifactRefV1['kind']): 'source' | 'datasets' | 'snapshots' | 'reports' {
  if (kind === 'source-data') return 'source'
  if (kind === 'normalized-data' || kind === 'classified-data' || kind === 'analysis-data' || kind === 'review-data') return 'datasets'
  if (kind === 'excel' || kind === 'pdf') return 'reports'
  return 'snapshots'
}

/** One serialized command transaction. Files become reachable only with the atomic manifest commit. */
export class ArtifactTransaction implements CommandReceiptStore<JsonValue> {
  private base?: ArtifactManifestV1
  private readonly staged = new Map<string, ArtifactManifestEntryV1>()

  constructor(readonly root: string) {}

  async load(): Promise<CommandReceiptManifestV1<JsonValue>> {
    this.base = await readArtifactManifest(this.root)
    return { schemaVersion: 1, receipts: structuredClone(this.base.receipts) }
  }

  async save(receipts: CommandReceiptManifestV1<JsonValue>): Promise<void> {
    if (this.base === undefined) throw new ArtifactManifestError('Artifact 事务尚未加载 manifest。')
    await writeManifest(this.root, {
      schemaVersion: 1,
      artifacts: {
        ...this.base.artifacts,
        ...Object.fromEntries(this.staged),
      },
      receipts: receipts.receipts,
    })
  }

  async stageJson(
    kind: ArtifactRefV1['kind'],
    fileName: string,
    value: JsonValue,
    rowCount?: number,
  ): Promise<ArtifactRefV1> {
    if (this.base === undefined) throw new ArtifactManifestError('Artifact 事务尚未加载 manifest。')
    const id = `a_${randomBytes(16).toString('hex')}`
    const accessToken = randomBytes(32).toString('base64url')
    const createdAt = new Date().toISOString()
    const relativePath = `${artifactDirectory(kind)}/${id}.json`
    const path = resolveArtifactPath(this.root, relativePath)
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    await atomicWrite(path, bytes)
    const entry: ArtifactManifestEntryV1 = {
      id,
      kind,
      fileName,
      mediaType: 'application/json',
      ...(rowCount === undefined ? {} : { rowCount }),
      createdAt,
      accessToken,
      relativePath,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    this.staged.set(id, entry)
    return ArtifactRefV1Schema.parse({
      id: entry.id,
      kind: entry.kind,
      fileName: entry.fileName,
      mediaType: entry.mediaType,
      ...(entry.rowCount === undefined ? {} : { rowCount: entry.rowCount }),
      createdAt: entry.createdAt,
      accessToken: entry.accessToken,
    })
  }

  async readJsonArtifact(id: string, expectedKind: ArtifactRefV1['kind']): Promise<unknown> {
    if (this.base === undefined) throw new ArtifactManifestError('Artifact 事务尚未加载 manifest。')
    const entry = this.base.artifacts[id]
    if (entry === undefined || entry.kind !== expectedKind) {
      throw new ArtifactManifestError('Artifact 不存在、类型不匹配或不属于当前 Session。')
    }
    const bytes = await readManifestArtifact(this.root, entry)
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown
    } catch {
      throw new ArtifactManifestError('Artifact 不是合法 JSON。')
    }
  }
}

export function createArtifactTransaction(
  persistence: SessionPersistenceLocator,
  header: SessionHeader,
): ArtifactTransaction {
  return new ArtifactTransaction(sessionArtifactRoot(persistence, header))
}

export async function readManifestArtifact(
  root: string,
  entry: ArtifactManifestEntryV1,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted()
  const path = resolveArtifactPath(root, entry.relativePath)
  const info = await stat(path)
  if (!info.isFile() || info.size !== entry.size) throw new ArtifactManifestError('Artifact 文件与 manifest 不一致。')
  const bytes = await readFile(path, { signal })
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== entry.sha256) throw new ArtifactManifestError('Artifact 文件校验失败。')
  return bytes
}
