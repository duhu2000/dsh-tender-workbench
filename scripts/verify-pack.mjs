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
  const npmArgs = ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache]
  const npmCli = process.env.npm_execpath?.replaceAll('\\', '/') ?? ''
  const command = npmCli.endsWith('/npm-cli.js') ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const args = npmCli.endsWith('/npm-cli.js') ? [process.env.npm_execpath, ...npmArgs] : npmArgs
  raw = execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      npm_config_color: 'false',
      npm_config_ignore_scripts: 'true',
    },
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32' && !npmCli.endsWith('/npm-cli.js'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  console.error('verify-pack failed: npm pack --dry-run --json did not complete')
  console.error(String(error.stderr ?? error.message))
  process.exit(1)
} finally {
  rmSync(cache, { recursive: true, force: true })
}

function parsePackOutput(output) {
  const clean = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '').trim()
  for (let index = clean.lastIndexOf('['); index >= 0; index = clean.lastIndexOf('[', index - 1)) {
    try {
      const parsed = JSON.parse(clean.slice(index))
      if (Array.isArray(parsed) && parsed[0]?.files) return parsed
    } catch {
      // npm 10 can emit prepare/build output before its final JSON payload.
    }
  }
  throw new Error('npm pack output did not end with the expected JSON payload')
}

let pack
try {
  pack = parsePackOutput(raw)[0]
} catch (error) {
  console.error(`verify-pack failed: ${error.message}`)
  process.exit(1)
}

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
