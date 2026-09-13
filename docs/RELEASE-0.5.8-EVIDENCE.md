# 0.5.8 发布完成证据 · 2026-09-13

状态：**published**。本记录在发布之后提交，不修改既有 tag 或 npm 包。

## 不可变发布链

- PR [#6](https://github.com/duhu2000/dsh-tender-workbench/pull/6)，最终 HEAD `164d4789df5c6e9f01535584607f0fb48b8c0e99`。
- PR [CI 34745077764](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34745077764)：Linux Node 22/24、Windows Node 24、PR installable package 四项成功。
- PR package artifact ID `10312704430`，归档 digest `sha256:cc10bf6fd5107c33a1e37fb7a38d3d5a6099d1e7fcef8ebc40ae39b8c78c1c34`（归档摘要，不等同 npm tarball 摘要）。
- 合并提交 `b1acbed35cae045ace8149c04e7941caa176202a`，tree `c4fb8b43ba26868c9e5f596e4c4473021db2465d`；与最终 PR tree 完全一致。
- main [CI 34745471644](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34745471644)：精确合并提交 Linux22/24、Windows24 成功；PR-only job 在 main 按设计跳过。
- Annotated tag `v0.5.8` 对象 `4becf3acdded49b1462efe63938c70eac99042ea`，peel 到上述合并提交，未覆盖/移动。
- [Release run 34745645244](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34745645244)：完整发布门禁、`npm publish --access public --tag latest --provenance`、创建 GitHub Release 均成功。
- [GitHub Release v0.5.8](https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.5.8)：2026-09-13T07:38:06Z，非 draft、非 prerelease。

## npm / provenance 回读

- [npm 0.5.8](https://www.npmjs.com/package/dsh-tender-workbench/v/0.5.8)：官方 registry 在线刷新后 `version=latest=0.5.8`；首次缓存回读仍为旧版本，已重新验证而非忽略。
- `gitHead=b1acbed35cae045ace8149c04e7941caa176202a`。
- 实际下载 tarball：703369 bytes，190 files；包内 package.json version 与中文 README 稳定版本标记为 0.5.8。
- SHA256：`b9bee813d953d6a9ddf6cdd2cc2be8523913aaba83851152bc259dbf64c894ba`。
- Registry integrity：`sha512-DUEKSbPkLds6UZUaLGAhuP5U++TtLFlgaK2uGS4B2TkSwp5pde6u72eAEri3iWyueWPGCY7q9E531KTFKlI8ZQ==`；与下载 bytes 一致。
- [公开 attestations](https://registry.npmjs.org/-/npm/v1/attestations/dsh-tender-workbench@0.5.8) 的 SLSA v1 subject SHA512 与下载包一致；resolvedDependencies.gitCommit 为合并提交；workflow 为本仓 `.github/workflows/release.yml`、ref `refs/tags/v0.5.8`；invocationId 精确绑定 run `34745645244/attempts/1`。
- npm 日志确认 GitHub Actions signed provenance，透明日志 [2815318666](https://search.sigstore.dev/?logIndex=2815318666)。此处核验公开 payload/摘要/来源绑定，不额外宣称完成独立 Sigstore 全链信任审计。
- 保留既有 build 的绝对路径影响，macOS 本地包与 Linux CI npm 包不承诺字节复现；以官方 registry 完整性和 provenance 为发布产物身份依据。

## 本地与真实宿主层级

- `npm run check` 全绿：45 files，267 passed，1 Windows-only 在 macOS skipped；8 组 Chromium 深浅色/视口回归通过，IME 契约保留。
- 真 DSH 0.1.2-rc.1 + Sidebar0.18.1 / absent：Workspace/Session、五入口、Tab X/Files/宿主收起、只读历史、真实 progress、重启、Excel/PDF 下载通过。0.17.1 不兼容组合预检和真实启动按预期阻断。
- 0.2.27 AI填表“入口缺失”为 button-vs-link 测试假阴性，已更正；清洗0.9.7 / 访前0.1.22 / 填表0.2.28 / 招投标0.5.8候选四插件组合入口/独立 Session 切换、回到招投标、历史明确导航原会话且不重绑 projection、重启恢复通过。AI填表侧另有独立组合复核。
- 只使用随机端口、临时隔离 Profile、合成用户与 Provider；未操作生产 DSH、未调用模型或付费 QCC。四产品完整业务与热 HMR、真实 Provider 权限/包装仍是独立后续验收项。
- 0.5.6 `src/host/tool-contract.ts` 内容 SHA256 保持 `0437d4a41e9bddb5dbb359f89fa658b21ea6572aa7d9d2121fc293ad94eb8eb0`，没有改写。
- 详细实现契约及历史回填/单进程写入限制见 [采用记录](HISTORY-PROGRESS-ADOPTION.md)。
