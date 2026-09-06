# dsh-tender-workbench

**中文** | [English](README.en.md)

> 面向国内招投标团队的 DeepSeek Harness 开源智能体插件：在一个会话级工作台内完成标讯与拟建项目查询、确定性规则初筛、限定范围智能分析、人工复核，以及 Excel/PDF 报告交付。
>
> 当前稳定版本：**0.4.5**（正式版本）

[![CI](https://github.com/duhu2000/dsh-tender-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/duhu2000/dsh-tender-workbench/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-tender-workbench)](https://www.npmjs.com/package/dsh-tender-workbench)
[![npm downloads](https://img.shields.io/npm/dm/dsh-tender-workbench)](https://www.npmjs.com/package/dsh-tender-workbench)
[![GitHub release](https://img.shields.io/github/v/release/duhu2000/dsh-tender-workbench)](https://github.com/duhu2000/dsh-tender-workbench/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 产品简介

`dsh-tender-workbench` 是 DeepSeek Harness 的 Host + Client 插件，适合需要持续发现、筛选、复核和交付招投标机会的国内业务团队。插件连接客户已安装并授权的 `qcc-tender` MCP，以结构化标讯事实为基础，将规则判断、Agent 建议和人工决策明确分开，形成可追溯的工作流。

完整业务闭环为：

1. **查询机会**：按已连接数据源支持的来源、关键词、日期、地区、阶段、采购方式、行业、类型、金额、审批及投资条件，查询招投标公告和拟建项目。
2. **规则初筛**：编辑 Agent 建议的筛选条件，先执行确定性影响预览，再确认规则集；结果被划分为纳入、观察、人工复核、规则排除和未匹配五个互斥类别。
3. **智能分析**：仅分析纳入、观察和需人工复核的记录；规则排除及未匹配记录不进入分析。任务按确定性批次运行，中断后可从剩余记录继续。
4. **人工复核**：分别查看待复核与已复核记录，参考但不自动采纳 Agent 建议，支持逐条或批量决策、保留备注，并可撤销最近一次复核操作。
5. **报告交付**：确认复核范围后，基于同一份不可变报告快照生成 Excel 与 PDF；仍有待复核记录时，会明确标记为部分交付。

## 核心能力

| 能力 | 实现方式 | 业务边界 |
| --- | --- | --- |
| 标讯查询 | 调用已授权的 `qcc-tender` 招投标与拟建项目搜索工具 | 不使用 Web 搜索兜底 |
| 规则初筛 | 条件编辑、Dry Run 影响预览、人工确认后的确定性分类 | 预览与确认是两个独立步骤 |
| Agent 分析 | 只覆盖纳入、观察、人工复核三类记录，按批次执行并可续跑 | 建议不会自动变成人工决策 |
| 人工复核 | 待办/已办分区、逐条与批量决策、备注、最近操作撤销 | 最终业务判断由用户完成 |
| Excel 报告 | 概览、分布、分来源结果、复核、追溯和数据质量工作表 | 面向分析与核验 |
| PDF 报告 | 确定性结论、结果分布、截止时间窗及近期需核验记录 | 当前不提供在线 PDF 预览 |
| 会话隔离 | 业务状态由类型化会话事件和不可变 Artifact 引用重建 | 不维护跨会话的第二套状态机 |

## 30 秒开始

先安装连接器、侧边栏能力和本插件：

```sh
dsh plugin --profile web add 'dsh-mcp-connector@>=0.2.31'
dsh plugin --profile web add 'dsh-better-sidebar@>=0.17.1'
dsh plugin --profile web add dsh-tender-workbench
dsh web --no-open
```

安装或移除插件后，请完整重启 Web Profile。插件通过 `dsh.bundle.patch` 启用 `cordis.patch.yml`，并注册 `dsh-tender-workbench` Loader。

安装指定的 `0.4.5` 版本：

```sh
dsh plugin --profile web add dsh-tender-workbench@0.4.5
```

移除插件：

```sh
dsh plugin --profile web remove dsh-tender-workbench
```

## 使用工作台

插件提供左上角“招投标”入口和会话 Header 恢复入口。点击左上角入口会在当前工作区、最近工作区或第一个可用工作区中创建一个独立的原生会话，为空白会话显示“招投标”标题与目标图标，并打开对应的 Better Sidebar 工作台；其他会话继续保留各自原有标题与标识。

页面导航只切换可见阶段，不会修改业务状态或自动执行后续动作。规则建议、编辑、影响预览与确认彼此独立；报告生成前始终展示已复核和待复核范围。宽屏使用主从布局，中窄屏保持相同信息顺序，并保留局部表格滚动与可访问的固定操作区。

## 数据、安全与费用边界

- 每个会话只有一份当前生效的标准化数据集。新查询成功后会原子替换当前快照，不与旧结果合并；历史 Artifact 仍可用于追溯，旧快照的后续业务状态不再生效。
- 对符合 Schema 的 MCP 字段按来源事实保留。字段缺失、已披露但无法解析、来源失败、规则排除和用户排除是不同状态，插件不会互相推断或补造。
- 浏览器端不直接调用 MCP，不读取连接器存储，也不持有 API 凭证；Host 负责校验意图、调用获授权工具、管理状态转换、保存会话私有 Artifact 并生成报告。
- 插件不修改 DeepSeek Harness 源码，不访问 Provider 内部实现，不把内部数据写入 Workspace。仓库和发布包不得包含 npm/GitHub Token、QCC 凭证、源数据集或会话私有 Artifact。
- `qcc-tender` 的授权范围、调用额度和费用由客户自己的 MCP 连接及相关服务合同决定；本插件不内置、不分发或共享开发者密钥，也不代理结算。

## 环境要求与兼容性

发布包声明以下最低兼容版本，不设置稳定版上限：

- DeepSeek Harness 公共包：`0.1.1-rc.2`
- `dsh-mcp-connector`：`0.2.31`
- `dsh-better-sidebar`：`0.17.1`
- Node.js：`^22.19.0 || >=24.0.0`

当前 Profile 必须提供同一套公共 Session Projection、JSONL Session Persistence、Tools、Skill、Sessions 和 WebServer 服务；Better Sidebar 必须提供公共 `targetedOpen` 与 `stateSubscription` 能力。

已安装并授权的 `qcc-tender` MCP 连接必须暴露以下精确工具名：

- `mcp__qcc-tender__search_tenders`
- `mcp__qcc-tender__search_proposed_projects`

缺少必要服务、Better Sidebar 能力不兼容、MCP 工具不可用或会话持久化不是 JSONL 时，插件会明确失败；不提供 Web 搜索、其他持久化或 Workspace 存储兜底。

## 升级与回滚

从已有版本升级：

```sh
dsh plugin --profile web add dsh-tender-workbench@0.4.5
dsh web --no-open
```

`0.4.5` 在 `0.4.4` 基础上补齐旧会话兼容保护：普通「新会话」不再复用旧版本留在工作区中的业务空白会话，恢复「探索未至之境」并收起业务侧栏。旧会话、历史和用户草稿保持不变；并发创建合并处理，插件卸载时撤销保护。公共导出、业务工作流和 Artifact Schema 不变。如部署环境出现特定回归，可重新安装 `dsh-tender-workbench@0.4.4` 并重启 Profile；旧会话误复用问题也会随回滚恢复。已发布的 npm 版本和 Git 标签保持不可变，后续修复使用新的补丁版本。

## 本地开发

使用仓库声明的 Node.js 与 pnpm 版本：

```sh
corepack pnpm@11.7.0 install --frozen-lockfile
corepack pnpm@11.7.0 run check
```

构建产物包括 Host Loader `lib/index.js`、Client Bundle `lib/client.js` 和 `lib/types/` 下的类型声明。

`check` 会执行类型检查、完整 Vitest 测试、生产构建、README/发布状态校验以及 npm tarball 白名单预检。配置 npm Trusted Publishing 后，[发布工作流](.github/workflows/release.yml)可使用 OIDC 和 provenance；手工发布不得声称 provenance。

省、市、区数据源快照维护在 [resources/area.ts](resources/area.ts)。版本变更见 [CHANGELOG.md](CHANGELOG.md)，发布检查见 [0.4.5 发布清单](docs/RELEASE-0.4.5.md)。

## 当前范围

当前版本不提供在线 PDF 预览、交付版本对比、已成功文件的重复生成、订阅、CRM 跟进、企业画像、来源准确性核验或 Bid/No-Bid 决策。查询、分类、分析和复核都可以作为合法结束点；只有用户明确操作后，后续阶段才会继续。

## 参与贡献

欢迎通过 [Issues](https://github.com/duhu2000/dsh-tender-workbench/issues) 提交缺陷与建议。提交代码前请运行完整 `check`，并避免在测试夹具、日志、截图或提交历史中加入真实客户数据和凭证。

## 许可证

[MIT](LICENSE)
