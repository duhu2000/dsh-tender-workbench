# dsh-tender-workbench 0.5.4

Version: **0.5.4**
Status: **published**（2026-09-10，Asia/Shanghai）

## 范围与授权

用户已明确授权 commit、push、tag 和 npm 发布。目标为公开 npm 的 latest，由 release.yml 的 GitHub Actions OIDC 发布，并生成 provenance。

本次对齐共享交互规范 v1.5.0：Session 单例 Tab、五入口 open/focus/定位、能力探针、显式 reveal、跨 Session/Files/Tab X 竞态保护、订阅和卸载清理、缺少依赖的可行动提示。当前/历史导航、查询草稿及主要子视图在 Client 生命周期内恢复；阶段导航去除第二行状态，窄栏保留上下文与状态文字。

保留原目标图标与「招投标」菜单。不改变 Host 业务数据格式、依赖、权限、计费或其他仓库，不发布市场资料。

## 验证与限制

发布前完整 npm run check、隔离 Chromium UI 矩阵及 git diff --check 均通过：42 个测试文件、230 测试通过、1 项既有跳过；typecheck/build/docs:check/release:check/180 文件打包白名单通过。8 组浅深色/尺寸 UI 回归及 320px 容器验证通过。PR、精确 merge SHA 的 main CI 以及 Release 内重复发布门禁均通过。

真实 DSH 四插件同装和真实 QCC Provider 本轮未运行，不能由发布成功代签。历史仅提供本 Session 已保存查询记录；跨会话索引、实时 MCP 连接状态、细粒度未提交编辑的统一恢复未接入。查询草稿/导航内存刷新或卸载后清除，任务/制品由 Host 保留。兼容对照 Better Sidebar 0.17.1 的公开能力与 mount/store 契约，不扩大 peer 范围。

## 流程及回滚

release 分支 → PR CI/审核 → 锁定 SHA 合并 → 精确 main SHA CI → annotated v0.5.4 → OIDC npm/provenance → GitHub Release → Registry 回读。公开 tag/版本不覆盖；失败不得复用 npm 版本。

回滚：备份用户任务目录后安装 dsh-tender-workbench@0.5.3，并按既有方式重启 DSH web；本轮不操作用户生产进程。

## 发布证据

| 项目 | 已核验结果 |
| --- | --- |
| 发布分支 / 原子提交 | `release/0.5.4` / `19210de190fa45b9c86845e4358b33d4d9ff7d51` |
| PR / 合并 | [PR #2](https://github.com/duhu2000/dsh-tender-workbench/pull/2)，锁定上述 head 合并 |
| 发布提交 / npm gitHead | `58b3873dc46d76bfb054f6508f028a20c5d5eeb2`，两者一致 |
| PR CI | [34415559394](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34415559394)，Linux Node 22/24、Windows Node 24 和 PR 可安装包全部通过 |
| main CI | [34415764110](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34415764110)，精确发布提交全部通过 |
| 不可变 annotated tag | `v0.5.4`；tag 对象 `327ffd34eb1e054a10a535ef85659daa94ee96d2`，指向发布提交 |
| Release 工作流 | [34416010427](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34416010427)，OIDC publish 与 GitHub Release 步骤成功 |
| npm | [dsh-tender-workbench 0.5.4](https://www.npmjs.com/package/dsh-tender-workbench/v/0.5.4)，Registry version / latest 均为 `0.5.4`；beta 保留 `0.3.0-beta.1` |
| Publisher | `GitHub Actions` / `npm-oidc-no-reply@github.com`；trustedPublisher.id=`github`，配置 `oidc:20287148-0db1-42e9-969e-04b4ad02ce41` |
| Provenance | 发布日志确认签名与上传；[Sigstore 记录 2774422673](https://search.sigstore.dev/?logIndex=2774422673)，证书身份对应本仓 `release.yml@refs/tags/v0.5.4` |
| GitHub Release | [v0.5.4](https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.5.4)，非 Draft / 非 Prerelease；发布时间 `2026-09-09T23:15:46Z`（北京时间 09-10 07:15:46） |
| npm tarball | 180 文件，4,331,525 字节解包大小；SHA-1 `803eca8b8ceb580c4af28b411b2d3ed5d3214000` |

Registry integrity：`sha512-WV99U5SYhHw69z8eQEy8Hm8KM8POdbnCMT6/60P94berI+XfBwe6d6zbsBzQQ/qSg8F8Apt/h8swwI+fVWcVmg==`。

证据边界：Registry 标记存在 SLSA v1 provenance；本次公开 attestations endpoint 回读仅返回 npm publish statement，其 subject SHA-512 与 Registry integrity 一致。另回读上述透明日志条目并核对证书的 workflow/tag 身份；未声称完成独立密码学 bundle 验签或完整 SLSA payload 回读。发布状态不代签真实 DSH / QCC 验收。

传输兼容：本机 Git HTTPS 多次 HTTP/2 错误或超时，使用已认证 GitHub Git Data API 同步相同 Git 对象与 ref；逐项核对 blob/tree/commit/tag SHA，ref 更新使用非 force，合并前锁定 head。没有覆盖远端提交或移动已公开 tag。证据以独立 docs commit 回写 main，`v0.5.4` 保持指向原发布提交。

详细采用记录：[QCC-BLUE-UI-ACCEPTANCE.md](QCC-BLUE-UI-ACCEPTANCE.md)。
