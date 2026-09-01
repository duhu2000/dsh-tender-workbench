import {
  AdjustRulesIntentV1Schema,
  ContinueScreeningIntentV1Schema,
  TenderWorkbenchIntentV1Schema,
  type TenderWorkbenchIntentV1,
} from '../../contracts/screening-intents.ts'
import {
  ConfirmRulesCommandV1Schema,
  PreviewRulesCommandV1Schema,
  ruleDraftFingerprint,
} from '../../contracts/screening.ts'
import type { TenderRuleV1 } from '../../contracts/workflow.ts'
import { serializeTenderQueryIntent } from './query-intent.ts'

export function createContinueScreeningIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
}) {
  return ContinueScreeningIntentV1Schema.parse({ schemaVersion: 1, kind: 'rules.propose', ...input })
}

export function createAdjustRulesIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly instruction: string
  readonly rules: readonly TenderRuleV1[]
}) {
  return AdjustRulesIntentV1Schema.parse({
    schemaVersion: 1,
    kind: 'rules.adjust',
    ...input,
    draftFingerprint: ruleDraftFingerprint(input.rules),
  })
}

export function createPreviewRulesIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly rules: readonly TenderRuleV1[]
}) {
  return PreviewRulesCommandV1Schema.parse({
    schemaVersion: 1,
    kind: 'rules.preview',
    origin: 'user',
    ...input,
    draftFingerprint: ruleDraftFingerprint(input.rules),
  })
}

export function createConfirmRulesIntent(input: {
  readonly commandId: string
  readonly activeDatasetRef: string
  readonly projectionRevision: number
  readonly previewArtifactId: string
  readonly rules: readonly TenderRuleV1[]
}) {
  return ConfirmRulesCommandV1Schema.parse({
    schemaVersion: 1,
    kind: 'rules.confirm',
    ...input,
    draftFingerprint: ruleDraftFingerprint(input.rules),
  })
}

function visibleJson(intent: TenderWorkbenchIntentV1): string {
  return ['```json', JSON.stringify(intent, null, 2), '```'].join('\n')
}

export function serializeTenderWorkbenchIntent(input: TenderWorkbenchIntentV1): string {
  const intent = TenderWorkbenchIntentV1Schema.parse(input)
  if (intent.kind === 'query.start') return serializeTenderQueryIntent(intent)
  if (intent.kind === 'rules.propose') {
    return [
      '继续筛候选。请基于本次查询目标、已校验查询条件、确定性统计和查询工具返回的有界代表性样本提出初筛口径，不使用任何默认行业规则。',
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
      '第一步必须调用 tender_workbench_get_screening_context，并原样传递 activeDatasetRef 和 projectionRevision；它是本次草案唯一允许使用的数据上下文。',
      '不得重新调用任何 qcc/MCP 搜索或详情工具，不得读取原始 Artifact，不得写草稿文件，也不得使用 Shell/代码计算统计或指纹。',
      '请基于该高层工具返回的查询条件、确定性统计和有界样本生成一层规则草案。字段范围只能是 title、purchaser，或表示同时覆盖这两个字段的 all；来源范围只能是 tender/proposed。',
      '随后准确调用一次 tender_workbench_preview_rules，origin 必须为 agent，并原样传递 commandId、activeDatasetRef 和 projectionRevision；Agent 草案不要传 draftFingerprint，由 Host 计算并绑定。',
      '预览工具返回后本轮立即结束；不得根据预览结果自行改稿、第二次预览或执行确认。草案和预览都不代表用户确认。',
    ].join('\n')
  }
  if (intent.kind === 'rules.adjust') {
    return [
      `请调整当前初筛口径草案：${intent.instruction}`,
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
      '请只基于消息中的当前结构化草案和用户调整要求输出完整的一层规则草案；不得重新查询 qcc、读取 Artifact、写文件或使用 Shell。',
      '准确调用一次 tender_workbench_preview_rules，origin 必须为 agent，并省略 draftFingerprint，由 Host 计算并绑定。工具返回后本轮立即结束，不得再次改稿或预览，也不要执行确认。用户在工作台选择“应用结构化建议”后，本地草案才会改变。',
    ].join('\n')
  }
  if (intent.kind === 'rules.preview') {
    return [
      '请对当前用户编辑的初筛口径执行确定性影响预览。',
      '',
      '类型化工作台意图（schemaVersion 1）：',
      visibleJson(intent),
      '',
      '请准确调用一次 tender_workbench_preview_rules 并原样传递全部字段。工具返回后本轮立即结束；不要再次改稿或预览，不要确认规则版本，不要修改当前分类。',
    ].join('\n')
  }
  return [
    '我明确确认当前初筛口径，并要求对当前活动数据执行确定性全量分类。',
    '',
    '类型化工作台意图（schemaVersion 1）：',
    visibleJson(intent),
    '',
    '请调用 tender_workbench_confirm_rules 并原样传递全部字段。旧快照、旧 revision 或过期预览必须失败。',
  ].join('\n')
}
