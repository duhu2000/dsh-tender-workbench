import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { TENDER_SKILL_CONTRACT_MARKER } from '../src/contracts/orchestration.ts'
import { createTenderQueryIntent, serializeTenderQueryIntent } from '../src/client/intents/query-intent.ts'
import {
  createAdjustRulesIntent,
  createAnalysisFollowUpIntent,
  createContinueScreeningIntent,
  createGenerateReportIntent,
  createPreviewRulesIntent,
  createRequestAnalysisIntent,
  createRetryReportIntent,
  serializeTenderWorkbenchIntent,
} from '../src/client/intents/screening-intent.ts'
import {
  sendSessionTenderWorkbenchIntent,
  TenderSessionUnavailableError,
} from '../src/client/intents/send-session-intent.ts'
import type { TenderSkillCatalogConnection } from '../src/client/skill-catalog.ts'
import { createInitialTenderFilters } from '../src/client/types.ts'

function connection(skills = ['tender-workbench-query']): TenderSkillCatalogConnection {
  return {
    api: { skills: { list: vi.fn(async () => ({
      result: {
        ok: true as const,
        value: { skills: skills.map(name => ({
          name, description: `[${TENDER_SKILL_CONTRACT_MARKER}] test`, modelInvocable: true,
        })) },
      },
    })) } },
  }
}

function sessions(send = vi.fn(async (_text: string) => {})) {
  return {
    value: { scope: vi.fn(() => ({ get: (name: string) => name === 'conversation' ? { send } : undefined })) } as unknown as Pick<ISessions, 'scope'>,
    send,
  }
}

const rules = [{
  id: 'r1', name: '数据方向', enabled: true, action: 'include' as const,
  sources: ['tender' as const], scope: 'title' as const, keywords: ['数据'],
  priority: 100, exceptions: [], reason: '当前目标',
}]

