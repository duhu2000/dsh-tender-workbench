# 可选工作台与真实 Host 契约采用记录（0.5.6）

日期：2026-09-10。基于 main `5ef0c3d26a42d75d01b37a0bc9b2340c12de29ef`，独立分支 `fix/optional-sidebar`；原工作树不改动。用户本轮授权 commit、push、tag、npm 发布，门禁通过后走 PR → 精确 main CI → annotated tag → OIDC。

## 规范与边界

已完整核对 DSH-UX-001 v1.5.1 第 7、13.4、14、15、15.1 节及原生迁移评估。v1.5.0 的 adapter 契约采用记录继续见 [QCC-BLUE-UI-ACCEPTANCE.md](QCC-BLUE-UI-ACCEPTANCE.md)。本版不抢占 `details`，不使用 `shell.overlay` 或 fixed 抽屉替代工作台，不模拟 DOM 点击原生导航，不引入 `ui-sidebar-right`、`dockkit` 或 `file-upload` alpha 包。

- UX-40/41：沿用 `dsh-tender-workbench:agent`、`single:true`、Session 定向打开、显式 reveal；五入口只导航同一 Tab，业务事实仍来自 Session 投影和 Host 制品。
- UX-42：Tab X/宿主几何控制不搬进业务内容，关闭 Tab 不清理任务与草稿。Tab X 和 Files 切换在真实 DSH 重验；后台 Session、底部/浮窗几何与卸载沿用 adapter 契约测试，尚非本版四产品共存实测。
- UX-43：manifest optional peer 与可卸载依赖子 Context 一致。未安装侧栏时核心入口、对话槽位和 Host 正常加载；五入口只给可行动提示，保留原生草稿和业务状态。安装、预检及 README 不自动强装侧栏。
- UX-44：本轮只保持容器边界，不实施原生迁移或建立跨仓业务强依赖。后续 WorkbenchSurfacePort 可复用适配器契约；任务/数据/确认/导出逻辑不应搬到容器适配器中。历史仍限定当前 Session，不宣称已经实现跨任务历史索引。

## 修复实际 Host 缺陷

0.5.5 的页面/只读 Skill smoke 未覆盖实际业务管道；本轮实际 Host 查询暴露 `Session.events` 已移除且 `UserMessage.turn` 不存在。现在通过 `Session.snapshotEvents()` 读取事件、`turn/start` 获取轮次；运行中 conversation action 保持 pending 的 turn 与 `control.nextTool` 约束。真实 Session 类测试明确断言不存在 `events`，避免旧测试替身掩盖 API 漂移。

生产包增加 optional peer 和旧 Host API 防回归检查，Agent/Scope 仅为本地真实类型/测试 devDependencies。独立诊断插件及合成工具不进入 npm 白名单。

## 分层验证

- L1：`npm run check` 全通过；43 个测试文件、242 passed / 1 Windows-only skipped（macOS），含类型、构建、双语文档、版本/tag 和 180 文件 pack 白名单检查。`test:ui` 浅/深色 × 1440×900、1024×768、390×700、900×500，8/8。
- L2：实际完整 DSH 0.1.2-rc.1、Node v25.9.0、macOS Chromium，最终原始 tarball 通过官方 `initProfile` + `dsh plugin install` 装载。临时 HOME/DSH_HOME、随机非 3080 端口，不读取生产配置/密钥。不把版本预检当作运行能力验收。
- L3：真实已注册 Host 工具、Agent、Session、投影、本地 Excel/PDF 和 HTTP 下载；QCC 数据源与直接用户消息为合成 fixture，没有模型执行或真实计费 MCP。13 个工具可用；实际执行查询、规则上下文/预览/确认、人工复核、部分进度报告、只读状态。查询数据源一次，预览不确认；最终 2 条记录、1 条复核、1 条待处理，revision=5。下载响应 200，XLSX `PK` 与 PDF `%PDF-` 文件签名及大小有效。重复五入口不改变完整业务投影。
- L4：真实模型选择工具、真实企查查授权与额度、真实客户数据 **未测试**。不将 fixture 说成真实 Provider 验收。

## 安装与功能边界

无侧栏可用：原生独立会话、可编辑草稿、提示词生成/追加、行为 Skill、已支持的对话 Host 查询/预览/确认/复核/报告与 Artifact 下载接口。

