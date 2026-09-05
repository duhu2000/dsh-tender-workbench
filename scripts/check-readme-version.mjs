import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const englishReadme = readFileSync(join(root, 'README.en.md'), 'utf8')
const errors = []

const versionMarker = `当前稳定版本：**${pkg.version}**（正式版本）`
const englishVersionMarker = `Current stable version: **${pkg.version}** (stable release).`
const exactInstall = `dsh-tender-workbench@${pkg.version}`

if (!readme.includes(versionMarker)) {
  errors.push(`README.md is missing the current stable version marker: ${versionMarker}`)
}
if (!englishReadme.includes(englishVersionMarker)) {
  errors.push(`README.en.md is missing the current stable version marker: ${englishVersionMarker}`)
}
if (!readme.includes(exactInstall)) {
  errors.push(`README.md is missing the exact install example: ${exactInstall}`)
}
if (!englishReadme.includes(exactInstall)) {
  errors.push(`README.en.md is missing the exact install example: ${exactInstall}`)
}
if (!readme.includes('## 产品简介')) {
  errors.push('README.md must be the Chinese-first product page')
}
if (!readme.includes('[English](README.en.md)')) {
  errors.push('README.md must link to README.en.md')
}
if (!englishReadme.includes('[中文](README.md)')) {
  errors.push('README.en.md must link back to README.md')
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
  console.log(`docs:check passed: Chinese and English READMEs match stable version ${pkg.version}.`)
}
