# dsh-tender-workbench 0.5.7

Version: **0.5.7**
Status: **published**

用户于 2026-09-11 追加授权 commit、push、tag 与 npm 发布。通过精确提交的完整门禁后合并 PR #5，推送新的 v0.5.7 tag，由 release.yml 通过 OIDC 发布；不移动旧 tag，不变更生产 Profile 或全局宿主。

## 范围与边界

采用 DSH-UX-001 v1.5.2 UX-04：入口解析 Workspace 身份并通过公开 sessions.create({ workspaceId, sessionId }) 创建会话。当前显式归属优先；旧未分组会话按已注册路径精确匹配，无当前目录时取首个 Workspace；有未注册目录时提示用户选择/注册，不回退到不相关的组。命名空间 ID 与 ordinary Session guard 防止普通空白复用，不再通过脱离 Workspace 隔离。

保留 0.5.6 的 snapshotEvents() + turn/start、直接用户请求、pending control.nextTool 与预览/确认授权边界，本版不修改 Host 工具实现。Better Sidebar 仍为可选增强，无侧栏保留原生会话/提示词/Host 工具，缺失提示不改变草稿或业务事实，不引入替代容器。

不自动搬迁历史未分组会话、不替换原生容器、不引入 alpha 依赖。真实模型/MCP及四产品同装由协调任务另外验收。回滚需恢复完整已备份的宿主/Profile/任务组合；0.5.6 仍有归组缺陷，不能声称回退后该问题已解决。

## 测试与证据

复用最终 npm pack + 实际 DSH 0.1.2-rc.1 隔离 Profile，三路径 absent / Sidebar 0.18.1 / 已知坏 0.17.1。新测试以两个 Workspace 验证选中组而非首组，断言业务与普通 Session 均保持归组；入口不建 Tab、不展开侧栏，五流程单例，Tab X、Files、宿主收起恢复，合成业务及 Excel/PDF 下载仍通过。

本地 check：43 文件、245 passed / 1 Windows-only skipped；UI 8/8。实际 DSH 无侧栏和 Sidebar 0.18.1 路径通过，旧 Sidebar 0.17.1 预检与实际启动按预期阻断。采用记录、实际结果与限制登记于 docs/WORKSPACE-OWNERSHIP-ADOPTION.md。

## 发布证据（2026-09-11）

- 实现提交 `b45df25601a8550488feb00600cab719aeae6b4c`；发布准备提交 `cc52297c7fd01d532ee583276c9ba4411df445a7` 仅改文档；[PR #5](https://github.com/duhu2000/dsh-tender-workbench/pull/5) 已合并。
- 发布提交 / npm gitHead：`75d93cddb9388f2307e5ff2830551cb6cfd2ddfc`，与已通过 PR 门禁的分支 tree 完全相同。
- [PR CI](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34565099236)：Linux Node 22/24、Windows Node 24、PR 可安装包全部通过。
- [main CI](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34565286062)：精确发布提交的三组门禁通过；PR 安装包作业按设计跳过。
- annotated tag `v0.5.7` object：`115e594ce6347c4b3ca1ba3d1088b8e9e59ea63c`，指向上述发布提交，未移动旧 tag。
- [Release 工作流](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34565443651)：安装、tag 校验、全量检查、npm provenance 发布和 GitHub Release 创建全部成功。
- [GitHub Release](https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.5.7)：非 draft、非 prerelease，发布时间 `2026-09-11T05:19:52Z`。
- Registry 指定版本可读、`latest=0.5.7`；发布者为 `GitHub Actions / npm-oidc-no-reply@github.com`，trustedPublisher=`github`，配置 ID=`oidc:20287148-0db1-42e9-969e-04b4ad02ce41`。npm 接受发布后曾提示后台处理，已等待至版本、latest 和 tarball 均可读取；未重复发布。
- [Registry attestation](https://registry.npmjs.org/-/npm/v1/attestations/dsh-tender-workbench@0.5.7)：SLSA provenance v1 的仓库、`.github/workflows/release.yml`、`refs/tags/v0.5.7`、commit 与 invocation 均匹配本次发布；subject SHA-512 匹配实际下载 tarball 与 Registry integrity。此为身份、内容和摘要交叉核验，不宣称独立完成 Sigstore 证书链验证。
- Registry integrity：`sha512-94XT9euUviMlHj8ZoS6XehAkqBtmHyI0i1IZLM5qC2v89udCtG3VQ9wJLLcv/MSN0Hyh0+LNIAKh9rci18z5jA==`。
- 线上 tarball SHA-256：`95a335569d3d5ac7eb91929552e3023380373dbae595e187785c8c2d6d8bb3bb`，180 文件。

实际 DSH/UI 回归对应发布前本地构建；正式 npm tarball 已下载并核对 provenance/摘要，未把本地 UI 验证表述为正式包重新跑完整矩阵。沿用既有 CSS 绝对编译路径相关哈希限制，不承诺本地与 CI 包字节一致。真实模型/计费 MCP、Context 与四产品共装仍待组合回归。上游 sourcemap 缺失、pnpm/action-setup 的 Node 20 运行时弃用提示为非阻断告警，不在本次修改依赖。

证据以独立 docs commit 回写 main；不可变 npm 包内清单保留发布时 ready-for-release 状态。未修改生产 Profile、全局宿主或其他工作树，未操作插件市场。
