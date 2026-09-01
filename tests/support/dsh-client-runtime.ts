/**
 * Standalone Vitest value adapter for the public DSH client entry.
 *
 * Production code continues to import `@deepseek-ai/dsh-client-runtime/client`.
 * Its published JavaScript is intentionally loaded by the Harness browser
 * module loader, so Node-based tests provide the one runtime guard they use.
 * TypeScript still checks production code against the package's public types.
 */
export function isAppendSurfaceEvent(event: { readonly type: string; readonly surfaceOp?: unknown }): boolean {
  return (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result')
    && event.surfaceOp === 'append'
}