describe('typed V2 Session Intent', () => {
  it('maps UI query state once into binding/payload and a minimal visible Prompt', () => {
    const intent = createTenderQueryIntent({
      scope: 'combined',
      target: '查找数据治理项目',
      filters: {
        ...createInitialTenderFilters(), keywords: '数据治理 AI 数据治理', regionCodes: ['SH'],
        noticeType: 'ifb', tenderStages: ['变更'], procurementMethods: ['竞磋'], tenderAmountMin: '300',
        proposedStages: ['项目备案'], approvalProgress: ['审批通过'], proposedInvestmentMin: '1000',
      },
    }, 'intent-1', 4, new Date('2026-08-30T12:00:00+08:00'))
    expect(intent).toMatchObject({
      schemaVersion: 2, intentId: 'intent-1', kind: 'query.run', skill: 'tender-workbench-query',
      binding: { projectionRevision: 4 },
      payload: {
        scope: 'combined', target: '查找数据治理项目',
        tender: { keywords: ['数据治理', 'AI'], regions: ['上海市'], budgetMin: 3_000_000 },
        proposed: { keywords: ['数据治理', 'AI'], regions: ['上海市'], investmentMin: 10_000_000 },
      },
    })
    const message = serializeTenderQueryIntent(intent)
    expect(message).toBe([
      '执行招投标工作台查询。',
      '/tender-workbench-query',
      '',
      '<dsh_tender_workbench_intent>',
      JSON.stringify(intent, null, 2),
      '</dsh_tender_workbench_intent>',
    ].join('\n'))
    expect(message.match(/查找数据治理项目/gu)).toHaveLength(1)
    expect(message).not.toContain('mcp__qcc-tender')
    expect(message).not.toContain('tender_workbench_run_query')
  })

  it('builds all action families with one strict envelope and no embedded Tool tutorial', () => {
    const screening = createContinueScreeningIntent({ intentId: 'rules-1', activeDatasetRef: 'data-1', projectionRevision: 2 })
    const adjustment = createAdjustRulesIntent({
      intentId: 'rules-2', activeDatasetRef: 'data-1', projectionRevision: 2,
      instruction: '增加云项目', rules,
    })
    const preview = createPreviewRulesIntent({ intentId: 'rules-3', activeDatasetRef: 'data-1', projectionRevision: 2, rules })
    const analysis = createRequestAnalysisIntent({
      intentId: 'analysis-1', activeDatasetRef: 'data-1', classificationArtifactRef: 'class-1',
      ruleSetVersion: 'rules-v1', projectionRevision: 3,
    })
    const followUp = createAnalysisFollowUpIntent({
      intentId: 'follow-1', activeDatasetRef: 'data-1', classificationArtifactRef: 'class-1',
      ruleSetVersion: 'rules-v1', analysisVersion: 'analysis-v1', projectionRevision: 5,
      recordRef: 'record-1', question: '当前需要核验什么？',
    })
    const report = createGenerateReportIntent({
      intentId: 'report-1', activeDatasetRef: 'data-1', projectionRevision: 6,
      classificationArtifactRef: 'class-1', ruleSetVersion: 'rules-v1', analysisVersion: 'analysis-v1',
      reviewArtifactRef: 'review-1', reviewRevision: 2, confirmPending: true, includeNarrative: true,
    })
    const retry = createRetryReportIntent({
      intentId: 'retry-1', projectionRevision: 7, finalSnapshotId: 'snapshot-1', formats: ['excel'],
    })
    for (const intent of [screening, adjustment, preview, analysis, followUp, report, retry]) {
      const message = serializeTenderWorkbenchIntent(intent)
      expect(message.split('\n')).toContain(`/${intent.skill}`)
      expect(message).toContain(JSON.stringify(intent, null, 2))
      expect(message.endsWith('</dsh_tender_workbench_intent>')).toBe(true)
      expect(message).not.toMatch(/调用流程|Tool Schema|mcp__/u)
    }
    expect(analysis).toMatchObject({ payload: { scope: { kind: 'all-eligible' } } })
    expect(followUp).toMatchObject({ payload: { recordRef: 'record-1', question: '当前需要核验什么？' } })
    expect(report).toMatchObject({ payload: { narrativeMode: 'requested' } })
  })

  it('preflights the exact winning action Skill before sending to the addressed Session', async () => {
    const scoped = sessions()
    const catalog = connection(['tender-workbench-query'])
    const intent = createTenderQueryIntent({
      scope: 'tender', target: '目标',
      filters: { ...createInitialTenderFilters(), keywords: '云平台' },
    }, 'intent-send', 0)
    await sendSessionTenderWorkbenchIntent(scoped.value, catalog, 'session-2' as never, intent)
    expect(scoped.value.scope).toHaveBeenCalledWith('session-2')
    expect(catalog.api.skills.list).toHaveBeenCalledWith({ sessionId: 'session-2' }, undefined)
    expect(scoped.send).toHaveBeenCalledOnce()
  })

  it('fails before send when the action Skill is missing or marker-incompatible', async () => {
    const scoped = sessions()
    const intent = createTenderQueryIntent({
      scope: 'tender', target: '目标',
      filters: { ...createInitialTenderFilters(), keywords: '云平台' },
    }, 'intent-send', 0)
    await expect(sendSessionTenderWorkbenchIntent(scoped.value, connection([]), 'session-1' as never, intent))
      .rejects.toMatchObject({ code: 'skill-missing' })
    const incompatible = {
      api: { skills: { list: vi.fn(async () => ({
        result: { ok: true as const, value: { skills: [{ name: intent.skill, description: 'other provider', modelInvocable: true }] } },
      })) } },
    }
    await expect(sendSessionTenderWorkbenchIntent(scoped.value, incompatible, 'session-1' as never, intent))
      .rejects.toMatchObject({ code: 'skill-incompatible' })
    expect(scoped.send).not.toHaveBeenCalled()
  })

  it('fails explicitly when the addressed Session or conversation is unavailable', async () => {
    const intent = createTenderQueryIntent({
      scope: 'tender', target: '目标',
      filters: { ...createInitialTenderFilters(), keywords: '数据' },
    }, 'intent-missing', 0)
    await expect(sendSessionTenderWorkbenchIntent(
      { scope: () => undefined } as unknown as Pick<ISessions, 'scope'>,
      connection(), 'missing' as never, intent,
    )).rejects.toBeInstanceOf(TenderSessionUnavailableError)
    await expect(sendSessionTenderWorkbenchIntent(
      { scope: () => ({ get: () => undefined }) } as unknown as Pick<ISessions, 'scope'>,
      connection(), 'missing-conversation' as never, intent,
    )).rejects.toThrow('Tender conversation is unavailable')
  })
})
