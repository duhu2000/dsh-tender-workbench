/** UX-49: versioned copy, not a prompt, task, or query authorization. */
export const TENDER_INITIAL_DRAFT = {
  id: 'dsh-initial-draft/dsh-tender-workbench/1',
  version: 1,
  fingerprint: 'sha256:f2bf291eec74a12873fb6178362b61ed032f50389186bc82eec9462fd0e745ed',
  text: '请帮我查找并评估招投标机会。请填写行业、地区、时间范围和筛选条件，也可点击左上角「提示词生成」整理查询口径。例如：查找近 30 天【地区】软件和数据服务相关招标项目，排除已截止项目，形成候选清单。',
} as const

/** Exact bytes only: no trimming, fuzzy matching, or substring exclusion. */
export function isTenderInitialDraft(text: string): boolean {
  return text === TENDER_INITIAL_DRAFT.text
}

export function hasUnresolvedTenderPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return /【[^】]*】/u.test(value)
  if (Array.isArray(value)) return value.some(hasUnresolvedTenderPlaceholder)
  if (typeof value === 'object' && value !== null) return Object.values(value).some(hasUnresolvedTenderPlaceholder)
  return false
}

export const TENDER_INITIAL_CLARIFICATION = '请先补充真实地区（或明确不限地区）、行业/关键词、时间范围和筛选条件，替换【】占位符后再查询；当前未创建查询任务，也未调用数据来源或分析工具。'