无侧栏不可用：可视化条件面板、工作台表格/筛选/详情、批量复核控件、任务历史页面及下载按钮。流程入口不自动执行任务，也不临时新建另一套侧栏。

基础预检允许侧栏缺失；`--workbench` / Windows `-Workbench` 明确要求安装侧栏，Windows 在写 Profile 前检查 bundle 启用，运行时再探测 targetedOpen/stateSubscription 与 Tab 启用。已安装 Sidebar 0.17.1 + DSH 0.1.2 的 settingsNamespace 故障仍阻断，不能用 optional 豁免。Context 非必装，已有 0.36.0 阻断；本轮最终矩阵不含 Context，0.48.0 共存证据沿用 0.5.5，不推断其他版本。

官方 Profile 自带 `nodeLinker: hoisted` / `autoInstallPeers:false`，由完整宿主提供 core peers；测试使用官方模板，不添加宽松解析绕过。空 npm 项目自动补齐 peer 时仍可能因 Connector 的旧 core peer 范围 ERESOLVE，不是受支持的基础安装路径。

## 可复用测试模式

运行 `scripts/native-host-smoke.mjs`，提供显式 `TENDER_DSH_BIN`、`TENDER_PLAYWRIGHT`、`TENDER_CHROME`、`TENDER_PNPM_STORE`，以 `TENDER_TEST_SIDEBAR=absent|compatible|incompatible` 切换矩阵。脚本自动 build、pack、隔离安装、启动/浏览器/业务检查、保存 result.json，并终止自身创建的宿主进程；不写正式 Profile。

诊断代码与生产代码必须分开：诊断插件只在有 Sidebar 的矩阵声明它读取的服务；不允许诊断代码使 absent 矩阵永久等待。输出移除合成 Artifact capability token。

## 最终包矩阵

三组使用相同 npm 内容 SHA-256，结果目录仅含本轮合成证据。

| Sidebar | 结果 | 隔离目录 / 端口 |
| --- | --- | --- |
| 未安装 | L2/L3 PASS；基础安装不强装侧栏，五入口提示、草稿/提示词、业务、下载、重复导航状态保留 | `tender-native-7U8NbT` / 55765 |
| 0.18.1 | L2/L3 PASS；单例 Tab、关闭重开、Files、草稿与业务投影保留 | `tender-native-hyUHwk` / 55488 |
| 0.17.1 | EXPECTED_STARTUP_FAILURE；预检阻断且实际装载复现 settingsNamespace 缺失 | `tender-native-epuJ62` / 55902 |

包 SHA-256：`10169f2b3192815791bea2312f51ce4a0855a0f9fa674fbff4971891b78a8ea2`。上述目录位于系统临时目录；完整路径由各 result.json 的 home 字段记录。本记录不在 npm 白名单，补写证据不改变待发 tarball。

## 后续组合回归与限制

四产品最终包同装；后台 Session 不抢焦点/几何；宿主折叠、右/底部/浮窗迁移；执行中关闭/切换/卸载；刷新/重启后业务恢复；长表/大报告；真实授权模型/MCP。本轮未实际执行 analysis batch、review revert、report retry 的完整原生路径，保留其单元/契约证据，不以工具注册成功替代业务执行通过。Windows 实际 DSH UI 未跑，由 CI 覆盖 Node24 单元/安装脚本 self-test。

上游 primitives 缺 source map 产生非阻断警告，未伪装为零警告。诊断首次漏 inject 与 fixture MCP 返回封装错误保留失败记录，修正后复跑；不能把测试驱动错误当作产品修复。

## 发布回报

已通过 [PR #4](https://github.com/duhu2000/dsh-tender-workbench/pull/4) 与精确 main CI，于 `4ccf9011539b4c25a9f1ed445654db246fd9afe7` 发布 `v0.5.6` / npm `0.5.6`（latest）。OIDC、provenance、Registry、tag 与 GitHub Release 的完整回读见 [发布清单](RELEASE-0.5.6.md)。本地原始包与 CI 构建的包摘要不同，差异为绝对编译路径相关的 CSS 类名/注释；已独立重算并严格比较 Client 全文，Host 字节一致，未掩盖此构建可重复性限制。
