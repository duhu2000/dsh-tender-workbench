import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const errors = []

const versionMarker = `Current stable version: **${pkg.version}** (stable release).`
const exactInstall = `dsh-tender-workbench@${pkg.version}`

if (!readme.includes(versionMarker)) {
  errors.push(`README.md is missing the current stable version marker: ${versionMarker}`)
}
if (!readme.includes(exactInstall)) {
  errors.push(`README.md is missing the exact install example: ${exactInstall}`)
}
if (readme.includes('current release is an internal preview')) {
  errors.push('README.md still describes the current release as an internal preview')
}
if (readme.includes('dsh-tender-workbench@beta')) {
  errors.push('README.md still recommends the beta dist-tag for the current installation')
}

if (errors.length > 0) {
  for (const error of errors) console.error(`docs:check failed: ${error}`)
  process.exitCode = 1
} else {
  console.log(`docs:check passed: README.md matches stable version ${pkg.version}.`)
}
