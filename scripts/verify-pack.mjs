import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const escapedVersion = pkg.version.replaceAll('.', '\\.')
const whitelist = [
  /^package\.json$/u,
  /^README\.md$/u,
  /^LICENSE$/u,
  /^CHANGELOG\.md$/u,
  /^cordis\.patch\.yml$/u,
  new RegExp(`^docs/RELEASE-${escapedVersion}\\.md$`, 'u'),
  /^lib\/index\.js$/u,
  /^lib\/client\.js$/u,
  /^lib\/client\.js\.map$/u,
  /^lib\/types\/.+\.d\.ts$/u,
  /^lib\/types\/.+\.d\.ts\.map$/u,
]
const required = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'cordis.patch.yml',
  `docs/RELEASE-${pkg.version}.md`,
  'lib/index.js',
  'lib/client.js',
  'lib/client.js.map',
  'lib/types/index.d.ts',
]

const cache = mkdtempSync(join(tmpdir(), 'dsh-tender-pack-'))
let raw
try {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  raw = execFileSync(command, ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  console.error('verify-pack failed: npm pack --dry-run --json did not complete')
  console.error(String(error.stderr ?? error.message))
  process.exit(1)
} finally {
  rmSync(cache, { recursive: true, force: true })
}

const [pack] = JSON.parse(raw)
if (!pack || !Array.isArray(pack.files)) {
  console.error('verify-pack failed: npm pack JSON did not contain a file list')
  process.exit(1)
}

const files = pack.files.map(file => file.path).sort()
const stray = files.filter(file => !whitelist.some(rule => rule.test(file)))
const missing = required.filter(file => !files.includes(file))

if (stray.length > 0 || missing.length > 0) {
  for (const file of stray) console.error(`verify-pack failed: unexpected file ${file}`)
  for (const file of missing) console.error(`verify-pack failed: missing required file ${file}`)
  process.exit(1)
}

console.log(`verify-pack passed: ${files.length} files are inside the release whitelist.`)
for (const file of files) console.log(`  - ${file}`)
