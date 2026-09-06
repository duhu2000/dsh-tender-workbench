# dsh-tender-workbench 0.5.1 发布清单

- Version: **0.5.1**
- Status: **release candidate**
- 日期：2026-09-06
- 标签：`v0.5.1`
- npm：`dsh-tender-workbench@0.5.1`，目标 dist-tag 为 `latest`

## 范围与验证

「招投标」菜单仅创建并进入独立会话初始页，不自动创建或展开业务工作台。输入框下方功能按钮显式打开对应页面，会话头的手动恢复入口保留。不修改宿主全局侧栏偏好、历史布局、业务工作流或 Artifact Schema。

修复后完整门禁已通过：219 项测试通过、1 项既有跳过；类型、构建、文档和打包检查通过。隔离 React/Chromium 浅深色 × 四尺寸共 8 组通过，新增菜单进入保持关闭、按钮展开、再次菜单进入的回归断言。发布前再以 0.5.1 运行完整门禁。

## 发布流程

提交并推送 main，确认 Linux Node 22/24、Windows Node 24 CI 后创建不可变 annotated tag v0.5.1。release.yml 使用 GitHub OIDC Trusted Publishing 发布 npm 并生成 provenance，随后核对 Registry latest/gitHead/publisher、远端 tag 和 GitHub Release。

## 验收边界与回退

本次不重装或重启用户本机 DSH，不调用真实 QCC。浏览器测试是实际组件与隔离宿主 DOM，不等同于升级后的真实宿主验收。升级重启后需复测菜单初始页和下方功能按钮。

必要时回退 dsh-tender-workbench@0.5.0 并重启 Profile；菜单自动展开行为会恢复。无需迁移历史数据，不覆盖已发布 npm 版本或移动公开标签。
