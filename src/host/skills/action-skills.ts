import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import {
  TENDER_SKILL_CONTRACT_MARKER,
  type TenderActionSkillName,
} from '../../contracts/orchestration.ts'
import { renderGlobalInvariants } from './global-invariants.ts'

const invocation = { modelInvocable: true, userInvocable: true } as const

function actionSkill(
  name: TenderActionSkillName,
  description: string,
  whenToUse: string,
  body: string,
  invariantIndices: readonly number[],
): SkillRegistration {
  return {
    name,
    description: `[${TENDER_SKILL_CONTRACT_MARKER}] ${description}`,
    whenToUse,
    invocation,
    source: 'runtime',
    content: `${body}\n\n## 共同约束\n\n${renderGlobalInvariants(invariantIndices)}`,
  }
}

export const TENDER_QUERY_SKILL = actionSkill(
  'tender-workbench-query',
  '执行 query.run：校验招投标/拟建/组合查询，并通过 tender_workbench_run_query 原子替换当前活动数据。',
  '用户明确开始一次查询或重新查询时。',
  `# 查询机会

## 目标和范围

执行用户已经确认的招投标、拟建项目或组合查询。查询条件以 Intent payload 为准，Tool 会再次校验来源分支、日期、地区、金额、枚举和上限。

## 调用流程

1. 工作台 Intent 必须是 \`query.run\`；普通对话必须有明确查询目标和至少一个真实筛选条件。
2. 调用 \`tender_workbench_run_query\`，原样传递 origin、Projection revision 和查询 payload。
3. 读取返回的来源状态、活动数据引用和 \`control\`。至少一个来源成功时查询完成；全部来源失败时旧活动数据保持不变。
4. 完成后停止。只建议查看结果、生成初筛口径，或在用户明确要求时直接进入 dataset-only 人工复核；分析必须先有分类，报告必须先形成复核范围。不得提示当前状态尚不允许的动作。`,
  [0, 1, 2, 3, 6, 7, 8],
)

export const TENDER_SCREENING_SKILL = actionSkill(
  'tender-workbench-screening',
  '执行 rules.propose/rules.adjust/rules.preview/rules.confirm：形成一层规则、Dry Run，并由 Host 确认和全量分类。',
  '用户要求生成或调整初筛口径、保存草案并 Dry Run、确认口径并分类时。',
  `# 初筛与分类

## 目标和规则

规则只允许一层、确定性的来源范围、字段范围、关键词、例外、动作和优先级。不使用默认行业规则。分类只能由 Host 的确定性分类器产生。

## 调用流程

- \`rules.propose\`：先调用 \`tender_workbench_get_rule_drafting_context\`；只基于返回的查询范围、统计、最多 8 条样本和 context fingerprint 形成完整规则，再调用一次 \`tender_workbench_preview_rules\` 的 \`agent-proposal\` 分支。
- \`rules.adjust\`：基于 Intent 中的完整当前草案和调整要求，调用一次 \`tender_workbench_preview_rules\` 的 \`agent-adjustment\` 分支，并绑定 base draft fingerprint。
- \`rules.preview\`：把用户编辑的完整草案传给 \`tender_workbench_preview_rules\` 的 \`user-dry-run\` 分支。
- \`rules.confirm\`：调用 \`tender_workbench_confirm_rules\`，只传当前预览引用和草案指纹；Tool 从预览 Artifact 读取规则、重新分类并校验一致性。

一个 Intent 只允许产生一次新的预览或确认结果。预览不是确认，确认后才形成不可变规则版本和五类分类结果。`,
  [0, 1, 3, 4, 6, 7, 8],
)

