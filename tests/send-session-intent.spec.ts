import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createTenderQueryIntent,
  serializeTenderQueryIntent,
} from '../src/client/intents/query-intent.ts'
import {
  sendSessionTenderQueryIntent,
  TenderSessionUnavailableError,
} from '../src/client/intents/send-session-intent.ts'

describe('typed Session Intent', () => {
  it('uses one validated object for branches, visible JSON, and exact source plan', () => {
    const intent = createTenderQueryIntent({
      scope: 'combined',
      target: '查找数据治理项目',
      keywords: '数据治理，AI 数据治理',
    }, 'command-1')
    expect(intent).toMatchObject({
      commandId: 'command-1',
      scope: 'combined',
      tender: { keywords: ['数据治理', 'AI'] },
      proposed: { keywords: ['数据治理', 'AI'] },
    })
    const message = serializeTenderQueryIntent(intent)
    expect(message).toContain(JSON.stringify(intent, null, 2))
    expect(message).toContain('tender_workbench_query')
    expect(message).toContain('mcp__qcc-tender__search_tenders')
    expect(message).toContain('mcp__qcc-tender__search_proposed_projects')
    expect(message).toContain('不使用 Web 搜索替代')
  })

  it('addresses only the supplied Session and calls its public conversation.send()', async () => {
    const sendOne = vi.fn(async (_text: string) => {})
    const sendTwo = vi.fn(async (_text: string) => {})
    const getConversation = vi.fn((sessionId: string) => vi.fn((name: string) => (
      name === 'conversation' ? { send: sessionId === 'one' ? sendOne : sendTwo } : undefined
    )))
    const scope = vi.fn((sessionId: string) => ({ get: getConversation(sessionId) }))
    const sessions = { scope } as unknown as Pick<ISessions, 'scope'>
    const intent = createTenderQueryIntent({ scope: 'tender', target: '目标', keywords: '云平台' }, 'command-2')
    await sendSessionTenderQueryIntent(sessions, 'two' as never, intent)
    expect(scope).toHaveBeenCalledWith('two')
    expect(getConversation).toHaveBeenCalledWith('two')
    expect(sendOne).not.toHaveBeenCalled()
    expect(sendTwo).toHaveBeenCalledTimes(1)
    expect(sendTwo.mock.calls[0]?.[0]).toContain('"commandId": "command-2"')
  })

  it('fails explicitly when the addressed Session is unavailable', async () => {
    const sessions = { scope: () => undefined } as unknown as Pick<ISessions, 'scope'>
    const intent = createTenderQueryIntent({ scope: 'tender', target: '目标', keywords: '' }, 'command-3')
    await expect(sendSessionTenderQueryIntent(sessions, 'missing' as never, intent))
      .rejects.toBeInstanceOf(TenderSessionUnavailableError)
  })

  it('fails explicitly when the scoped conversation Service is unavailable', async () => {
    const sessions = {
      scope: () => ({ get: () => undefined }),
    } as unknown as Pick<ISessions, 'scope'>
    const intent = createTenderQueryIntent({ scope: 'tender', target: '目标', keywords: '' }, 'command-4')
    await expect(sendSessionTenderQueryIntent(sessions, 'missing-conversation' as never, intent))
      .rejects.toThrow('Tender conversation is unavailable')
  })
})
