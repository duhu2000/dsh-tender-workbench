export type TenderDrawerKind = 'filter' | 'results'

let active: TenderDrawerKind | undefined
const listeners = new Set<(kind: TenderDrawerKind) => void>()

export function openTenderDrawer(kind: TenderDrawerKind): void {
  active = kind
  for (const listener of listeners) listener(kind)
}

export function closeTenderDrawer(kind: TenderDrawerKind): void {
  if (active === kind) active = undefined
}

export function subscribeTenderDrawers(listener: (kind: TenderDrawerKind) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