export const TENDER_ANALYSIS_SKILL = actionSkill(
  'tender-workbench-analysis',
  '执行 analysis.run/analysis.follow-up：分析全部 include+observe+manual-review 候选，或读取当前记录的 Host 校验上下文回答问题。',
  '用户明确运行全部候选分析，或在分析结果中询问当前项目时。',
  `# 候选证据分析

## 全量分析

唯一范围是当前分类中的 \`include + observe + manual-review\`，固定排除 \`exclude + unmatched\`。调用 \`tender_workbench_prepare_analysis_batch\`：

- \`control.complete\`：包括 \`0/0\` 或已经完整，立即停止，不调用 commit。
- \`control.continue\`：只使用 batch 中每条记录允许的 evidenceRef 形成 \`priority-review/watch/not-recommended\` 建议，随后调用 \`tender_workbench_commit_analysis_batch\`。
- commit 后仍为 continue 时，使用返回的 binding 和 nextTool 继续准备下一批；只有 \`completed === eligibleTotal\` 才完成。

建议必须逐条对应批次记录，说明理由、待核验项和局限。失败或中断后只处理剩余记录。

每次进度和最终回答只能逐字段使用 Tool Result 的 \`progress.completed/eligibleTotal/remaining/recommendationCounts\`；不得按本批建议、历史批次或模型上下文重新计数。最终 \`control.complete\` 后如需说明三档分布，必须原样复述 \`recommendationCounts.priorityReview/watch/notRecommended\`。

每条 recommendation 必须提供当前 batch 返回且属于该记录的至少一个 evidenceRef，并提供非空 reason、verificationItems 和 limitations；recommendations 必须与 batch records 一一对应，不能提交空引用占位。

最终可见回答只报告完成进度、三档确定性计数、analysisArtifactRef 和“可进入人工复核”；不得重新列候选清单、解释分布原因、生成价值标签或复述批次内项目事实。完整记录、证据和排序由工作台从 Artifact/Projection 展示。

Host 对 \`中标概率/中标可能性/成交概率/投标建议/企业适配/资格符合/利润/毛利/转化率/Bid-No Bid\` 执行确定性禁用词校验；这些词即使是否定句或免责声明也不要写入 reason、verificationItems 或 limitations。改用“金额不足以判断商业回报”“需要核验资格要求”等来源事实表达。prepare 或 commit 参数/内容校验失败且 Projection 仍保留同一 pending Intent 时，只修正报错字段并重试当前 expectedTool；不得换 batch、扩大记录或改写用户范围。若 pending 已清除或 Turn 结束，再由用户创建新的 \`analysis.run\` Intent 恢复剩余记录。

## 当前项目追问

\`analysis.follow-up\` 只调用 \`tender_workbench_get_analysis_record_context\`。仅基于返回的来源事实、分类、建议、证据、待核验项和局限回答；不重新查询，不修改任何业务事实。`,
  [0, 1, 3, 4, 5, 6, 7, 8],
)

export const TENDER_REVIEW_SKILL = actionSkill(
  'tender-workbench-review',
  '执行 review.apply/review.revert：按 dataset-only 或 classified basis 保存明确用户决定，或撤销当前链路最近一次复核。',
  '用户明确保存单条/批量人工复核决定、备注或撤销最近操作时。',
  `# 人工复核

## 业务边界

人工决定只有 \`confirmed-candidate/watch/exclude/pending\`。决定和备注来自用户，不能从初筛分类或 Agent 建议自动映射。

## 调用流程

- 应用决定：调用 \`tender_workbench_apply_review\`，使用当前 \`dataset-only\` 或 \`classified\` basis，并逐条传递用户明确指定的 recordRef、decision 和 note。不得扩大记录集合。当前没有 review Artifact、\`reviewRevision=0\` 时省略 \`reviewArtifactRef\`，不得传空字符串。
- 撤销：调用 \`tender_workbench_revert_review\`，绑定当前 review 和 latest operation；只恢复最近一次操作。

成功后停止。复核可以在没有分类或没有 Agent 分析时进行，但 Tool 会校验 basis 与当前活动数据一致。`,
  [0, 1, 3, 4, 6, 7, 8],
)

export const TENDER_REPORT_SKILL = actionSkill(
  'tender-workbench-report',
  '执行 report.create/report.retry：从当前复核事实创建不可变报告快照，或只重试同一快照的失败格式。',
  '用户明确确认完整/当前进度范围并生成报告，或重试当前快照失败的 Excel/PDF 时。',
  `# 形成交付

## 创建报告

- \`narrativeMode=none\`：直接调用 \`tender_workbench_create_report\`，叙述分支使用 \`{ kind: 'none' }\`。
- \`narrativeMode=requested\`：先调用 \`tender_workbench_get_report_narrative_context\`；只基于返回的有界指标、分布、最多 10 条记录引用形成补充观察，再调用 \`tender_workbench_create_report\` 的 bound narrative 分支，原样绑定 fingerprint 和 as-of。

Bound narrative 每项最多 10 个 metricRefs、10 个 distributionRefs、10 个 recordRefs 和 5 条 limitations；keyFindings 最多 5 项、priorityVerification 最多 10 项、risksAndLimitations 最多 5 项。title、statement 和 limitations 不写阿拉伯/全角数字、百分比、金额或日期字面值，所有量化事实只通过当前上下文引用表达。Tool 指出具体 path 或命中值且 Projection 仍保留同一 pending Intent 时，只修正该字段并重试 \`tender_workbench_create_report\`。

存在待复核记录时，只有用户明确确认当前进度范围才能创建阶段性报告。Host 固定数字、选择、排序、Sheet、章节、图表和版式；没有补充叙述也必须形成完整的确定性主结论。

当前没有 review Artifact、\`reviewRevision=0\` 时省略 \`reviewArtifactRef\`，不得传空字符串。

## 重试

\`report.retry\` 只调用 \`tender_workbench_retry_report\`，只传当前 final snapshot 和失败格式。不得重新查询、分类、分析、复核、生成叙述或创建新快照。`,
  [0, 1, 3, 4, 5, 6, 7, 8],
)

export const TENDER_ACTION_SKILL_REGISTRATIONS = [
  TENDER_QUERY_SKILL,
  TENDER_SCREENING_SKILL,
  TENDER_ANALYSIS_SKILL,
  TENDER_REVIEW_SKILL,
  TENDER_REPORT_SKILL,
] as const satisfies readonly SkillRegistration[]
