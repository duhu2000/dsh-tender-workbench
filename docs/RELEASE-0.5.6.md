# dsh-tender-workbench 0.5.6

Version: **0.5.6**
Status: **published**

用户已追加授权本版 commit、push、tag 与 npm 发布。经本地与远端门禁后发布，不复用版本或移动旧 Tag。

## 范围

Better Sidebar 统一为 optional peer；基础安装不默认安装侧栏，运行时仍通过可卸载的依赖子 Context 接入，缺少能力不阻断对话功能。不新增替代抽屉、不重写工作台容器。

修复实际 DSH 0.1.2-rc.1 Host 工具路径：改用 Session.snapshotEvents() 读取事件，从 turn/start 获取当前轮次，不再依赖已移除的 Session.events 或 UserMessage.turn。此前页面/Skill 列表 smoke 未覆盖这一业务缺陷；本版补实际 Session 契约测试和隔离 Host 查询→规则预览/确认→人工复核→Excel/PDF 流程。

基础预检接受没有侧栏的 DSH 0.1.2-rc.1；显式 --workbench / Windows -Workbench 要求侧栏已安装启用。已有 DSH 0.1.2-rc.1 + Sidebar 0.17.1 的 settingsNamespace 故障仍阻断，optional 不豁免宿主硬不兼容。未测试版本提示未验证，context 非必装。

## 业务边界与验收

无侧栏仍有原生独立会话、提示词生成、对话草稿、行为 Skill 和 Host 工具。对话驱动的查询、规则预览/确认、人工复核、报告生成与 Artifact 下载使用相同服务；原生模型是否正确选择工具和真实 QCC 授权/额度属于另层验收。可视化条件面板、表格筛选/详情、批量复核控件、历史视图及下载按钮仍需工作台；流程按钮在无侧栏时仅给出提示，不创建任务或自动执行工具。

脚本 scripts/native-host-smoke.mjs 支持 TENDER_TEST_SIDEBAR=absent / compatible / incompatible。测试使用原始 npm pack、隔离 HOME/DSH_HOME 与随机非生产端口，调用实际 DSH 的 initProfile 和 dsh plugin install。官方 Profile 模板使用 hoisted / autoInstallPeers:false，由完整宿主提供核心 peers；脚本不自创或放宽依赖解析参数。坏组合验证升级预检阻断，并在专用隔离 Profile 复现已安装旧侧栏的实际启动故障。空 npm 项目不是完整 DSH Profile，其自动补齐核心 peers 存在连接器旧范围引发的 ERESOLVE，不宣称该路径已通过。

scripts/native-business-fixture.mjs 仅为独立诊断插件：通过实际注册工具、原生 Agent/Session、投影及本地 Artifact 执行流程，QCC 返回和直接用户消息是合成 fixture，没有真实模型或计费 MCP。该诊断代码、临时 Profile 和输出不打入 npm。测试结果、证据与仍待组合回归项登记于本仓 docs/OPTIONAL-SIDEBAR-ADOPTION.md。

## 发布证据（2026-09-10）

- 实现提交：`97e8fc9c006d94ccbdb4c60113d2033526f814ee`；[PR #4](https://github.com/duhu2000/dsh-tender-workbench/pull/4) 已合并。
- 发布提交 / npm gitHead：`4ccf9011539b4c25a9f1ed445654db246fd9afe7`，与已审核分支 tree 相同。
- [PR CI](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34438355200)：Linux Node22/24、Windows Node24、PR 安装包全部成功。
- [main CI](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34438600945)：精确发布提交上的三组门禁全部成功；PR 包作业按设计仅在 PR 触发。
- [Release 工作流](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34438812573)：安装、tag 校验、全量 check、OIDC npm publish 和 GitHub Release 全部成功。
- annotated `v0.5.6`：tag object `a3d618703ccc5c209a7bd3e10a623c26dd1edc27`，最终指向上述发布提交；未移动旧 tag。
- npm 指定版本存在，`latest=0.5.6`；发布者 `GitHub Actions / npm-oidc-no-reply@github.com`，trustedPublisher `github`，配置 ID `oidc:20287148-0db1-42e9-969e-04b4ad02ce41`。
- [GitHub Release](https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.5.6)：非 draft、非 prerelease，发布时间 `2026-09-10T04:53:17Z`。
- [Registry attestation](https://registry.npmjs.org/-/npm/v1/attestations/dsh-tender-workbench@0.5.6)：SLSA provenance v1 的仓库、`.github/workflows/release.yml`、`refs/tags/v0.5.6`、commit、invocation 与实际发布工作流一致；subject SHA-512 同时匹配下载 tarball 和 Registry integrity。这里是内容与身份交叉核验，不宣称另行完成 Sigstore 证书链独立验证。
- Registry integrity：`sha512-XytTYBCkSSB+Qxh2ewXq21No7aeBCXYchJ6zUvxFRFG5kOYa4KeKiwPrTs+cosncbH9RTZQuUmniD1YXQpFDjw==`。
- 线上 tarball SHA-256：`17ef818b9ab10df13ebc43c90cd62f182498cabc0643da3737860a50159fc1b3`。

本地 `npm run check`：43 文件 / 242 passed + 1 Windows-only skipped；UI 8/8。最终本地原始 tarball 的无侧栏/0.18.1 实际 DSH L2/L3 通过；0.17.1 预检与隔离启动正确失败，详见采用记录和脱敏 RESULTS.json。三组不含 Context，不代表四产品共装或真实模型/MCP 验收。

### 构建可重复性说明

线上包与本地 tarball **不是相同字节摘要**。`tsdown.config.ts` 将绝对 CSS 文件名传给 Lightning CSS，产生路径相关的类名，并保留源码区域路径注释。本轮逐字节核对线上 Host 与本地 Host 相同；使用同版 Lightning CSS 分别按本地路径和 GitHub runner 路径重算类名，替换这些确定差异后，Client 全文完全相同，无其他运行代码差异。该构建可重复性限制已登记，不能把“语义/代码核对通过”写成 Client 原始字节一致。未来可单独规范化 CSS 编译文件名，但不在已发布版本上热改或重发。

文档状态与证据以发布后的独立 docs commit 回写 main；不可变 npm 包内清单保留发布时的 ready-for-release 状态。未修改正式 DSH Profile 或全局宿主，也未操作插件市场。
