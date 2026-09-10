import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
describe('deployment compatibility metadata', () => {
  it('targets the calibrated new baseline instead of claiming all future or legacy hosts', () => {
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime']).toBeUndefined()
    expect(manifest.devDependencies['@deepseek-ai/dsh-client-runtime']).toBeUndefined()
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(range).toBe('~0.1.2-rc.1')
    }
    expect(manifest.peerDependencies['dsh-better-sidebar']).toBe('~0.18.1')
    expect(manifest.devDependencies['dsh-better-sidebar']).toBe('0.18.1')
    expect(manifest.devDependencies['@deepseek-ai/dsh-client-ui-conversation']).toBe('0.1.2-rc.1')
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-runtime')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-api-session-controller')
  })
  it('has no legacy runtime escape hatch in the build or unit-test resolver', () => {
    for (const path of ['../tsdown.config.ts', '../vitest.config.ts']) {
      expect(readFileSync(new URL(path, import.meta.url), 'utf8')).not.toContain('@deepseek-ai/dsh-client-runtime/client')
    }
  })
})
