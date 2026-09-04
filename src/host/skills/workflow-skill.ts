import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { TENDER_SKILL_CONTRACT_MARKER, TENDER_WORKFLOW_SKILL } from '../../contracts/orchestration.ts'
import { renderGlobalInvariants } from './global-invariants.ts'

export const TENDER_WORKFLOW_SKILL_REGISTRATION: SkillRegistration = {
  name: TENDER_WORKFLOW_SKILL,
  description: `[${TENDER_SKILL_CONTRACT_MARKER}] 介绍招投标工作台完整流程，回答当前状态、已有结果、阻塞原因和下一步，并把明确动作路由到查询、初筛、分析、复核或报告 Skill。`,
  whenToUse: '用户询问招投标工作台是什么、当前做到哪里、已有何种结果、为什么阻塞、下一步是什么，或用普通对话提出跨阶段需求时。',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'runtime',
  content: `# 招投标工作台

## 场景与目标

帮助用户在一个 Session 内完成真实查询、确定性初筛、可选证据分析、人工复核和不可变 Excel/PDF 交付。查询、分类、Agent 建议、用户决定和报告快照分别由各自的结构化事实拥有者维护。

## 全局约束

${renderGlobalInvariants()}

## 流程

\`query -> rules/classification -> optional analysis -> review -> report\`。查询后可以正常停止；分析可以跳过；复核和报告必须由用户明确推进。

## 状态服务

需要回答当前进度、结果、失败或下一步时，调用 \`tender_workbench_get_workflow_state\`。该 Tool 是只读的；只根据其 \`context.availableActions\` 和每项声明的 action Skill 给出建议。

## 行为 Skill 路由

- 查询或替换活动数据：\`tender-workbench-query\`
- 规则提议、调整、Dry Run、确认和分类：\`tender-workbench-screening\`
- 全量候选分析或当前项目追问：\`tender-workbench-analysis\`
- 单条/批量人工决定或撤销：\`tender-workbench-review\`
- 创建完整/阶段性报告或重试失败格式：\`tender-workbench-report\`

普通对话中的修改请求只有在用户目标、作用范围和当前状态足够明确时才能加载对应行为 Skill 并执行。普通对话 Tool 的 origin 必须使用 \`{ kind: 'conversation' }\`，不得复用此前结构化页面 Intent 的 intentId；同一动作后续调用只按 \`control.nextTool\` 继续。信息不足时先读取状态并追问。Skill 或必需 Tool 不可用时明确失败。`,
}
