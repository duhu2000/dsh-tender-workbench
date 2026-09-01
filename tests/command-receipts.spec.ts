import { describe, expect, it } from 'vitest'
import {
  CommandIdCollisionError,
  CommandReceiptCoordinator,
  PendingCommandReceiptError,
  emptyCommandReceiptManifest,
  type CommandReceiptManifestV1,
  type CommandReceiptStore,
} from '../src/host/artifacts/command-receipts.ts'

type Result = { readonly state: { readonly revision: number }; readonly value: string }

class MemoryStore implements CommandReceiptStore<Result> {
  manifest: CommandReceiptManifestV1<Result> = emptyCommandReceiptManifest()

  async load(): Promise<CommandReceiptManifestV1<Result>> {
    return structuredClone(this.manifest)
  }

  async save(manifest: CommandReceiptManifestV1<Result>): Promise<void> {
    this.manifest = structuredClone(manifest)
  }
}

function command(
  store: MemoryStore,
  commandId: string,
  observedProjectionRevision: number,
  execute: (nextRevision: number) => Promise<Result>,
  value = 'same',
) {
  return {
    commandId,
    arguments: { value },
    observedProjectionRevision,
    store,
    execute,
    revisionOf: (result: Result) => result.state.revision,
  } as const
}

describe('CommandReceiptCoordinator', () => {
  it('serializes concurrent duplicates and replays the first canonical result', async () => {
    const store = new MemoryStore()
    const coordinator = new CommandReceiptCoordinator()
    let executions = 0
    const execute = async (revision: number): Promise<Result> => {
      executions += 1
      await Promise.resolve()
      return { state: { revision }, value: 'first' }
    }
    const [first, duplicate] = await Promise.all([
      coordinator.run('session-1', command(store, 'command-1', 0, execute)),
      coordinator.run('session-1', command(store, 'command-1', 0, execute)),
    ])
    expect(executions).toBe(1)
    expect([first.replayed, duplicate.replayed].sort()).toEqual([false, true])
    expect(duplicate.result).toEqual(first.result)

    const afterRestart = await new CommandReceiptCoordinator().run(
      'session-1',
      command(store, 'command-1', 0, execute),
    )
    expect(afterRestart).toMatchObject({ replayed: true, result: { value: 'first' } })
    expect(executions).toBe(1)
  })

  it('rejects commandId collisions and blocks a new mutation until Projection catches up', async () => {
    const store = new MemoryStore()
    const coordinator = new CommandReceiptCoordinator()
    const execute = async (revision: number): Promise<Result> => ({ state: { revision }, value: 'ok' })
    await coordinator.run('session-1', command(store, 'command-1', 0, execute))

    await expect(coordinator.run('session-1', command(store, 'command-1', 0, execute, 'different')))
      .rejects.toBeInstanceOf(CommandIdCollisionError)
    await expect(coordinator.run('session-1', command(store, 'command-2', 0, execute)))
      .rejects.toBeInstanceOf(PendingCommandReceiptError)
    await expect(coordinator.run('session-1', command(store, 'command-2', 1, execute)))
      .resolves.toMatchObject({ replayed: false, result: { state: { revision: 2 } } })
  })

  it('refuses a result that does not advance exactly one revision', async () => {
    const store = new MemoryStore()
    const coordinator = new CommandReceiptCoordinator()
    await expect(coordinator.run('session-1', command(
      store,
      'command-1',
      0,
      async () => ({ state: { revision: 7 }, value: 'invalid' }),
    ))).rejects.toThrow('must produce revision 1')
    expect(store.manifest.receipts).toEqual({})
  })
})

