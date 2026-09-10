import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function assessCompatibility({ host, core = {}, sidebar, context, node = process.versions.node }) {
  const errors = [], warnings = []
  const [major, minor] = node.split('.').map(Number)
  if (!(major >= 24 || major === 22 && minor >= 19)) errors.push('Node must be 22.19+ (22.x) or 24+.')
  const old = v => v === '0.1.1-rc.2'
  if (!host) errors.push('Cannot verify the actual full DSH installation. Supply --host-root.')
  else if (old(host)) errors.push('Known unsupported DSH. Back up the complete Profile, then explicitly upgrade the full host: npm install -g @deepseek-ai/dsh@0.1.2-rc.1')
  else if (host !== '0.1.2-rc.1') warnings.push('Unknown DSH combination: not verified; do not treat this check as compatibility acceptance.')
  for (const [name, version] of Object.entries(core)) {
    if (!version) errors.push('Missing host package: ' + name)
    else if (old(version)) errors.push('Mixed/legacy host package: ' + name + '@' + version + '. Upgrade the full DSH distribution, not one core package.')
    else if (version !== '0.1.2-rc.1') warnings.push('Unverified host package: ' + name + '@' + version)
  }
  if (!sidebar) warnings.push('Better Sidebar absent: conversation remains available; workbench requires dsh-better-sidebar@0.18.1 and a full profile restart.')
  else if (sidebar !== '0.18.1') {
    if (sidebar === '0.17.1' && host === '0.1.2-rc.1') errors.push('Known reverse mismatch: DSH 0.1.2-rc.1 + Better Sidebar 0.17.1 requires removed settingsNamespace. Use dsh plugin --profile web add dsh-better-sidebar@0.18.1 after backing up the full profile.')
    else warnings.push('Better Sidebar combination not verified: ' + sidebar)
  }
  if (context === '0.36.0') errors.push('Installed dsh-context@0.36.0 uses removed settingsNamespace. Back up configuration, then explicitly update it: dsh plugin --profile web add dsh-context@0.48.0')
  else if (context && context !== '0.48.0') warnings.push('Installed context version not verified: ' + context)
  return { errors, warnings, verifiedBaseline: errors.length === 0 && warnings.length === 0 }
}

export function inspectInstallation(hostRoot, profileRoot) {
  const version = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).version : undefined
  const hostManifest = JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8'))
  if (hostManifest.name !== '@deepseek-ai/dsh') throw Error('--host-root must be the actual full @deepseek-ai/dsh package')
  const names = ['dsh-session', 'dsh-session-projection', 'dsh-api-session-controller', 'dsh-client-ui-conversation']
  const core = Object.fromEntries(names.map(name => {
    const relative = join('node_modules', '@deepseek-ai', name, 'package.json')
    // Profile-local copies override host copies and must not silently evade checks.
    return [name, version(profileRoot && existsSync(join(profileRoot, relative)) ? join(profileRoot, relative) : join(hostRoot, relative))]
  }))
  return { host: version(join(hostRoot, 'package.json')), core,
    sidebar: profileRoot ? version(join(profileRoot, 'node_modules/dsh-better-sidebar/package.json')) : undefined,
    context: profileRoot ? version(join(profileRoot, 'node_modules/dsh-context/package.json')) : undefined }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
  const hostRoot = at('--host-root'), profileRoot = at('--profile-root')
  if (!hostRoot) { console.error('Read-only preflight: node scripts/check-host-compatibility.mjs --host-root /path/to/@deepseek-ai/dsh [--profile-root /path/to/profile]'); process.exitCode = 2 }
  else {
    try {
      const inventory = inspectInstallation(resolve(hostRoot), profileRoot && resolve(profileRoot))
      const result = assessCompatibility(inventory)
      console.log(JSON.stringify({ inventory, ...result }, null, 2))
      process.exitCode = result.errors.length ? 1 : 0
    } catch (error) { console.error('Cannot read package manifests: ' + error.message); process.exitCode = 2 }
  }
}
