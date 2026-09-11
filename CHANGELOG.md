# Changelog

All notable changes to `dsh-tender-workbench` are documented in this file.

## [Unreleased]

## [0.5.7] - 2026-09-11

- 候选，未发布：按 DSH-UX-001 v1.5.2，以 workspaceId + 命名空间 sessionId 创建业务会话，修复新会话落入“未分组”；保留普通会话防复用守卫及 0.5.6 Host 授权契约。
- 新增所选 Workspace 归组、普通新会话、入口默认关闭、Tab X/宿主收起恢复与三侧栏路径的真实隔离回归；不自动迁移历史会话。

## [0.5.6] - 2026-09-10

- 统一 Better Sidebar optional peer、基础/工作台安装预检和运行时降级文案；不自动安装侧栏、不重写工作台容器。
- 修复 DSH 0.1.2-rc.1 Host 工具的 Session.snapshotEvents() 与 turn/start 轮次绑定，补真实 Session 契约，避免错误拒绝直接用户请求。
- 补无侧栏/兼容侧栏/已知错误组合的最终 tarball 验收与实际 Host 工具业务 fixture。

## [0.5.5] - 2026-09-10

- 迁移完整 DSH 0.1.2-rc.1 公共接口，移除旧客户端 runtime 与 conversationEvents 硬依赖；补事件定义卸载清理。
- 更新类型、Session 空白状态和 Workspace 导航适配；收窄兼容声明，增加最终产物真实宿主加载回归，避免旧模块测试替身掩盖启动故障。

## [0.5.4] - 2026-09-10

- 对齐共享交互规范 v1.5.0：强化 Better Sidebar 能力探针、Session 定向展开与订阅清理；五个流程入口复用同一 Tab，增加当前会话记录历史视图与缺失依赖提示。
- Tab 重开保留会话级阶段、查询草稿及查询/筛选子视图；阶段导航只显示图标和短名称，窄栏保留任务状态文字。真实 DSH 四插件组合回归待验。

## [0.5.3] - 2026-09-08

- 改善搜索元数据、安装说明、能力边界与四产品互链；无运行时或依赖变更。

## [0.5.2] - 2026-09-07

### Changed

- 首页输入框下方四个快捷入口对齐共享规范 v1.1.3：上图标、下文字的描边卡片，单行排列、窄屏内部横向滚动，浅深色与悬停/键盘焦点沿用企查查蓝；保留点击才打开工作台的交互。

## [0.5.1] - 2026-09-06

### Fixed

- 「招投标」菜单仅进入独立会话初始页，不再自动创建或展开右侧业务工作台；点击输入框下方功能按钮时才打开对应页面，会话头的手动恢复入口保留。

## [0.5.0] - 2026-09-06

### Added

- 对齐 DSH-UX-001 v1.1.0：保留目标图标和「招投标」菜单，企查查蓝首页标题「招投标智能体」，移除本业务首页预览标识。
- 输入框外下方四个快捷导航，只切换工作台视图，不执行查询。
- 居中提示词向导：查询范围、关键词、时间、地区及业务目标；只回填可编辑描述，不自动发送。已有输入支持追加/替换/取消，完整旧生成段可更新，不重复堆叠。
- 浅深色品牌、操作、状态、表头及焦点令牌；桌面和窄屏布局、弹窗固定头尾、Tab 焦点循环、Escape 和 IME 保护。

### Changed

- 撤销 root/single Hero 品牌槽位注册；通过本会话可恢复桥接插入品牌行，普通会话和其他插件不被染色。菜单在工作区之前插入，不抢首位。
- 工作台沿用真实查询、筛选、复核和交付能力，明确会话标识；保留 0.4.5 的会话隔离修复，不改变 Host、数据与制品契约。
- 新增提示词与品牌隔离回归，以及隔离 React/Chromium 浅深色 × 四尺寸 UI 验证脚本。

## [0.4.5] - 2026-09-06

