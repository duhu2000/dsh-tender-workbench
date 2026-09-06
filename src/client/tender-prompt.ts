export interface TenderPromptDraft {
  scope: 'combined' | 'tender' | 'proposed'
  keywords: string
  period: '近3个月' | '近1个月' | '近7天' | '不限时间'
  region: string
  target: string
}
export const initialTenderPrompt = (): TenderPromptDraft => ({
  scope: 'combined', keywords: '', period: '近3个月', region: '', target: '',
})
export interface TenderDraftPort {
  read(): string
  write(value: string): void
}
export interface TenderPromptMemory {
  draft: TenderPromptDraft
  lastGenerated?: string
}
export function formatTenderPromptDraft(draft: TenderPromptDraft): string {
  const scope = { combined: '招投标与拟建项目', tender: '招投标', proposed: '拟建项目' }[draft.scope]
  return [
    '请帮我开展招投标机会查询。',
    `查询范围：${scope}。`,
    `关键词：${draft.keywords.trim()}。`,
    `发布时间：${draft.period}；地区：${draft.region.trim() || '不限地区'}。`,
    `业务目标与筛选关注：${draft.target.trim() || '寻找相关机会，展示查询结果后由我确认筛选规则'}。`,
    '请按以上可编辑的任务描述整理当前查询条件。缺失或不明确的条件先向我确认，再使用招投标工作台的真实查询能力；不要沿用与当前描述冲突的历史条件。',
    '查询结果进入右侧工作台；筛选、分析、人工定案与报告生成分步确认，不自动连续执行。',
  ].join('\n')
}

/** Replace only an intact previous generated block; edited/manual text needs a choice. */
export function planTenderDraftFill(current: string, generated: string, previous?: string): string | undefined {
  if (!current.trim()) return generated
  if (previous && current.includes(previous)) return current.replace(previous, generated)
  return undefined
}
