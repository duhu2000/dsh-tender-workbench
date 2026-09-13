import type { ProviderOutcome } from '../../contracts/execution.ts'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value)
export class ProviderEnvelopeError extends Error {
  constructor(readonly outcome: Extract<ProviderOutcome, 'failed' | 'no-permission' | 'unknown'>) {
    super(outcome === 'no-permission' ? '来源权限不足，请检查客户 MCP 授权。' : outcome === 'failed' ? '来源明确返回失败，请检查连接后重试。' : '来源返回结构未知，未将其视为零记录。')
  }
}

/** Bounded, explicit QCC/MCP wrappers; never search arbitrary nested customer data. */
export function unwrapProviderEnvelope(raw: unknown, source: 'tender' | 'proposed'): ObjectValue {
  let value = raw
  const key = source === 'tender' ? '标讯列表' : '拟建项目列表'
  for (let depth = 0; depth < 5; depth++) {
    if (!object(value)) throw new ProviderEnvelopeError('unknown')
    const code = value['Status'] ?? value['statusCode'] ?? value['code']
    if (['401', '403', 'FORBIDDEN', 'UNAUTHORIZED', 'NO_PERMISSION'].includes(String(code).toUpperCase())) throw new ProviderEnvelopeError('no-permission')
    if (value['isError'] === true || value['success'] === false || value['error'] != null
      || (code !== undefined && !['0', '200'].includes(String(code)))) throw new ProviderEnvelopeError('failed')
    if (Object.hasOwn(value, key)) {
      if (!Array.isArray(value[key])) throw new ProviderEnvelopeError('unknown')
      return value
    }
    // Missing list is not a successful zero response, even when total is zero.
    const next = value['Result'] ?? value['result'] ?? value['data'] ?? value['structuredContent']
    if (next === undefined) throw new ProviderEnvelopeError('unknown')
    value = next
  }
  throw new ProviderEnvelopeError('unknown')
}