### Fixed

- 普通新会话跳过旧版本仍附属工作区的招投标、访前尽调和数据清洗业务空白会话，恢复原生首页与收起的业务侧栏。
- 兼容保护保留历史会话和草稿，复用普通空白会话，合并并发创建，并支持卸载恢复原方法。
- 新增六项回归测试；三个插件连续切换经本机页面和用户复测通过。

## [0.4.4] - 2026-09-06

### Fixed

- 修复「新会话」误复用招投标工作台会话的问题：招投标入口会话改为仅以 `cwd`（工作区路径）创建、不再挂进工作区，DSH「新会话」的空白会话复用逻辑因此跳过它，恢复默认 DSH 标准页；只有点击「招投标」才进入带标题的工作台初始页。

## [0.4.3] - 2026-09-05

### Fixed

- Bounded the tender-session hero-headline sync so the MutationObserver that keeps the "招投标" headline can only correct the title a finite number of times before disconnecting, preventing an unbounded cross-plugin rewrite loop. The rewrite remains single-session-scoped (`isTenderEntrySessionId`) and the correction budget (`MAX_HERO_CORRECTIONS = 8`) makes the sync bounded.

### Compatibility

- Runtime implementation, public exports, workflow behavior, and Artifact schema are otherwise unchanged from 0.4.2; this patch only adds a correction budget to the tender hero title rewrite.

## [0.4.2] - 2026-09-05

### Changed

- Advanced the stable release metadata and bilingual installation guidance to 0.4.2 for an end-to-end Trusted Publishing verification release.
- Kept the runtime implementation, public exports, workflow behavior, and Artifact schema unchanged from 0.4.1.

### Security

- Publishes from the tag workflow through the npm Trusted Publisher binding for `duhu2000/dsh-tender-workbench` and `release.yml`, using GitHub Actions OIDC and npm provenance without a long-lived npm token.

## [0.4.1] - 2026-09-05

### Changed

- Reworked the GitHub and npm landing content into a Chinese-first product introduction for domestic customers, while preserving the complete English documentation in `README.en.md` with bidirectional language links.
- Replaced the npm package description with a concise Chinese capability summary and added Chinese discovery keywords for tender notices, proposed projects, and Qichacha.
- Updated packaging and release gates so both language pages and the 0.4.1 release record are verified in the public tarball.

### Compatibility

- The workflow, runtime implementation, public exports, and Artifact schema are unchanged from 0.4.0; this patch only changes product presentation and release metadata.

## [0.4.0] - 2026-09-05

### Added

- Stable Host + Client workbench flow for query, deterministic screening, bounded Agent analysis, explicit human review, and immutable Excel/PDF delivery.
- Session-scoped V2 Intent, Projection, Tool, Artifact, and runtime Skill contracts with strict validation and idempotent mutation receipts.
- Release gates for documentation/version consistency, stable-release metadata, full type/test/build verification, and an npm tarball file whitelist.
- Linux Node 22/24 and Windows Node 24 CI, plus tag-driven npm Trusted Publishing with provenance and GitHub Release creation.

### Changed

- Promoted the 0.3.0 beta line to the stable 0.4.0 distribution without changing its workflow or Artifact schema.
- Updated package repository, homepage, and issue metadata to `duhu2000/dsh-tender-workbench`.
- Stable installations now use the npm `latest` dist-tag; the previous `0.3.0-beta.1` remains available as an immutable rollback target.

### Security

- The npm package whitelist excludes source files, tests, scripts, fixtures, local evidence, caches, environment files, and credentials.
- Release automation uses GitHub OIDC Trusted Publishing and does not require a long-lived npm token in the repository.
- Runtime credentials remain owned by the authorized MCP connector; Session-private source data and generated Artifacts are not published.

[Unreleased]: https://github.com/duhu2000/dsh-tender-workbench/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.2
[0.4.1]: https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.1
[0.4.0]: https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.0
