import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = 'dsh-tender-workbench'
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
])
const CSS_PREFIX = '\0dsh-tender-workbench-css:'
const CSS_SUFFIX = '.mjs'

function styleModule(file: string, code: string, classes: Readonly<Record<string, string>>): string {
  const tagId = `${PLUGIN_ID}/${basename(file)}`
  return [
    `const css = ${JSON.stringify(code)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classes)};`,
  ].join('\n')
}

export default defineConfig([
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    plugins: [
      {
        name: 'dsh-tender-workbench-client-purity',
        resolveId(source: string) {
          if (!source.startsWith('@deepseek-ai/') || CLIENT_EXTERNALS.has(source)) return null
          throw new Error(`client bundle purity: unexpected DeepSeek Harness runtime import ${source}`)
        },
      },
      {
        name: 'dsh-tender-workbench-css-modules',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.module.css')) return null
          return `${CSS_PREFIX}${importer === undefined ? source : resolve(dirname(importer), source)}${CSS_SUFFIX}`
        },
        async load(id: string) {
          if (!id.startsWith(CSS_PREFIX)) return null
          const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
          this.addWatchFile(file)
          const source = await readFile(file)
          const result = transform({
            filename: file,
            code: source,
            cssModules: { pattern: '[hash]_[local]' },
            minify: true,
          })
          const classes: Record<string, string> = {}
          for (const [local, value] of Object.entries(result.exports ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
            classes[local] = value.name
          }
          return styleModule(file, result.code.toString(), classes)
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
