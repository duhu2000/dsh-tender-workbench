import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { QCC_PROPOSED_SEARCH_TOOL, QCC_TENDER_SEARCH_TOOL, type QccSearchTool } from './qcc-request.ts'
import { adaptProposedSearchPayload, adaptTenderSearchPayload } from './result-adapters.ts'
import { extractToolResultText, parseToolResultText, resultPreview } from './result-parser.ts'
import type { TenderSearchCall, TenderSearchTurnData } from './result-types.ts'

interface TenderSearchState extends TenderSearchTurnData {}

function searchTool(value: string): value is QccSearchTool {
  return value === QCC_TENDER_SEARCH_TOOL || value === QCC_PROPOSED_SEARCH_TOOL
}

function errorMessage(text: string): string {
  const preview = resultPreview(text, 500)
  return preview === '' ? '工具调用失败，未返回详细信息。' : preview
}

/** Turn-scoped durable projection over the official Session event stream. */
export const tenderSearchDefinition: ConversationNodeDefinition<TenderSearchState> = {
  kind: 'tender-search',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call' && searchTool(event.data.name)) return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('tender-search start requires turn/start')
    return { turn: match.event.data.turn, calls: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const callId = String(match.event.data.callId)
      if (!searchTool(match.event.data.name) || context.state.calls.some(call => call.callId === callId)) return context.state
      const call: TenderSearchCall = {
        status: 'running', callId, tool: match.event.data.name,
        argsRaw: match.event.data.arguments,
      }
      return { ...context.state, calls: [...context.state.calls, call] }
    }
    if (match.event.type !== 'tool/result') return context.state
    const callId = String(match.event.data.message.source.callId)
    const at = context.state.calls.findIndex(call => call.callId === callId)
    if (at === -1 || context.state.calls[at]?.status !== 'running') return context.state
    const pending = context.state.calls[at]
    if (pending === undefined) return context.state
    const resultBlock = match.event.data.message.content[0]
    const text = extractToolResultText(resultBlock.content)
    let settled: TenderSearchCall
    if (resultBlock.isError === true) {
      settled = { ...pending, status: 'error', seq: match.event.seq, message: errorMessage(text) }
    } else {
      try {
        const value = parseToolResultText(resultBlock.content)
        const result = pending.tool === QCC_TENDER_SEARCH_TOOL ? adaptTenderSearchPayload(value) : adaptProposedSearchPayload(value)
        settled = { ...pending, status: 'success', seq: match.event.seq, result }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown-result-error'
        settled = { ...pending, status: 'incompatible', seq: match.event.seq, reason, rawPreview: resultPreview(text) }
      }
    }
    const calls = context.state.calls.map((call, index) => index === at ? settled : call)
    return { ...context.state, calls, lastResultSeq: match.event.seq }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined || context.state.calls.length === 0
    ? null
    : {
      kind: 'turn', turn: context.state.turn, key: 'tender-search',
      value: { turn: context.state.turn, calls: context.state.calls, ...(context.state.lastResultSeq === undefined ? {} : { lastResultSeq: context.state.lastResultSeq }) },
    },
}
