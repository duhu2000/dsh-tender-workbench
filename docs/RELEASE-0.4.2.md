# dsh-tender-workbench 0.4.2 发布清单

- Version: **0.4.2**
- 发布日期：2026-09-05
- Status: **release candidate**
- Git 标签：`v0.4.2`
- npm 目标：`dsh-tender-workbench@0.4.2`（`latest`）
- GitHub Release：<https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.2>

## 发布范围

0.4.2 是 npm Trusted Publishing 交付链路验证补丁。运行时代码、公共导出、工作流行为和 Artifact Schema 与 0.4.1 保持一致；版本通过 `v0.4.2` 标签触发 `.github/workflows/release.yml`，由 GitHub Actions OIDC 发布至 npm 并生成 provenance，不使用长期 npm Token。

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
- [x] 中文/英文 README 与 0.4.2 发布状态检查通过。
- [x] npm tarball 只包含白名单公开文件，且同时包含 `README.md` 与 `README.en.md`。
- [x] tag 模式检查确认 `v0.4.2` 与包版本一致。
- [ ] `main` CI 在 Linux Node 22/24 和 Windows Node 24 全部通过。
- [ ] npm Trusted Publishing OIDC 自动发布成功，`latest` 指向 0.4.2。
- [ ] npm provenance 可验证，仓库和工作流身份与 Trusted Publisher 精确匹配。
- [ ] GitHub Release 为 latest、非 draft、非 prerelease。

未勾选项均为待办，不得报告为已完成。发布成功后在 `main` 上追加不可变发布结果记录，不移动 `v0.4.2` 标签。

## 发布步骤

1. 使用 pnpm 11.7.0 执行 frozen install 和完整 `check`，再以 `GITHUB_REF_NAME=v0.4.2` 执行 tag 模式检查。
2. 审查 tarball 白名单与 Git diff，只提交 0.4.2 发布元数据并推送 `main`。
3. 等待所有必需 CI job 通过后，在发布提交上创建 annotated tag `v0.4.2` 并推送。
4. 由 GitHub Actions 通过 OIDC 自动发布；不使用手工 npm fallback 来替代本次验证目标。
5. 核验 npm version、dist-tag、provenance、中文 description、中文 README、仓库地址、tarball 摘要、Git 标签和 GitHub Release。

## 本地验证记录

2026-09-05 使用 Node.js 25.9.0 与 pnpm 11.7.0 完成验证：

- `pnpm install --frozen-lockfile`：通过，锁文件无需变更。
- `pnpm run check`：通过；40 个测试文件中 207 项通过、1 项预期跳过，并完成类型检查、生产构建、双语文档检查、发布状态检查和打包白名单验证。
- tag 模式检查：以 `GITHUB_REF_NAME=v0.4.2` 通过。
- tarball：170 个文件，全部位于发布白名单内。

上游 `@deepseek-ai/dsh-client-ui-primitives` 仍缺少其声明的 source map，Vitest 会给出提示；本包生成的 source map 完整，构建与门禁通过。

## 安全与回滚

- 禁止存储或输出 npm/GitHub Token、QCC 凭证、源数据集、真实业务证据或会话私有 Artifact。
- 推送标签前如门禁失败，修正发布提交并重新运行全部门禁。
- 推送标签后如自动发布失败，不复用或移动公开标签；诊断并使用新的补丁版本向前修复。
- npm 发布后不得覆盖或 unpublish 0.4.2；部署回滚目标为 `dsh-tender-workbench@0.4.1`。
