import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

const css = readFileSync(
  new URL('../src/client/workbench/tender-workbench.module.css', import.meta.url),
  'utf8',
)

describe('workbench visual contracts', () => {
  it('keeps typography readable and scoped without scaling the host', () => {
    expect(css).toContain('--tw-font-body: 14px')
    expect(css).toContain('--tw-font-table: 13px')
    expect(css).toContain('--tw-font-caption: 12px')
    expect(css).toContain('--tw-font-title: 22px')
    expect(css).toContain('container-name: tender-workbench')
    expect(css).not.toMatch(/\bzoom\s*:/u)
    expect(css).not.toMatch(/transform:\s*scale\(/u)
    expect(css).not.toMatch(/letter-spacing:\s*-/u)
    expect(css).toContain('.shell :where(button, input, select, textarea)')
    expect(css).toContain('.shell td')
  })

  it('folds by workbench container width and keeps the narrow primary action reachable', () => {
    expect(css).toContain('@container tender-workbench (max-width: 760px)')
    expect(css).toContain('@container tender-workbench (max-width: 600px)')
    expect(css).toContain('@container tender-workbench (max-width: 390px)')
    expect(css).toMatch(/@container tender-workbench \(max-width: 600px\)[\s\S]*?\.footer\s*\{[\s\S]*?flex-direction:\s*column/u)
    expect(css).toMatch(/@container tender-workbench \(max-width: 600px\)[\s\S]*?\.primary\s*\{[\s\S]*?width:\s*100%/u)
    expect(css).toMatch(/@container tender-workbench \(max-width: 390px\)[\s\S]*?\.footerHint\s*\{[\s\S]*?display:\s*none/u)
    expect(css).toMatch(/\.rulesLayout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(220px,[\s\S]*?minmax\(0, 1\.6fr\)/u)
    expect(css).toMatch(/@container tender-workbench \(max-width: 760px\)[\s\S]*?\.rulesLayout\s*\{[\s\S]*?grid-template-columns:\s*1fr/u)
    expect(css).toMatch(/@container tender-workbench \(max-width: 600px\)[\s\S]*?\.suggestionDiff,[\s\S]*?grid-template-columns:\s*1fr/u)
  })

  it('keeps Chinese and English locale keys complete', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
