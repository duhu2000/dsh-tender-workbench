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
    '- `tender_workbench_query` 返回后本轮立即结束；不得自动继续规则、分类、分析、复核或报告，也不得猜测 `activeDatasetRef`、Artifact 引用或 Projection revision。每个后续阶段只能由用户在工作台显式触发的新 Intent 启动。',
    '- 提出初筛口径前必须调用 `tender_workbench_get_screening_context`；不得重新查询 qcc、读取原始 Artifact、写草稿文件或用 Shell 计算指纹。',
    '- Agent 草案调用 `tender_workbench_preview_rules` 时省略 `draftFingerprint`，由 Host 计算并绑定。',
    '- 每个用户可见的口径草案、调整或预览 Intent 只调用一次 `tender_workbench_preview_rules`；工具返回即结束本轮，不得自行改稿或二次预览。',
    '- 不内置行业规则；规则由 Agent 提议、用户确认，程序按固定优先级分类。',
    '- Agent 分析必须先对用户明确范围调用一次 `tender_workbench_analysis_next`，只引用该稳定批次返回的 `recordRef` / `evidenceRef`，再调用一次 `tender_workbench_analysis_commit`；不得维护游标或扩大范围。',
    '- 每条 Agent 建议必须包含证据、理由、待核验项和局限；Agent 建议不等于用户决定，不输出企业适配度、中标概率、利润、资格符合或 Bid/No-Bid。',
    '- `tender_workbench_apply_review` 只应用用户明确选择的记录、决定和备注；`tender_workbench_revert_review` 只撤销最近一次用户操作，均不得从 Agent 建议自动回填。',
    '- 需要 Agent 报告叙述时，必须先调用只读 `tender_workbench_get_report_context`；只能引用返回的当前 `metricRef` / `recordRef`，不得计算或在自由文本中写数字、日期、金额和比例。',
    '- `ReportNarrativeV1` 顶层只能使用 `executiveSummary?`、`keyFindings[]`、`priorityVerification[]`、`risksAndLimitations[]`；每个叙述项只能使用 `title`、`statement`、`metricRefs[]`、`recordRefs[]`、`limitations[]`，并且至少引用一个允许的 metricRef 或 recordRef。',
    '- `tender_workbench_generate_report` 只接受与当前 `contextFingerprint` 匹配的结构化 `ReportNarrativeV1`；Agent 不生成脚本、HTML/CSS、公式或版式。叙述可省略，Excel/PDF 仍由 Host 确定性生成。',
    '- 失败格式重试只传既有 `finalSnapshotId` 与失败格式；沿用快照内同一份叙述，不再次调用报告上下文工具或请求 Agent 改写。',
    '- 订阅、定时任务和商机跟进不属于 MVP；Excel/PDF 交付后流程结束。',
  ].join('\n'),
}

/** Register the bundled skill once the complete high-level tool set is mounted. */
export function registerTenderAgentSkill(skills: Pick<SkillRegistry, 'register'>): () => void {
  return skills.register(TENDER_AGENT_SKILL)
}
