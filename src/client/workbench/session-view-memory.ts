import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

/** Client-lifetime view memory only. Never stores task facts or host geometry. */
export function createSessionViewMemory() {
  const sessions = new Map<string, Map<string, unknown>>()
  let disposed = false
  return {
    read<T>(sessionId: string, key: string, initial: () => T): T {
      const values = sessions.get(sessionId)
      return values?.has(key) ? values.get(key) as T : initial()
    },
    write<T>(sessionId: string, key: string, value: T) {
      if (disposed) return
      let values = sessions.get(sessionId)
      if (values === undefined) { values = new Map(); sessions.set(sessionId, values) }
      values.set(key, value)
    },
    dispose() { disposed = true; sessions.clear() },
  }
}

/** The production view is keyed by Session: remounts recover only that Session. */
export function useSessionViewState<T>(
  memory: ReturnType<typeof createSessionViewMemory>,
  sessionId: string,
  key: string,
  initial: () => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => memory.read(sessionId, key, initial))
  const setRetained = useCallback<Dispatch<SetStateAction<T>>>(next => {
    setValue(previous => {
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(previous) : next
      memory.write(sessionId, key, resolved)
      return resolved
    })
  }, [memory, sessionId, key])
  return [value, setRetained]
}
