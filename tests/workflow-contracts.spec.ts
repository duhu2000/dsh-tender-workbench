import { describe, expect, it } from 'vitest'
import { TenderQueryIntentV1Schema } from '../src/contracts/query-schema.ts'
import {
  MAX_PROJECTION_BYTES,
  TenderRuleV1Schema,
  createEmptyTenderWorkflowProjection,
  parseTenderWorkflowProjectionV1,
  projectionSizeBytes,
} from '../src/contracts/workflow.ts'

describe('V1 workflow contracts', () => {
  it('accepts exact query branches and rejects Session identity or branch drift', () => {
    const valid = {
      schemaVersion: 1,
      commandId: 'command-1',
      kind: 'query.start',
      scope: 'combined',
      target: '查找北京大数据相关项目',
      tender: { keywords: ['大数据'], regions: ['北京市'] },
      proposed: { keywords: ['大数据'], regions: ['北京市'] },
    }
    expect(TenderQueryIntentV1Schema.parse(valid)).toEqual(valid)
    expect(() => TenderQueryIntentV1Schema.parse({ ...valid, sessionId: 'must-not-cross-the-tool-boundary' })).toThrow()
    expect(() => TenderQueryIntentV1Schema.parse({ ...valid, scope: 'tender' })).toThrow()
  })

  it('fixes the flat OR-keyword rule shape without a generic expression tree', () => {
    const rule = {
      id: 'rule-1',
      name: '大数据项目',
      enabled: true,
      action: 'include',
      scope: 'all',
      keywords: ['大数据', '数据平台'],
      priority: 10,
      exceptions: ['培训'],
      reason: '优先识别目标项目',
    }
    expect(TenderRuleV1Schema.parse(rule)).toEqual(rule)
    expect(() => TenderRuleV1Schema.parse({ ...rule, keywords: [] })).toThrow()
    expect(() => TenderRuleV1Schema.parse({ ...rule, condition: { any: ['大数据'] } })).toThrow()
  })

  it('keeps the complete legal projection below the 64 KiB wire guard', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const error = '错'.repeat(512)
    const stages = Object.fromEntries(Object.keys(empty.stages).map(stage => [stage, {
      status: 'failed',
      errorCode: 'E'.repeat(128),
      errorMessage: error,
    }]))
    const largestCore = parseTenderWorkflowProjectionV1({
      ...empty,
      currentStage: 'report',
      stages,
      lastFailure: {
        command: 'tender_workbench_generate_report',
        code: 'E'.repeat(128),
        message: error,
      },
    })
    expect(projectionSizeBytes(largestCore)).toBeLessThan(MAX_PROJECTION_BYTES)
    expect(() => parseTenderWorkflowProjectionV1({ ...largestCore, unownedRecords: [] })).toThrow()
  })
})
