import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptUrl = new URL('../scripts/mount-web-profile.ps1', import.meta.url)
const scriptPath = fileURLToPath(scriptUrl)

describe('web Profile mount runner', () => {
  it.runIf(process.platform === 'win32')('passes its side-effect-free self-test', () => {
    const result = spawnSync(
      'pwsh',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath, '-SelfTest'],
      { encoding: 'utf8' },
    )

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('mount-web-profile self-test: OK')
  })

  it('contains the stale-write and package-manager guards', () => {
    const body = readFileSync(scriptUrl, 'utf8')

    expect(body).toContain("$DshReferenceVersion = '0.1.1-rc.2'")
    expect(body).toContain('Profile changed during preparation; refusing stale write.')
    expect(body).toContain('DSH child pnpm is')
    expect(body).toContain('Refusing downgrade')
  })
})
