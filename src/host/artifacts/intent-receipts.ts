import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { TenderActionToolName } from '../../contracts/orchestration.ts'

export type { JsonValue } from '@deepseek-ai/dsh-session'

export interface IntentReceiptV2<Result extends JsonValue = JsonValue> {
  readonly receiptId: string
  readonly intentId: string
  readonly tool: TenderActionToolName
  readonly batchId?: string
  readonly fingerprint: string
  readonly previousRevision: number
  readonly resultRevision: number
  readonly result: Result
}

export interface IntentReceiptManifestV2<Result extends JsonValue = JsonValue> {
  readonly schemaVersion: 2
  readonly receipts: Readonly<Record<string, IntentReceiptV2<Result>>>
}

export interface IntentReceiptStore<Result extends JsonValue> {
  load(): Promise<IntentReceiptManifestV2<Result>>
  save(manifest: IntentReceiptManifestV2<Result>): Promise<void>
}

export interface IdempotentIntent<Result extends JsonValue> {
  readonly intentId: string
  readonly tool: TenderActionToolName
  readonly batchId?: string
  readonly arguments: JsonValue
  readonly observedProjectionRevision: number
  readonly store: IntentReceiptStore<Result>
  execute(nextRevision: number): Promise<Result>
  revisionOf(result: Result): number
}

export interface IdempotentIntentResult<Result extends JsonValue> {
  readonly receiptId: string
  readonly result: Result
  readonly replayed: boolean
}

export class IntentReceiptCollisionError extends Error {
  constructor(receiptId: string) {
    super(`receipt ${JSON.stringify(receiptId)} was already used with different arguments`)
    this.name = 'IntentReceiptCollisionError'
  }
}

export class PendingIntentReceiptError extends Error {
  constructor(readonly receiptId: string, readonly resultRevision: number) {
    super(`receipt ${JSON.stringify(receiptId)} is committed at revision ${resultRevision} but the Session projection has not observed it`)
    this.name = 'PendingIntentReceiptError'
  }
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, JsonValue>)[key] as JsonValue)}`).join(',')}}`
}

export function intentFingerprint(argumentsValue: JsonValue): string {
  return createHash('sha256').update(stableJson(argumentsValue), 'utf8').digest('hex')
}

export function deriveReceiptId(
  tool: TenderActionToolName,
  intentId: string,
  batchId?: string,
): string {
  const material = JSON.stringify([tool, intentId, batchId ?? null])
  return `receipt_${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 48)}`
}

export function emptyIntentReceiptManifest<Result extends JsonValue>(): IntentReceiptManifestV2<Result> {
  return { schemaVersion: 2, receipts: {} }
}

/** Session-keyed serial commit boundary for mutating workbench actions. */
export class IntentReceiptCoordinator {
  private readonly tails = new Map<string, Promise<void>>()

  async run<Result extends JsonValue>(
    sessionKey: string,
    intent: IdempotentIntent<Result>,
  ): Promise<IdempotentIntentResult<Result>> {
    const previous = this.tails.get(sessionKey) ?? Promise.resolve()
    const task = previous.then(() => this.commit(intent))
    const tail = task.then(() => undefined, () => undefined)
    this.tails.set(sessionKey, tail)
    try {
      return await task
    } finally {
      if (this.tails.get(sessionKey) === tail) this.tails.delete(sessionKey)
    }
  }

  private async commit<Result extends JsonValue>(
    intent: IdempotentIntent<Result>,
  ): Promise<IdempotentIntentResult<Result>> {
    if (intent.intentId.length === 0 || intent.intentId.length > 128) {
      throw new RangeError('intentId must contain 1-128 characters')
    }
    if (!Number.isSafeInteger(intent.observedProjectionRevision) || intent.observedProjectionRevision < 0) {
      throw new RangeError('observedProjectionRevision must be a non-negative safe integer')
    }
    const manifest = await intent.store.load()
    if (manifest.schemaVersion !== 2) throw new TypeError('unsupported intent receipt manifest')
    const receiptId = deriveReceiptId(intent.tool, intent.intentId, intent.batchId)
    const fingerprint = intentFingerprint(intent.arguments)
    const existing = manifest.receipts[receiptId]
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new IntentReceiptCollisionError(receiptId)
      return { receiptId, result: existing.result, replayed: true }
    }
    const pending = Object.values(manifest.receipts)
      .find(receipt => receipt.resultRevision > intent.observedProjectionRevision)
    if (pending !== undefined) throw new PendingIntentReceiptError(pending.receiptId, pending.resultRevision)

    const nextRevision = intent.observedProjectionRevision + 1
    const result = await intent.execute(nextRevision)
    const resultRevision = intent.revisionOf(result)
    if (resultRevision !== nextRevision) {
      throw new Error(`mutating action must produce revision ${nextRevision}, got ${resultRevision}`)
    }
    const receipt: IntentReceiptV2<Result> = {
      receiptId,
      intentId: intent.intentId,
      tool: intent.tool,
      ...(intent.batchId === undefined ? {} : { batchId: intent.batchId }),
      fingerprint,
      previousRevision: intent.observedProjectionRevision,
      resultRevision,
      result,
    }
    await intent.store.save({
      schemaVersion: 2,
      receipts: { ...manifest.receipts, [receiptId]: receipt },
    })
    return { receiptId, result, replayed: false }
  }
}
