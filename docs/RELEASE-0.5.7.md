# dsh-tender-workbench 0.5.7

Version: **0.5.7**
Status: **release candidate**

本轮仅授权修复、commit/PR。0.5.6 的发布授权已执行完毕；本候选不合并、不打 tag、不发布 npm/Release，不变更生产环境。

## 范围与边界

采用 DSH-UX-001 v1.5.2 UX-04：入口解析 Workspace 身份并通过公开 sessions.create({ workspaceId, sessionId }) 创建会话。当前显式归属优先；旧未分组会话按已注册路径精确匹配，无当前目录时取首个 Workspace；有未注册目录时提示用户选择/注册，不回退到不相关的组。命名空间 ID 与 ordinary Session guard 防止普通空白复用，不再通过脱离 Workspace 隔离。

保留 0.5.6 的 snapshotEvents() + turn/start、直接用户请求、pending control.nextTool 与预览/确认授权边界，本版不修改 Host 工具实现。Better Sidebar 仍为可选增强，无侧栏保留原生会话/提示词/Host 工具，缺失提示不改变草稿或业务事实，不引入替代容器。

不自动搬迁历史未分组会话、不替换原生容器、不引入 alpha 依赖。真实模型/MCP及四产品同装由协调任务另外验收。回滚需恢复完整已备份的宿主/Profile/任务组合；0.5.6 仍有归组缺陷，不能声称回退后该问题已解决。

## 测试与证据

复用最终 npm pack + 实际 DSH 0.1.2-rc.1 隔离 Profile，三路径 absent / Sidebar 0.18.1 / 已知坏 0.17.1。新测试以两个 Workspace 验证选中组而非首组，断言业务与普通 Session 均保持归组；入口不建 Tab、不展开侧栏，五流程单例，Tab X、Files、宿主收起恢复，合成业务及 Excel/PDF 下载仍通过。

采用记录、实际结果与限制登记于 docs/WORKSPACE-OWNERSHIP-ADOPTION.md；没有实际通过前不把计划写成验收结论。安装包仅供 PR 审查，不是 npm 已发布版本。
