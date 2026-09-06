# dsh-tender-workbench 0.4.4 发布清单

- Version: **0.4.4**
- 发布日期：2026-09-06
- Status: **published**
- 发布提交：`d9780946c24986e11ec60cc6ab9cf683f6640693`
- Git 标签：`v0.4.4`
- npm 目标：`dsh-tender-workbench@0.4.4`（`latest`）

## 发布范围

0.4.4 修复「新会话」误复用招投标工作台会话的问题。招投标入口会话从 `create({ workspaceId, sessionId })` 改为 `create({ cwd, sessionId })`：仅以工作区路径创建、不再挂进工作区 `sessionIds`，DSH 核心 `connectWorkspace` 的空白会话复用因此跳过它，「新会话」恢复默认 DSH 标准页；只有点击「招投标」才进入带标题的工作台初始页。运行时代码、公共导出、工作流行为和 Artifact Schema 与 0.4.3 保持一致；版本通过 `v0.4.4` 标签触发 `.github/workflows/release.yml`，由 GitHub Actions OIDC 发布至 npm 并生成 provenance。

## 兼容性与安装

- Node.js：`^22.19.0 || >=24.0.0`
- 包管理器：`pnpm@11.7.0`
- DeepSeek Harness 公共包：`>=0.1.1-rc.2 || >=0.1.2-0`
- `dsh-mcp-connector`：`>=0.2.31`
- `dsh-better-sidebar`：`>=0.17.1 || >=0.18.0-0`
- 必需 MCP 工具：`mcp__qcc-tender__search_tenders`、`mcp__qcc-tender__search_proposed_projects`

## 发布门禁

- [x] 使用仓库锁文件完成 frozen pnpm install。
- [x] TypeScript 类型检查通过。
- [x] 完整 Vitest 测试通过。
- [x] Host Loader、Client Bundle、source map 和类型声明构建成功。
- [x] 中文/英文 README 与 0.4.4 发布状态检查通过。
- [x] npm tarball 只包含白名单公开文件。
- [x] tag 模式检查确认 `v0.4.4` 与包版本一致。
- [x] `main` CI 在 Linux Node 22/24 和 Windows Node 24 全部通过。
- [x] npm Trusted Publishing OIDC 自动发布成功，`latest` 指向 0.4.4。
- [x] npm provenance 可验证。
- [x] GitHub Release 为 latest、非 draft、非 prerelease。

## 发布步骤

1. 使用 pnpm 11.7.0 执行 frozen install 和完整 `check`。
2. 审查 Git diff，提交 0.4.4 发布元数据与「新会话」会话归属修复并推送 `main`。
3. 等待必需 CI job 通过后，在发布提交上创建 annotated tag `v0.4.4` 并推送。
4. 由 GitHub Actions 通过 OIDC 自动发布；不使用长期 npm Token。
5. 核验 npm version、dist-tag、provenance、Git 标签和 GitHub Release。

## 发布结果

- annotated tag `v0.4.4` 指向发布提交 `d9780946c24986e11ec60cc6ab9cf683f6640693`；Release workflow run `34013433612` 的 frozen install、标签检查、完整门禁、npm 发布和 GitHub Release 创建全部成功。
- `main` CI run `34013431159` 在 Linux Node 22/24 与 Windows Node 24 全部通过。
- npm 发布通过 GitHub Actions OIDC Trusted Publishing 完成并签署 provenance，未使用长期 npm Token。
- registry 回读确认 `latest` 为 0.4.4，仓库为 `duhu2000/dsh-tender-workbench`。
- GitHub Release：<https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.4>。

## 安全与回滚

- 禁止存储或输出 npm/GitHub Token、QCC 凭证、源数据集或会话私有 Artifact。
- 推送标签后如自动发布失败，不复用或移动公开标签；诊断并使用新的补丁版本向前修复。
- npm 发布后不得覆盖或 unpublish 0.4.4；部署回滚目标为 `dsh-tender-workbench@0.4.3`。
