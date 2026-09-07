# 招投标智能体 · 市场投稿登记

核验日期：2026-09-07。状态：**PR OPEN，非 Draft，检查通过，等待维护者审核；尚未上架。**

- 投稿：[awesome-dsh-plugin/awesome-dsh-plugin #4585](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4585)。
- fork 分支：`duhu2000:submit/dsh-tender-workbench-20260907`；提交 `718e60d95027e2f491c222af5cbfd053d0acc709`。
- 上游基线：`d348d4fd7503d9afd8f24f4b3e3956e38797b1ca`；差异仅新增 `data/plugins/duhu2000__dsh-tender-workbench.yml`，6 行新增、0 行删除。
- 招投标市场资料提交：`2cebc9dd07caa2a7abc5d22c052ea5bea517280e`。Git 网络连接异常时使用 GitHub Git Data API 上传，逐项核对 blob/tree/commit SHA 一致后非强制更新 main。

## 公开元数据与准入

- 上游：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，遵循 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。一插件一个 YAML，不修改上游 README 或其它条目。
- 仓库：[duhu2000/dsh-tender-workbench](https://github.com/duhu2000/dsh-tender-workbench)，公开、MIT、未归档，2026-09-04 创建；投稿前 39 次提交，超过 1 天。当前上游没有提交数量门槛。
- npm：[dsh-tender-workbench](https://www.npmjs.com/package/dsh-tender-workbench)，latest=0.5.2；[Release v0.5.2](https://github.com/duhu2000/dsh-tender-workbench/releases/tag/v0.5.2) 为正式版本。
- 发布提交 `b946e97063ef3de44e6897ce429fc4c4f1d4ca52` 与 npm gitHead、tag 一致；main 后续仅增加文档/市场资料，版本与业务代码保持不变。
- `dsh-plugin` topic 已设置；package.json 的 dsh.bundle.patch 指向存在的 cordis.patch.yml，npm 内含预构建 Host/Client。官方 DSH 包以 peerDependencies 声明。
- 投稿文件：[YAML](../marketing/duhu2000__dsh-tender-workbench.yml)，分类 workflow，中英文简介限定于实际能力；不添加无效 npm 字段。npm repository 已指回本仓，关联由市场采集。

## 兼容性、授权与费用

Node.js `^22.19.0 || >=24.0.0`；DSH 公共包最低 0.1.1-rc.2，peer 显式支持 0.1.2 预发布分支，但不代表所有未来构建已实测。需要同一 Profile 的 Session Projection、JSONL Session Persistence、Tools、Skill、Sessions、WebServer。

Better Sidebar 最低 0.17.1，必须提供 targetedOpen/stateSubscription；MCP Connector 最低 0.2.31。浏览器 Web UI 是本插件支持的平台；不能仅凭 CLI 安装成功宣称运行时服务齐备。缺少服务、JSONL 持久化或精确工具时明确失败，无 Workspace/Web 搜索兜底。

客户须自备并授权 qcc-tender MCP，提供 `mcp__qcc-tender__search_tenders`、`mcp__qcc-tender__search_proposed_projects`。权限、额度和费用归客户自己的 QCC 服务账户/合同；不提供共享密钥、免费数据额度或代结算。模型/Agent 使用客户宿主配置，相关费用亦不包含在开源插件中。

## 安装与卸载证据（隔离环境，非生产验收）

2026-09-07 使用 DSH CLI 0.1.1-rc.2、pnpm 11.1.1，在新建临时 DSH_HOME、独立 store 中执行，未复制用户配置、未启动 Web、模型或 MCP。

```sh
# DSH_HOME 与 store 均指向专用临时目录；不是用户生产目录。
dsh plugin --profile web add dsh-tender-workbench@0.5.2 --ignore-scripts --store-dir <isolated-store>
dsh plugin --profile web remove dsh-tender-workbench --store-dir <isolated-store>
```

安装 exit 0：回读 version=0.5.2，dsh.profile.bundles 包含 dsh-tender-workbench，cordis.patch.yml、lib/index.js、lib/client.js 均存在。卸载 exit 0：dependency/bundle 清除，包目录不存在。首次卸载误传不支持的 --offline 被 CLI 拒绝，去掉该选项后成功。

安装使用 --ignore-scripts，并报告 peer dependencies 警告。因此以上只证明 npm 包管理、产物存在与 bundle 注册/清除，不代表完整宿主启动、依赖齐备、真实查询或市场一键安装通过。正式依赖安装与重启步骤见 README。

## 截图与回归证据

[screenshots.json](../screenshots.json) 声明两张仓库内相对路径截图。来源为 0.5.2 实际组件隔离 React/Chromium 测试，画面明确标注“不连接 DSH / MCP”；已人工检查无客户信息、凭据、真实业务响应或本机配置。不是生产 DSH 截图，也不是 QCC 验收证据。

既有发布验证：219 项测试通过、1 项既有跳过；8 组浅深色/尺寸浏览器回归通过；[跨平台 CI](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34071262963) 和 [OIDC Release](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34071395235) 通过。

## 状态判定与下一步

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| YAML schema、本地截图相对路径与 PNG 文件 | 通过 | 上游 validateEntries：1 条、0 错误；2 个截图文件存在 |
| PR check / check | SUCCESS | [run 34130997876](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/actions/runs/34130997876)，含 README 生成、awesome-lint、站点构建 |
| Submission gate | SUCCESS | [check 101772082469](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/runs/101772082469)，head SHA 与投稿提交一致；1 条准入通过，无未核实项 |
| 招投标资料提交 CI | SUCCESS | [run 34130950224](https://github.com/duhu2000/dsh-tender-workbench/actions/runs/34130950224)，Linux Node 22/24、Windows Node 24 通过；PR 包任务按 main 事件跳过 |

当前阻塞仅为维护者审核/合并；尚未执行合并后目录、在线检索和市场一键安装验收。本轮未请求维护者以外的人合并，也未自动触碰用户生产 DSH。

下一步：维护者合并后核对目录生成与在线可检索，再在获授权的隔离环境验证市场一键安装/卸载及必要依赖。只有这些环节都完成，才标记上架完成。不得将 OPEN/CI 通过描述为已上架。

main 的包版本、业务源码与 v0.5.2 保持一致；main 额外包含市场文档/截图提交，因此不与发布 tag 使用同一提交哈希。npm latest=0.5.2、gitHead=b946e97063ef3de44e6897ce429fc4c4f1d4ca52，公开 tag/npm 未被覆盖或移动。
