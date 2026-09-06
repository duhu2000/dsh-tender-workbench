# dsh-tender-workbench 0.5.0 发布清单

- Version: **0.5.0**
- Status: **release candidate**
- 日期：2026-09-06
- 标签：`v0.5.0`
- npm：`dsh-tender-workbench@0.5.0`，目标 dist-tag 为 `latest`

## 范围

企查查蓝 UI 升级：保留图标与菜单「招投标」，首页「招投标智能体」；新增快捷导航和只回填提示词向导。业务区域浅深色与窄屏适配，普通会话保持原生品牌。保留 0.4.5 会话隔离保护，Host 工作流和 Artifact Schema 不变。

## 发布门禁

执行 npm run check（typecheck、tests、build、文档版本、发布状态与打包白名单）；隔离 React/Chromium 浅深色 × 4 尺寸回归通过后提交并 push main，确认 CI，再创建不可变 annotated tag v0.5.0。release.yml 通过 GitHub OIDC 发布 npm，随后核对 npm latest/gitHead/provenance 和 GitHub Release。

## 验收边界

本地门禁通过：42 个测试文件 / 219 项通过 / 1 项既有跳过，构建和 178 文件打包白名单通过；独立 Chromium 浅深色 × 4 尺寸共 8 组通过。

本轮 UI 浏览器测试采用真实组件和隔离宿主 DOM，不是已安装 DSH 的运行验收，不调用真实 QCC、不修改或重启用户 DSH。目标宿主已检查 rc.2 对应源码；其它版本需重新验证。共享规范的业务适配范围及例外见仓库 docs/QCC-BLUE-UI-ACCEPTANCE.md。

## 回退

安装 dsh-tender-workbench@0.4.5 并重启 Profile；保留历史任务与制品，无数据迁移。不得覆盖 npm 已发布版本或移动公开 tag。
