import type { SkillRegistration, SkillRegistry } from '@deepseek-ai/dsh-skill'

/** Runtime skill registered together with the complete high-level tool set in S2-S5. */
export const TENDER_AGENT_SKILL: SkillRegistration = {
  name: 'tender-agent-workbench',
  description: 'Run the Session-scoped tender workflow from query through report delivery.',
  source: 'bundled',
  content: [
    '# 招投标 Agent 工作台',
    '',
    '在当前 Session 内完成：查询 → 概况 → 规则共创与确认 → 确定性分类 → Agent 分析 → 用户复核 → Excel/PDF 交付。',
    '',
    '- 只调用 `tender_workbench_*` 高层工具；查询工具内部负责精确调用已授权 qcc 工具。',
    '- 原样传递用户可见意图中的 `commandId`，不要生成 Session id 或文件路径参数。',
    '- 提出初筛口径前必须调用 `tender_workbench_get_screening_context`；不得重新查询 qcc、读取原始 Artifact、写草稿文件或用 Shell 计算指纹。',
    '- Agent 草案调用 `tender_workbench_preview_rules` 时省略 `draftFingerprint`，由 Host 计算并绑定。',
    '- 每个用户可见的口径草案、调整或预览 Intent 只调用一次 `tender_workbench_preview_rules`；工具返回即结束本轮，不得自行改稿或二次预览。',
    '- 不内置行业规则；规则由 Agent 提议、用户确认，程序按固定优先级分类。',
    '- Agent 建议不等于用户结论，不预测中标率、利润或资格符合性。',
    '- 订阅、定时任务和商机跟进不属于 MVP；Excel/PDF 交付后流程结束。',
  ].join('\n'),
}

/** Register the bundled skill once the complete high-level tool set is mounted. */
export function registerTenderAgentSkill(skills: Pick<SkillRegistry, 'register'>): () => void {
  return skills.register(TENDER_AGENT_SKILL)
}
