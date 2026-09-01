import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // Published DSH client entries are Harness module-loader artifacts rather
      // than Node ESM. Keep production imports on the public entry and supply
      // only the browser-runtime value used by these standalone unit tests.
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(new URL('./tests/support/dsh-client-runtime.ts', import.meta.url)),
      // Host tool packages also publish against a full Harness composition.
      // Standalone tests need only the pure defineTool authoring identity.
      '@deepseek-ai/dsh-tools': fileURLToPath(new URL('./tests/support/dsh-tools.ts', import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
  },
})
