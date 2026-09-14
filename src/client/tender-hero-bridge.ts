import theme from './qcc-theme.module.css'
import css from './workbench-entry.module.css'

/**
 * Compatibility bridge for DSH 0.1.2-rc.1 (no session headline slot).
 * Hide only the verified native brand row, insert an owned row, and restore it
 * on exit. Never claim the root/single hero.brand.mark slot or rewrite siblings.
 */
export function mountTenderHero(anchor: HTMLElement, onMount: (node: HTMLElement | null) => void): () => void {
  // Observe only the owning session surface, never the global document/brand.
  const hero = anchor.closest<HTMLElement>('[data-phase="hero"]')
  if (!hero) return () => {}
  let row: HTMLElement | undefined
  let mount: HTMLElement | undefined
  let display = ''
  const restore = () => {
    mount?.remove()
    if (row?.style.display === 'none') row.style.display = display
    row = undefined
    mount = undefined
  }
  const sync = () => {
    const title = hero.querySelector<HTMLElement>('[class*="headlineText"]')
      ?? [...hero.querySelectorAll('span')].find(node =>
        ['探索未至之境', 'Into the Unknown'].includes(node.textContent?.trim() ?? ''))
    const next = title?.parentElement
    if (!next || !next.querySelector('[class*="fishHitbox"]') || next.contains(anchor)) {
      if (mount) { restore(); onMount(null) }
      return
    }
    if (next === row && mount?.parentElement === next.parentElement) return
    restore()
    row = next
    display = row.style.display
    mount = anchor.ownerDocument.createElement('div')
    mount.className = `${theme.scope} ${css.heroMount}`
    mount.dataset.dshTenderHero = 'true'
    row.style.display = 'none'
    row.before(mount)
    onMount(mount)
  }
  sync()
  const observer = new MutationObserver(sync)
  observer.observe(hero, { childList: true, subtree: true })
  return () => { observer.disconnect(); restore() }
}

/** input.dock is BEFORE the native composer: portal only our navigation below it. */
export function mountTenderShortcuts(anchor: HTMLElement, onMount: (node: HTMLElement | null) => void): () => void {
  const seat = anchor.closest<HTMLElement>('[data-composer-seat]')
  let mount: HTMLElement | undefined
  const sync = () => {
    const card = seat?.querySelector<HTMLElement>('[data-composer-card]')
    if (!card || !seat) { mount?.remove(); onMount(null); return }
    let branch = card
    while (branch.parentElement && branch.parentElement !== seat && !branch.parentElement.contains(anchor)) {
      branch = branch.parentElement
    }
    const parent = branch.parentElement
    if (!parent?.contains(anchor) || branch.contains(anchor)) return
    if (!mount) {
      mount = anchor.ownerDocument.createElement('div')
      mount.dataset.dshTenderShortcuts = 'true'
      mount.className = css.shortcutMount ?? ''
    }
    if (branch.nextSibling !== mount) parent.insertBefore(mount, branch.nextSibling)
    onMount(mount)
  }
  sync()
  const observer = new MutationObserver(sync)
  if (seat) observer.observe(seat, { childList: true, subtree: true })
  return () => { observer.disconnect(); mount?.remove() }
}
