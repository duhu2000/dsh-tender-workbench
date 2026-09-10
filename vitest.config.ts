import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
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
