import { describe, expect, it } from 'vitest'
// @ts-expect-error Standalone CLI intentionally has no transpilation requirement.
import { assessCompatibility } from '../scripts/check-host-compatibility.mjs'

describe('read-only compatibility gate', () => {
  const good = { host: '0.1.2-rc.1', core: { 'dsh-session': '0.1.2-rc.1' }, sidebar: '0.18.1', node: '24.0.0' }
  it('allows calibrated host/sidebar without requiring context', () => {
    expect(assessCompatibility(good)).toMatchObject({ errors: [], warnings: [], verifiedBaseline: true })
    expect(assessCompatibility({ ...good, context: '0.48.0' }).errors).toEqual([])
  })
  it('blocks old full host, mixed packages and the known context fault', () => {
    for (const change of [{ host: '0.1.1-rc.2' }, { core: { 'dsh-session': '0.1.1-rc.2' } }, { context: '0.36.0' }, { sidebar: '0.17.1' }, { node: '23.0.0' }]) {
      expect(assessCompatibility({ ...good, ...change }).errors.length).toBeGreaterThan(0)
    }
  })
  it('marks unknown versions and absent sidebar as unverified, with actionable guidance', () => {
    for (const change of [{ host: '0.2.0' }, { context: '0.49.0' }, { sidebar: '0.17.2' }, { sidebar: undefined }]) {
      expect(assessCompatibility({ ...good, ...change })).toMatchObject({ errors: [], verifiedBaseline: false })
    }
  })
})
