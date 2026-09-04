export const TENDER_SKILL_GLOBAL_INVARIANTS = [
  '只使用当前 Agent Session 中由招投标工作台 Tool 返回的事实和不透明引用；不得跨 Session、猜测 Artifact 内容或读取绝对路径。',
  '修改业务事实前必须存在当前直接用户 Turn 中的明确动作。自主状态读取和含糊请求不能授权查询、规则、分析、复核或报告写入。',
  '查询来源只允许已安装并授权的 qcc-tender Tool；能力缺失时明确失败，不使用 Web、Shell 或其他来源替代。',
  '固定枚举、状态绑定、范围、统计、排序、幂等、Artifact 和完成条件由 Tool/Host 裁决；不得用自然语言绕过失败。',
  '初筛分类、Agent 建议和用户决定是三个独立事实。Agent 建议不能自动写成用户决定。',
  '不得输出企业适配度、中标概率、利润、资格符合或 Bid/No-Bid 等当前证据不能支持的结论。',
  '只根据 Tool Result 的结构化 context、batch、progress 和 control 继续；不得从 message 文案猜测引用、游标、批次或终态。',
  'control.status 为 continue 时只调用 nextTool；complete 时停止。Tool 参数或内容校验失败且 Projection 仍保留同一 pending Intent 时，只修正错误指出的当前 Tool 参数并重试，不改变用户 payload、binding 或业务范围；不可重试的 control.failed、pending 已清除或当前 Turn 结束时才终止动作。',
  '从 Agent 普通对话执行动作时，每个 Tool 都使用 origin `{ kind: \'conversation\' }`，不传 intentId，也不复用此前结构化页面动作的 intentId；结构化页面动作才使用 `{ kind: \'workbench-intent\', intentId }`。',
] as const

export function renderGlobalInvariants(indices?: readonly number[]): string {
  const selected = indices === undefined
    ? TENDER_SKILL_GLOBAL_INVARIANTS
    : indices.map(index => TENDER_SKILL_GLOBAL_INVARIANTS[index]).filter(value => value !== undefined)
  return selected.map((value, index) => `${index + 1}. ${value}`).join('\n')
}
