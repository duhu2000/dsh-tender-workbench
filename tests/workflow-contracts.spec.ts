import { describe, expect, it } from 'vitest'
import { TenderWorkbenchIntentV2Schema } from '../src/contracts/intents.ts'
import {
  TENDER_ACTION_SKILLS,
  TENDER_TOOLS,
  expectedEntryTool,
  orchestrationFor,
} from '../src/contracts/orchestration.ts'
import {
  CreateReportToolInputV2Schema,
  GetWorkflowStateInputV2Schema,
  RunQueryToolInputV2Schema,
  TENDER_TOOL_INPUT_SCHEMAS,
} from '../src/contracts/tool-inputs.ts'
import {
  MAX_PROJECTION_BYTES,
  TenderRuleV1Schema,
  createEmptyTenderWorkflowProjection,
  parseTenderWorkflowProjectionV2,
  projectionSizeBytes,
} from '../src/contracts/workflow.ts'

describe('S5.6 workflow contracts', () => {
  it('accepts only the strict V2 Intent envelope and exact action Skill', () => {
    const valid = {
      schemaVersion: 2,
      intentId: 'intent-1',
      kind: 'query.run',
      skill: 'tender-workbench-query',
      binding: { projectionRevision: 0 },
      payload: {
        scope: 'combined', target: '查找北京大数据相关项目',
        tender: { keywords: ['大数据'], regions: ['北京市'] },
        proposed: { keywords: ['大数据'], regions: ['北京市'] },
      },
    }
    expect(TenderWorkbenchIntentV2Schema.parse(valid)).toEqual(valid)
    expect(() => TenderWorkbenchIntentV2Schema.parse({ ...valid, sessionId: 'forbidden' })).toThrow()
    expect(() => TenderWorkbenchIntentV2Schema.parse({ ...valid, skill: 'tender-workbench-review' })).toThrow()
    expect(() => TenderWorkbenchIntentV2Schema.parse({
      ...valid, schemaVersion: 1, legacyIdentity: 'legacy',
    })).toThrow()
  })

  it('rejects empty source branches and action origins that could authorize autonomous mutation', () => {
    const base = {
      schemaVersion: 2,
      origin: { kind: 'workbench-intent', intentId: 'intent-query' },
      projectionRevision: 0,
      scope: 'tender',
      target: '目标',
    }
    expect(() => RunQueryToolInputV2Schema.parse({ ...base, tender: {} })).toThrow()
    expect(() => RunQueryToolInputV2Schema.parse({ ...base, tender: { smartSort: true } })).toThrow()
    expect(() => RunQueryToolInputV2Schema.parse({
      ...base, origin: { kind: 'autonomous' }, tender: { keywords: ['数据'] },
    })).toThrow()
  })

  it('uses closed report narrative branches and rejects the former parameter superset', () => {
    const base = {
      schemaVersion: 2,
      origin: { kind: 'workbench-intent', intentId: 'report-1' },
      activeDatasetRef: 'data-1',
      projectionRevision: 4,
      basis: { kind: 'dataset-only' },
      reviewRevision: 0,
      scope: 'complete',
      confirmPending: false,
    }
    expect(CreateReportToolInputV2Schema.parse({ ...base, narrative: { kind: 'none' } })).toEqual({
      ...base, narrative: { kind: 'none' },
    })
    expect(() => CreateReportToolInputV2Schema.parse({
      ...base, mode: 'create', contextFingerprint: 'legacy', narrative: undefined,
    })).toThrow()
  })

  it('defines one explicit orchestration entry and bounded Tool set for every Intent', () => {
    expect(TENDER_ACTION_SKILLS).toHaveLength(5)
    expect(TENDER_TOOLS).toHaveLength(13)
    expect(orchestrationFor('rules.propose')).toMatchObject({
      actionSkill: 'tender-workbench-screening',
      allowedTools: ['tender_workbench_get_rule_drafting_context', 'tender_workbench_preview_rules'],
    })
    expect(expectedEntryTool('report.create', { narrativeMode: 'none' })).toBe('tender_workbench_create_report')
    expect(expectedEntryTool('report.create', { narrativeMode: 'requested' })).toBe('tender_workbench_get_report_narrative_context')
    expect(Object.keys(TENDER_TOOL_INPUT_SCHEMAS).sort()).toEqual([...TENDER_TOOLS].sort())
    expect(GetWorkflowStateInputV2Schema.parse({})).toEqual({})
    expect(() => GetWorkflowStateInputV2Schema.parse({ sessionId: 'forbidden' })).toThrow()
  })

  it('keeps flat deterministic rules without a generic expression tree', () => {
    const rule = {
      id: 'rule-1', name: '大数据项目', enabled: true, action: 'include',
      sources: ['tender'], scope: 'all', keywords: ['大数据'], priority: 10,
      exceptions: ['培训'], reason: '优先识别目标项目',
    }
    expect(TenderRuleV1Schema.parse(rule)).toEqual(rule)
    expect(() => TenderRuleV1Schema.parse({ ...rule, condition: { any: ['大数据'] } })).toThrow()
  })

  it('keeps the V2 Projection bounded and rejects old metadata fields', () => {
    const empty = createEmptyTenderWorkflowProjection()
    const state = parseTenderWorkflowProjectionV2({
      ...empty,
      lastFailure: {
        intentId: 'intent-1', tool: 'tender_workbench_create_report',
        code: 'renderers-failed', message: '文件生成失败。',
      },
    })
    expect(projectionSizeBytes(state)).toBeLessThan(MAX_PROJECTION_BYTES)
    expect(() => parseTenderWorkflowProjectionV2({
      ...empty,
      lastFailure: { tool: 'tender_workbench_create_report', legacyIdentity: 'legacy', code: 'legacy', message: 'legacy' },
    })).toThrow()
  })
})
