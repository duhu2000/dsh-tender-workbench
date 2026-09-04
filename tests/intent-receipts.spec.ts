import { describe, expect, it, vi } from 'vitest'
import {
  IntentReceiptCollisionError,
  IntentReceiptCoordinator,
  PendingIntentReceiptError,
  deriveReceiptId,
  emptyIntentReceiptManifest,
  type IntentReceiptManifestV2,
  type IntentReceiptStore,
  type JsonValue,
} from '../src/host/artifacts/intent-receipts.ts'

type Result = { readonly revision: number; readonly value: string }

class MemoryStore implements IntentReceiptStore<Result & JsonValue> {
  manifest: IntentReceiptManifestV2<Result & JsonValue> = emptyIntentReceiptManifest()

  async load() { return structuredClone(this.manifest) }
  async save(manifest: IntentReceiptManifestV2<Result & JsonValue>) { this.manifest = structuredClone(manifest) }
}

function action(store: MemoryStore, intentId: string, observedProjectionRevision: number, value = 'saved') {
  return {
    intentId,
    tool: 'tender_workbench_apply_review' as const,
    arguments: { value } as JsonValue,
    observedProjectionRevision,
    store,
    revisionOf: (result: Result & JsonValue) => result.revision,
    execute: vi.fn(async (nextRevision: number) => ({ revision: nextRevision, value }) as Result & JsonValue),
  }
}

describe('IntentReceiptCoordinator', () => {
  it('derives Host-only receipt ids and replays the same canonical action across coordinator restart', async () => {
    const store = new MemoryStore()
    const firstAction = action(store, 'intent-1', 0)
    const first = await new IntentReceiptCoordinator().run('session-1', firstAction)
    const replayAction = action(store, 'intent-1', 0)
    const replay = await new IntentReceiptCoordinator().run('session-1', replayAction)

    expect(first.receiptId).toBe(deriveReceiptId('tender_workbench_apply_review', 'intent-1'))
    expect(first.replayed).toBe(false)
    expect(replay).toEqual({ ...first, replayed: true })
    expect(firstAction.execute).toHaveBeenCalledOnce()
    expect(replayAction.execute).not.toHaveBeenCalled()
  })

  it('separates deterministic analysis batches under one user action', async () => {
    const store = new MemoryStore()
    const coordinator = new IntentReceiptCoordinator()
    const base = action(store, 'analysis-intent', 0)
    const first = await coordinator.run('session-1', { ...base, tool: 'tender_workbench_commit_analysis_batch', batchId: 'batch-1' })
    const secondBase = action(store, 'analysis-intent', 1, 'second')
    const second = await coordinator.run('session-1', { ...secondBase, tool: 'tender_workbench_commit_analysis_batch', batchId: 'batch-2' })
    expect(first.receiptId).not.toBe(second.receiptId)
    expect(second.result.revision).toBe(2)
  })

  it('rejects argument collisions and mutations that overtake an unobserved receipt', async () => {
    const store = new MemoryStore()
    const coordinator = new IntentReceiptCoordinator()
    await coordinator.run('session-1', action(store, 'intent-1', 0))
    await expect(coordinator.run('session-1', action(store, 'intent-1', 0, 'changed')))
      .rejects.toBeInstanceOf(IntentReceiptCollisionError)
    await expect(coordinator.run('session-1', action(store, 'intent-2', 0)))
      .rejects.toBeInstanceOf(PendingIntentReceiptError)
  })
})
