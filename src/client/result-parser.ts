export type ToolResultContent = readonly { readonly type: string; readonly text?: string }[]

export class ResultParseError extends Error {
  constructor(readonly code: 'empty-result' | 'invalid-json') {
    super(code)
    this.name = 'ResultParseError'
  }
}

export function extractToolResultText(content: ToolResultContent): string {
  return content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').trim()
}

export function parseToolResultText(content: ToolResultContent): unknown {
  const text = extractToolResultText(content)
  if (text === '') throw new ResultParseError('empty-result')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ResultParseError('invalid-json')
  }
}

/** Remove terminal controls and cap diagnostics without retaining another raw-result copy. */
export function resultPreview(value: string, limit = 2_000): string {
  const sanitized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim()
  return sanitized.length <= limit ? sanitized : `${sanitized.slice(0, limit)}…`
}
