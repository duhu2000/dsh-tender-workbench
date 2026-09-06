# dsh-tender-workbench 0.4.5 发布清单

- Version: **0.4.5**
- Status: **release candidate**
- 日期：2026-09-06
- 标签：`v0.4.5`
- npm：`dsh-tender-workbench@0.4.5`，目标 dist-tag 为 `latest`

## 范围与验证

补齐旧业务空白会话复用保护，普通新会话恢复原生首页及收起的业务侧栏。保留旧会话、历史和草稿；兼容包装可撤销，支持并发合并。公共导出和 Artifact Schema 不变。

本地修复测试 213 项通过、1 项跳过；三个插件的四组页面切换场景通过，用户已复测 OK。发布前重新执行完整 check 和 tag 一致性检查。

## 发布流程

提交并推送 main，确认 CI，再创建不可变的 annotated tag v0.4.5。由 release.yml 的 GitHub OIDC Trusted Publishing 发布并生成 provenance，随后核对 npm latest、GitHub Release 和运行结果。不使用长期 npm Token。

## 回退

必要时安装 dsh-tender-workbench@0.4.4 并重启 Profile；旧会话复用问题会恢复。不得覆盖已发布 npm 版本或移动公开标签。
