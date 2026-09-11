# v1.5.2 Workspace 归组采用记录 — 0.5.7

日期：2026-09-11。base main `aee2ead740724a40c2931314b8f01233b71465a4`；独立分支 `fix/workspace-session-ownership`。初始仅授权 commit/PR；用户随后追加授权 commit、push、tag、npm 发布，按完整门禁推进 0.5.7，实际发布状态见 RELEASE-0.5.7.md。不修改生产 Profile/全局宿主或其他工作树。

## 修复与不变边界

完整核对共享 DSH-UX-001 v1.5.2 第 3、7、13.4、14、15、15.1 节。根因是 createTenderEntrySession 原先刻意 cwd-only，真实 Host 不将它登记到 Workspace.sessionIds；不能靠未分组隔离业务。

- 新 resolver 返回 WorkspaceId。当前 Session 的显式 membership 优先，其次精确匹配历史未分组 Session.cwd 与已注册 Workspace.path。没有当前目录才回退首个工作区；有未注册目录时明确失败，不创建新 Workspace 或静默转入其他组。
- 公开 `sessions.create({ workspaceId, sessionId })` 创建命名空间业务会话；不调用会复用空白的 connectWorkspace 创建业务入口。
- 继续使用现有 ordinary Session guard 排除业务命名空间，复用/创建普通 Session；守卫实现未改变，仅纠正“仅旧会话”的过时注释。
- `src/host/tool-contract.ts`、其真实 Session 契约测试和 lockfile 与 0.5.6 完全相同：保留 snapshotEvents + turn/start、直接用户请求及 pending control.nextTool 边界。
- 不迁移历史未分组数据；原 Session/Artifact 引用保持可用。新业务会话会正确归组，不承诺自动整理所有旧历史。
- 不抢占 details、不新建 overlay/fixed 工作台、不引入 alpha 依赖或跨仓业务强依赖；Sidebar 仍可选。

## 测试模式

单元覆盖当前 membership 优先、无选择回退首组、旧未分组精确路径匹配、不相关目录拒绝、缺失 create、缺少 Workspace、错误 ID；集成 fixture 现在模拟 Host 以 workspaceId 创建后写 membership 与 cwd，而非旧 cwd-only 替身。

实际回归使用 `scripts/native-host-smoke.mjs`：最终 npm pack → 实际 DSH 官方 initProfile/plugin install → 隔离 HOME/DSH_HOME 与随机端口 → Chromium。注册两个 Workspace，选中第二个再点击业务入口，断言且截图当前 Session 出现在所选组而非“未分组”。归档测试种子普通 Session，让所选组唯一可复用空白候选是业务 Session，再点击真实宿主“新会话”，验证 guard 返回普通 Session 且原业务 Session membership 不丢。该过程只使用测试目录，不操作用户实际会话。

兼容 Sidebar 额外检查入口后 right/bottom 都关闭、无业务 Tab；五流程各重复点击仍单例；Tab X 重开、Files 切换、宿主“折叠侧边栏”后流程按钮恢复均保留草稿/宽度/Tab。无侧栏入口保留提示词和原生草稿，失败导航不创建任务/改变事实。合成业务沿用 0.5.6 实际 Host 管道与 HTTP 下载。

## 分层结果

- L1：npm run check 全通过，43 文件 / 245 passed + 1 macOS 上 Windows-only skipped，类型、构建、文档、发布检查和 180 文件 pack 门禁通过。8 组浅深色/四尺寸 React-Chromium UI 全过。
- L2：完整 DSH 0.1.2-rc.1，Node v25.9.0，macOS Chromium；使用最终本地原始包，非生产 Profile。截图已人工查看，所选 synthetic-workspace 下有当前业务新会话、默认无工作台。
- L3：真实注册 Host 工具、Agent、Session、投影、Excel/PDF 与下载；合成 QCC/直接用户消息，无模型调用。查询一次→规则预览/确认→人工复核→部分交付→200 下载及 PK/%PDF 签名；重复导航不改变完整业务投影。
- L4 未测：真实模型/计费 MCP、四产品最终包同装、Windows 实际 DSH UI、后台 Session/浮窗/底部综合几何、执行中刷新重启/卸载。上述不是本轮成功声明。

| Sidebar | 实际结果 | 合成证据目录 / 端口 |
| --- | --- | --- |
| absent | L2/L3 PASS，归组、唯一业务空白防复用、草稿/提示词/业务下载通过 | tender-native-9uhBuB / 49736 |
| 0.18.1 | L2/L3 PASS，归组、防复用、默认关闭、单例、Tab X/Files/宿主折叠恢复通过 | tender-native-wAn9f4 / 49623 |
| 0.17.1 | EXPECTED_STARTUP_FAILURE，预检阻断并实测 settingsNamespace 缺失 | tender-native-9ijuGt / 49959 |

包 SHA-256：`fd83145a11c1d94ea786fba43f44a1f14a708d8723aa343f9bd66139acbe453c`。目录根为系统临时目录，result.json 保存完整 home/port/tarball 与脱敏结果，workspace-entry.png 保存归组截图。当前记录不进入 npm 白名单，补证据不改变测试包。

## 验证过程限制

最初未提权 check 的 4 个 Artifact HTTP 测试因 loopback listen EPERM 失败，另一个旧集成断言仍期待 cwd-only；恢复隔离监听权限并更新符合真实 Host 的 fixture 后完整通过。旧 UI 临时依赖已被清理，在新的测试临时目录安装固定 React18.3.1/esbuild0.25.12 后 8 组通过；不修改产品锁文件。上游 primitives source-map 缺失警告仍存在。

沿用 0.5.6 已登记的 CSS 绝对编译路径相关哈希限制，不承诺本地与 GitHub CI 包字节一致。未来发布必须重新核验当时的 main、版本占用、完整门禁和实际产物；本 PR 通过不等于已经发布。
