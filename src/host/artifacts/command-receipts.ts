import { createHash } from 'node:crypto'

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface CommandReceiptV1<Result extends JsonValue = JsonValue> {
  readonly commandId: string
  readonly fingerprint: string
  readonly previousRevision: number
  readonly resultRevision: number
  readonly result: Result
}

export interface CommandReceiptManifestV1<Result extends JsonValue = JsonValue> {
  readonly schemaVersion: 1
  readonly receipts: Readonly<Record<string, CommandReceiptV1<Result>>>
}

export interface CommandReceiptStore<Result extends JsonValue> {
  load(): Promise<CommandReceiptManifestV1<Result>>
  /** Implementations must commit with write-then-atomic-replace semantics. */
  save(manifest: CommandReceiptManifestV1<Result>): Promise<void>
}

export interface IdempotentCommand<Result extends JsonValue> {
  readonly commandId: string
  readonly arguments: JsonValue
  readonly observedProjectionRevision: number
  readonly store: CommandReceiptStore<Result>
  execute(nextRevision: number): Promise<Result>
  revisionOf(result: Result): number
}

export interface IdempotentCommandResult<Result extends JsonValue> {
  readonly result: Result
  readonly replayed: boolean
}

export class CommandIdCollisionError extends Error {
  constructor(commandId: string) {
    super(`commandId ${JSON.stringify(commandId)} was already used with different arguments`)
    this.name = 'CommandIdCollisionError'
  }
}

export class PendingCommandReceiptError extends Error {
  constructor(readonly commandId: string, readonly resultRevision: number) {
    super(`command ${JSON.stringify(commandId)} is committed at revision ${resultRevision} but the Session projection has not observed it`)
    this.name = 'PendingCommandReceiptError'
  }
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, JsonValue>)[key] as JsonValue)}`).join(',')}}`
}

export function commandFingerprint(argumentsValue: JsonValue): string {
  return createHash('sha256').update(stableJson(argumentsValue), 'utf8').digest('hex')
}

export function emptyCommandReceiptManifest<Result extends JsonValue>(): CommandReceiptManifestV1<Result> {
  return { schemaVersion: 1, receipts: {} }
}

/** Session-keyed serial commit boundary for mutating workbench commands. */
export class CommandReceiptCoordinator {
  private readonly tails = new Map<string, Promise<void>>()

  async run<Result extends JsonValue>(
    sessionKey: string,
    command: IdempotentCommand<Result>,
  ): Promise<IdempotentCommandResult<Result>> {
    const previous = this.tails.get(sessionKey) ?? Promise.resolve()
    const task = previous.then(() => this.commit(command))
    const tail = task.then(() => undefined, () => undefined)
    this.tails.set(sessionKey, tail)
    try {
      return await task
    } finally {
      if (this.tails.get(sessionKey) === tail) this.tails.delete(sessionKey)
    }
  }

  private async commit<Result extends JsonValue>(
    command: IdempotentCommand<Result>,
  ): Promise<IdempotentCommandResult<Result>> {
    if (command.commandId.length === 0 || command.commandId.length > 128) {
      throw new RangeError('commandId must contain 1-128 characters')
    }
    if (!Number.isSafeInteger(command.observedProjectionRevision) || command.observedProjectionRevision < 0) {
      throw new RangeError('observedProjectionRevision must be a non-negative safe integer')
    }
    const manifest = await command.store.load()
    if (manifest.schemaVersion !== 1) throw new TypeError('unsupported command receipt manifest')
    const fingerprint = commandFingerprint(command.arguments)
    const existing = manifest.receipts[command.commandId]
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new CommandIdCollisionError(command.commandId)
      return { result: existing.result, replayed: true }
    }
    const pending = Object.values(manifest.receipts)
      .find(receipt => receipt.resultRevision > command.observedProjectionRevision)
    if (pending !== undefined) throw new PendingCommandReceiptError(pending.commandId, pending.resultRevision)

    const nextRevision = command.observedProjectionRevision + 1
    const result = await command.execute(nextRevision)
    const resultRevision = command.revisionOf(result)
    if (resultRevision !== nextRevision) {
      throw new Error(`mutating command must produce revision ${nextRevision}, got ${resultRevision}`)
    }
    const receipt: CommandReceiptV1<Result> = {
      commandId: command.commandId,
      fingerprint,
      previousRevision: command.observedProjectionRevision,
      resultRevision,
      result,
    }
    await command.store.save({
      schemaVersion: 1,
      receipts: { ...manifest.receipts, [command.commandId]: receipt },
    })
    return { result, replayed: false }
  }
}

