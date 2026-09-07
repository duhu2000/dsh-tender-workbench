# dsh-tender-workbench 0.5.2 发布清单

- Version: **0.5.2**
- Status: **published**
- 日期：2026-09-07
- 标签：`v0.5.2`
- npm：`dsh-tender-workbench@0.5.2`，目标 dist-tag 为 `latest`

## 范围与验证

首页输入框下方四个快捷按钮对齐共享规范 v1.1.3：上图标、下文字的描边卡片，企查查蓝浅深色及 hover/focus 状态；桌面单行居中，窄屏菜单内部横滚。键盘聚焦时完整显示卡片和焦点环，仅滚动菜单，不滚动宿主会话。保留默认收起侧栏、点击按钮才打开对应工作台的行为。

不改动菜单名称、品牌图标、原生输入框、右侧业务能力、数据契约或其它插件。发布日期检查改为校验当前版本的日期标题格式，不再写死旧日期。

变更后的完整本地检查通过：219 项测试通过、1 项既有跳过；类型、构建、文档和打包校验通过。隔离 React/Chromium 浅深色 × 四种尺寸共 8 组通过，覆盖卡片尺寸/排列/颜色、键盘可达、窄屏横滚及侧栏显式打开。版本更新后再次执行完整门禁。

## 发布流程

提交并推送 main，确认 Linux Node 22/24 与 Windows Node 24 CI 后创建不可变 annotated tag v0.5.2。release.yml 使用 GitHub OIDC Trusted Publishing 发布 npm 并生成 provenance，随后核对 Registry latest/gitHead/publisher、远端 tag 和 GitHub Release。

## 验收边界与回退

本次不安装或重启用户本机 DSH，不调用真实 QCC。浏览器测试是实际组件与隔离宿主 DOM，升级后仍需真实宿主验收。必要时安装 `dsh-tender-workbench@0.5.1` 并重启 Profile；无需迁移数据，不覆盖 npm 版本或移动公开标签。

## 发布结果（2026-09-07 核验）

- 发布提交：`b946e97063ef3de44e6897ce429fc4c4f1d4ca52`；annotated tag `v0.5.2` 指向该提交。
- [CI 34071262963](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34071262963)：Linux Node 22/24、Windows Node 24 全部通过。
- [Release 34071395235](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34071395235)：完整门禁、npm provenance 发布与 GitHub Release 全部通过。
- npm Registry 回读：`latest=0.5.2`，`gitHead=b946e97063ef3de44e6897ce429fc4c4f1d4ca52`；发布者 `GitHub Actions <npm-oidc-no-reply@github.com>`，trustedPublisher 为 GitHub OIDC，含 SLSA v1 provenance。
- [GitHub Release v0.5.2](https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.5.2) 为正式版本，非 draft、非 prerelease。
- 本次未安装或重启用户 DSH，升级后需复测首页卡片与点击打开工作台。
