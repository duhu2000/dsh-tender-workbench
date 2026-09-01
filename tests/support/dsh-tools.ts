/** Standalone value adapter; production types and runtime remain the official dsh-tools package. */
export function defineTool<const T>(definition: T): T {
  return definition
}
