/** Append generated filter text without overwriting the user's current draft or duplicating its exact tail. */
export function mergeDraft(current: string, generated: string): string {
  if (current.trim() === '') return generated

  const trimmedCurrent = current.trimEnd()
  if (trimmedCurrent === generated || trimmedCurrent.endsWith(`\n\n${generated}`)) return current

  return `${trimmedCurrent}\n\n${generated}`
}
