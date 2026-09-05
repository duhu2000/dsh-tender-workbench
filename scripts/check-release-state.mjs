import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const releaseDocument = `docs/RELEASE-${pkg.version}.md`
const releasePath = join(root, releaseDocument)
const errors = []

function expect(condition, message) {
  if (!condition) errors.push(message)
}

expect(/^\d+\.\d+\.\d+$/.test(pkg.version), `package version must be stable semver, received ${pkg.version}`)
expect(pkg.packageManager === 'pnpm@11.7.0', 'packageManager must remain pnpm@11.7.0')
expect(pkg.publishConfig?.access === 'public', 'publishConfig.access must be public')
expect(pkg.publishConfig?.registry === 'https://registry.npmjs.org/', 'publishConfig.registry must be the public npm registry')
expect(pkg.publishConfig?.tag === 'latest', 'stable releases must publish to the latest dist-tag')
expect(pkg.repository?.url === 'git+https://github.com/duhu2000/dsh-tender-workbench.git', 'repository URL must target duhu2000/dsh-tender-workbench')
expect(pkg.homepage === 'https://github.com/duhu2000/dsh-tender-workbench#readme', 'homepage must target duhu2000/dsh-tender-workbench')
expect(pkg.bugs?.url === 'https://github.com/duhu2000/dsh-tender-workbench/issues', 'bugs URL must target duhu2000/dsh-tender-workbench')
expect(Array.isArray(pkg.files) && pkg.files.includes('README.md'), 'npm files must include README.md')
expect(Array.isArray(pkg.files) && pkg.files.includes('CHANGELOG.md'), 'npm files must include CHANGELOG.md')
expect(Array.isArray(pkg.files) && pkg.files.includes(releaseDocument), `npm files must include ${releaseDocument}`)
expect(changelog.includes('## [Unreleased]'), 'CHANGELOG.md must contain an Unreleased section')
expect(changelog.includes(`## [${pkg.version}] - 2026-09-05`), `CHANGELOG.md must contain the dated ${pkg.version} release section`)
expect(existsSync(releasePath), `${releaseDocument} must exist`)

if (existsSync(releasePath)) {
  const release = readFileSync(releasePath, 'utf8')
  expect(release.includes(`Version: **${pkg.version}**`), `${releaseDocument} must identify version ${pkg.version}`)
  expect(/Status: \*\*(release candidate|published)\*\*/u.test(release), `${releaseDocument} must declare release candidate or published status`)
}

const releaseMode = process.env.DSH_RELEASE_MODE === '1' || process.env.GITHUB_REF_TYPE === 'tag'
if (releaseMode) {
  expect(process.env.GITHUB_REF_NAME === `v${pkg.version}`, `release tag must be v${pkg.version}, received ${process.env.GITHUB_REF_NAME ?? '<missing>'}`)
}

if (errors.length > 0) {
  for (const error of errors) console.error(`release:check failed: ${error}`)
  process.exitCode = 1
} else {
  console.log(`release:check passed for ${pkg.name}@${pkg.version}${releaseMode ? ' in tag mode' : ''}.`)
}
