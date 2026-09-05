# dsh-tender-workbench 0.4.1 发布清单

- Version: **0.4.1**
- 发布日期：2026-09-05
- Status: **release candidate**
- 发布提交：待发布门禁与 CI 全部通过后填写
- Git 标签：`v0.4.1`（待创建）
- npm 发布：`dsh-tender-workbench@0.4.1`（待发布到 `latest`）
- GitHub Release：<https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.4.1>（待创建）

## 发布范围

0.4.1 是面向国内客户的中文展示补丁。GitHub 默认 `README.md` 与 npm 包首页改为中文优先，完整英文文档保留在 `README.en.md`，两个页面提供双向语言切换；npm `description` 与检索关键词同步更新。工作流、运行时代码、公共导出和 Artifact Schema 与 0.4.0 保持一致。

## 兼容性与安装

- Node.js：`^22.19.0 || >=24.0.0`
- 包管理器：`pnpm@11.7.0`
- DeepSeek Harness 公共包：`>=0.1.1-rc.2 || >=0.1.2-0`
- `dsh-mcp-connector`：`>=0.2.31`
- `dsh-better-sidebar`：`>=0.17.1 || >=0.18.0-0`
- 必需 MCP 工具：`mcp__qcc-tender__search_tenders`、`mcp__qcc-tender__search_proposed_projects`

安装 `dsh-tender-workbench@0.4.1` 及兼容 Provider 插件后，应完整重启 Web Profile。缺少必要服务、Better Sidebar 能力不兼容、MCP 工具不可用或会话持久化不是 JSONL 时，插件会明确失败。

## 发布门禁

- [x] 使用仓库锁文件完成 frozen pnpm install。
- [x] TypeScript 类型检查通过。
- [x] 完整 Vitest 测试通过。
- [x] Host Loader、Client Bundle、source map 和类型声明构建成功。
- [x] 中文/英文 README 与 0.4.1 发布状态检查通过。
- [x] npm tarball 只包含白名单公开文件，且同时包含 `README.md` 与 `README.en.md`。
- [x] 干净临时安装可导入 Host 入口、读取 0.4.1 元数据并注册 Client Bundle。
- [ ] `main` CI 在 Linux Node 22/24 和 Windows Node 24 全部通过。
- [ ] annotated tag `v0.4.1` 指向经审查的发布提交。
- [ ] npm 发布成功，`latest` 指向 0.4.1，description 和 README 均为中文优先。
- [ ] GitHub 默认 README 与 About 简介均为中文，GitHub Release 非 draft、非 prerelease。
- [ ] npm Trusted Publishing provenance 已生效；若采用手工 fallback，本项保持未勾选且不得声称 provenance。

未勾选项均为待办，不得报告为已完成。

## 本地验证记录

2026-09-05 使用 pnpm 11.7.0 完成验证：

- `pnpm install --frozen-lockfile`：通过，仓库锁文件无需变更。
- `pnpm run check`：通过；40 个测试文件中 207 项通过、1 项预期跳过，并完成类型检查、生产构建、双语文档检查、发布状态检查和打包白名单验证。
- tag 模式检查：以 `GITHUB_REF_NAME=v0.4.1` 通过。
- tarball：170 个白名单公开文件；最终 SHA-1 与完整性值在发布后从 npm registry 回读并记录，避免发布包自引用改变摘要。
- 隔离安装：补齐同一 DSH Host peer 基线后，Host 入口导出 `apply` 和 6 项 `inject`，包元数据为 0.4.1 且 description 为中文，Client Bundle 以 `dsh-tender-workbench` 注册，中文 README 标记存在。

上游 `@deepseek-ai/dsh-client-ui-primitives` 仍缺少其声明的 source map，Vitest 会给出提示；本包生成的 source map 完整，构建与门禁通过。普通 npm peer 自动安装仍可能遇到 DSH peer 组合约束，生产 DSH 插件管理器负责提供一致的 Host peer 集合。

## 发布步骤

1. 使用 pnpm 11.7.0 执行 frozen install。
2. 执行 `pnpm run check`、tag 模式发布检查和干净 tarball 安装/导入冒烟。
3. 只提交经审查的 0.4.1 文件并推送 `main`。
4. 等待所有必需 CI job 通过。
5. 在发布提交上创建 annotated tag `v0.4.1` 并推送。
6. 若 npm Trusted Publisher 已正确关联 `duhu2000/dsh-tender-workbench` 与 `.github/workflows/release.yml`，由 tag workflow 通过 OIDC 发布并创建 GitHub Release；否则仅在确认 registry 中不存在 0.4.1 后，使用已授权 npm 账号手工发布同一经审查 tarball，并明确记录无 provenance。
7. 核验 npm version、dist-tag、中文 description、中文 README、仓库地址、维护者、tarball 文件清单、干净安装、Git 提交/标签及 GitHub Release/About 状态。

## 安全

- 禁止存储或输出 npm/GitHub Token、QCC 凭证、源数据集、真实业务证据或会话私有 Artifact。
- npm 包必须排除 `src`、测试、脚本、`.github`、`resources`、缓存、本地证据、环境文件与凭证。
- QCC 访问继续由客户通过连接器授权；仓库不持有或代理凭证。
- pnpm `allowBuilds` 策略继续禁用间接依赖 `node-pty` 的原生构建脚本，本包运行时和发布门禁均不使用其二进制文件。

## 回滚

- 推送标签前：仅删除必要的本地标签，修正发布提交并重新运行全部门禁。
- 推送标签后、npm 发布前：停止失败工作流，以新补丁版本向前修复，不复用公开标签。
- npm 发布后：不得覆盖或 unpublish 0.4.1；如需修复，发布新的补丁版本，源码回滚使用普通 revert 提交。
- 部署回滚目标：重新安装 `dsh-tender-workbench@0.4.0` 并完整重启 Profile。
