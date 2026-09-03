import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest

describe('deployment compatibility metadata', () => {
  it('declares minimum deployment versions without upper bounds or exact pins', () => {
    expect(manifest.peerDependencies).toMatchObject({
      '@deepseek-ai/cordis': '>=4.0.1',
      '@deepseek-ai/dsh-client-locale': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-client-runtime': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-client-ui-conversation': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-client-ui-sidebar': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-host-webserver': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-session': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-session-projection': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-skill': '>=0.1.1-rc.2 || >=0.1.2-0',
      '@deepseek-ai/dsh-tools': '>=0.1.1-rc.2 || >=0.1.2-0',
      'dsh-better-sidebar': '>=0.17.1 || >=0.18.0-0',
      'dsh-mcp-connector': '>=0.2.31',
    })
    for (const range of Object.values(manifest.peerDependencies)) {
      expect(range).toMatch(/^>=/u)
      expect(range).not.toMatch(/</u)
    }
  })

  it('keeps concrete development fixtures without turning them into deployment pins', () => {
    expect(manifest.devDependencies['@deepseek-ai/dsh-client-runtime']).toBe('^0.1.1-rc.2')
    expect(manifest.devDependencies['dsh-better-sidebar']).toBe('0.17.1')
  })
})
