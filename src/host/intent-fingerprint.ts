import { createHash } from 'node:crypto'
import type { TenderWorkbenchIntentV2 } from '../contracts/intents.ts'
import type { TenderWorkbenchIntentKindV2 } from '../contracts/orchestration.ts'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('value is not canonical JSON')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function fingerprint(prefix: string, value: unknown): string {
  const digest = createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex').slice(0, 48)
  return `${prefix}_${digest}`
}

export function tenderIntentFingerprint(intent: TenderWorkbenchIntentV2): string {
  return fingerprint('intent', intent)
}

export function tenderBindingFingerprint(binding: unknown): string {
  return fingerprint('binding', binding)
}

export function conversationIntentId(turn: number, kind: TenderWorkbenchIntentKindV2): string {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new RangeError('conversation turn must be a positive integer')
  return fingerprint('conversation', [turn, kind])
}
