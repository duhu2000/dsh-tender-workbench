import {
  TenderQueryIntentV1Schema,
  type TenderQueryIntentV1,
} from '../../contracts/query-schema.ts'
import {
  QCC_PROPOSED_SEARCH_TOOL,
  QCC_TENDER_SEARCH_TOOL,
} from '../../contracts/query.ts'

export interface TenderQueryDraft {
  readonly scope: TenderQueryIntentV1['scope']
  readonly target: string
  readonly keywords: string
}

function normalizedKeywords(value: string): readonly string[] | undefined {
  const keywords = [...new Set(value.split(/[\s,，、]+/u).map(item => item.trim()).filter(Boolean))]
  return keywords.length === 0 ? undefined : keywords
}

/** Build the one validated object shared by the form, visible message, and future Host tool. */
export function createTenderQueryIntent(
  draft: TenderQueryDraft,
  commandId: string,
): TenderQueryIntentV1 {
  const keywords = normalizedKeywords(draft.keywords)
  const request = keywords === undefined ? {} : { keywords }
  return TenderQueryIntentV1Schema.parse({
    schemaVersion: 1,
    commandId,
    kind: 'query.start',
    scope: draft.scope,
    target: draft.target,
    ...(draft.scope === 'tender' || draft.scope === 'combined' ? { tender: request } : {}),
    ...(draft.scope === 'proposed' || draft.scope === 'combined' ? { proposed: request } : {}),
  })
}

function sourcePlan(intent: TenderQueryIntentV1): readonly string[] {
  return [
    ...(intent.tender === undefined ? [] : [QCC_TENDER_SEARCH_TOOL]),
    ...(intent.proposed === undefined ? [] : [QCC_PROPOSED_SEARCH_TOOL]),
  ]
}

/** Serialize a visible, auditable user message without a hidden Intent channel. */
export function serializeTenderQueryIntent(intent: TenderQueryIntentV1): string {
  const parsed = TenderQueryIntentV1Schema.parse(intent)
  return [
    '请执行招投标工作台查询。',
    `查询目标：${parsed.target}`,
    '',
    '类型化查询意图（schemaVersion 1）：',
    '```json',
    JSON.stringify(parsed, null, 2),
    '```',
    '',
    `请调用高层工作流工具 tender_workbench_query，并原样传递 commandId。计划数据源：${sourcePlan(parsed).join('、')}。`,
    '仅使用已安装并获授权的 qcc-tender 能力；能力缺失时明确失败，不使用 Web 搜索替代。',
    '查询工具返回后本轮立即结束；不得自动进入规则、分类、分析、复核或报告，不得猜测 activeDatasetRef、Artifact 引用或 Projection revision。后续动作只能由用户在工作台显式触发的新 Intent 启动。',
  ].join('\n')
}
