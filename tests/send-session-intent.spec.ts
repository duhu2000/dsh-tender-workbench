import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createTenderQueryIntent,
  serializeTenderQueryIntent,
} from '../src/client/intents/query-intent.ts'
import {
  sendSessionTenderQueryIntent,
  sendSessionTenderWorkbenchIntent,
  TenderSessionUnavailableError,
} from '../src/client/intents/send-session-intent.ts'
import {
  createAdjustRulesIntent,
  createContinueScreeningIntent,
  createPreviewRulesIntent,
  serializeTenderWorkbenchIntent,
} from '../src/client/intents/screening-intent.ts'

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

  it('serializes visible S3 Intents and sends adjustments through the same scoped public service', async () => {
    const rules = [{
      id: 'r1', name: '数据方向', enabled: true, action: 'include' as const, sources: ['tender' as const],
      scope: 'title' as const, keywords: ['数据'], priority: 100, exceptions: [], reason: '当前目标',
    }]
    const continuation = createContinueScreeningIntent({ commandId: 'continue-1', activeDatasetRef: 'data-1', projectionRevision: 1 })
    const continuationMessage = serializeTenderWorkbenchIntent(continuation)
    expect(continuationMessage).toContain('不使用任何默认行业规则')
    expect(continuationMessage).toContain('tender_workbench_get_screening_context')
    expect(continuationMessage).toContain('不得重新调用任何 qcc/MCP 搜索或详情工具')
    expect(continuationMessage).toContain('Agent 草案不要传 draftFingerprint，由 Host 计算并绑定')
    expect(continuationMessage).toContain('准确调用一次 tender_workbench_preview_rules')
    expect(continuationMessage).toContain('不得根据预览结果自行改稿、第二次预览')
    const preview = createPreviewRulesIntent({ commandId: 'preview-1', activeDatasetRef: 'data-1', projectionRevision: 1, rules })
    expect(serializeTenderWorkbenchIntent(preview)).toContain('tender_workbench_preview_rules')
    const adjustment = createAdjustRulesIntent({
      commandId: 'adjust-1', activeDatasetRef: 'data-1', projectionRevision: 1,
      instruction: '加入例外词', rules,
    })
    const message = serializeTenderWorkbenchIntent(adjustment)
    expect(message).toContain(JSON.stringify(adjustment, null, 2))
    expect(message).toContain('用户在工作台选择“应用结构化建议”后')

    const send = vi.fn(async (_text: string) => {})
    const sessions = { scope: () => ({ get: () => ({ send }) }) } as unknown as Pick<ISessions, 'scope'>
    await sendSessionTenderWorkbenchIntent(sessions, 'session-s3' as never, adjustment)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0]).toContain('"kind": "rules.adjust"')
  })
})
