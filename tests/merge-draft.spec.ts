import { describe, expect, it } from 'vitest'
import { mergeDraft } from '../src/client/merge-draft.ts'

describe('mergeDraft', () => {
  it('uses generated text directly for empty and whitespace-only drafts', () => {
    expect(mergeDraft('', 'generated')).toBe('generated')
    expect(mergeDraft(' \n\t ', 'generated')).toBe('generated')
  })

  it('preserves non-empty content and appends after one blank line', () => {
    expect(mergeDraft('existing', 'generated')).toBe('existing\n\ngenerated')
    expect(mergeDraft('existing\n', 'generated')).toBe('existing\n\ngenerated')
  })

  it('does not append the exact same generated text twice', () => {
    expect(mergeDraft('generated', 'generated')).toBe('generated')
    expect(mergeDraft('existing\n\ngenerated', 'generated')).toBe('existing\n\ngenerated')
    expect(mergeDraft('existing\n\ngenerated\n', 'generated')).toBe('existing\n\ngenerated\n')
  })

  it('still appends a different generated request', () => {
    expect(mergeDraft('generated one', 'generated two')).toBe('generated one\n\ngenerated two')
  })
})
