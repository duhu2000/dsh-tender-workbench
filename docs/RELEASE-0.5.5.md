# dsh-tender-workbench 0.5.5

Version: **0.5.5**
Status: **release candidate**

尚未合并、打 tag 或 npm 发布。对应招投标 P0 新宿主兼容加固任务。

## 修复范围

迁移完整 DSH 0.1.2-rc.1 公共客户端类型和服务；移除旧 runtime 值引用、注入和测试替身；使用 uiConversation.events 注册并卸载搜索事件定义；仅接收 append 的 tool/result。修正空白首页状态、uiWorkspace 导航、宿主 JsonValue 与 SessionHeader 契约；保留 Session 单例工作台与会话恢复。补充审计发现开始任务前的 connection.api.skills.list 同样过时，已迁移 remote.skills.list 及新的返回格式，避免页面能开而业务预检失败。

## 验证与兼容性

目标组合：完整 DSH 0.1.2-rc.1 + Better Sidebar 0.18.1。旧 0.1.1-rc.2 / Sidebar 0.17.1 不再声明支持；未来组合未验证。context 不是本产品必装依赖，若已装 0.36.0 应先处理其旧 settingsNamespace 不兼容；共存基准为 0.48.0。

反向不匹配证据：AI 填表会话报告的精确组合 DSH 0.1.2-rc.1 + Sidebar 0.17.1 在 /tmp/ff-compat-oldhost.log 中失败。本仓已只读核对日志里的 better-sidebar 导入失败及 settingsNamespace 缺失；没有重复运行该组合，版本归属引用该会话明确回报（日志文件名 oldhost 不代表实际旧宿主）。预检对该精确组合阻断，其它未实测 Sidebar 版本只警告未验证；不泛化为整个版本区间的实测结论。

本轮只在隔离 HOME / DSH_HOME 测试，使用合成工作区，不读写正式安装、不使用生产凭证或计费 MCP。Node v25.9.0；完整 check 通过；43 文件、240 测试通过、1 项既有 Windows-only 跳过；8 组 Chromium 浅深色/尺寸回归通过；最终产物白名单 180 文件，新增旧模块、旧服务和旧 Skill API 禁入检查。

真实 DSH 用独立诊断插件读取公开模块表和服务，未改写 npm tarball 的 client.js。无 context 与 context 0.48.0 两种配置均已启动并执行导航；补充 Skill RPC 修复后的最终候选在 context 0.48.0 组合通过：

- 客户端模块实际加载、uiConversation 仅注册一份招投标定义；未加载旧 runtime。
- 官方 ConversationNodeAssembler 处理合成 tool/result，重放和增量状态一致。该项没有向真实 Session 写入模拟结果，不冒充真实 QCC 数据。
- 真实只读 remote.skills.list 返回 query / screening / analysis / review / report 五个行为 Skill。
- 点击菜单进入原生独立会话；五入口各重复点击，实际宿主中只有一个业务 Tab，Session 数量不增加；各阶段/历史视图定位正确。
- 原生 Tab X 关闭重开、Files/业务 Tab 切换后查询草稿保持；新会话不带招投标首页，返回业务会话恢复；pageerror 为零。

该轮记录：临时目录 tender-native-uPNfAG，端口 62223；result.json 与测试 tarball 位于执行者系统临时目录。测试 tarball SHA-256：`86bec7ecd6324e4ffa5771cfd67c7a18b927e650edffbfc48811b6e03dc4362e`。后续仅文档证据补记会改变包摘要；应以脚本重新 pack 的实际输出作为交付物，不复用 npm 版本。

### 验证边界

业务查询/规则/复核/Excel/PDF 的既有 fixture 回归通过，但未在真实宿主上提交模型请求或走付费 MCP 全链路。无真实授权/额度验证、无四产品共存签收；宿主收起/后台 Session 几何、浮窗/底部布局、HMR 卸载仍主要为隔离契约覆盖，待总账组合回归。旧基线没有被声明继续支持；其它未经实测版本标记未验证，不依据最低版本推断全区间通过。上游 primitives 缺少 source map 的非阻断告警保留。

### 复现

先运行 npm run check，再设置 TENDER_DSH_BIN（完整 DSH 0.1.2-rc.1 的 lib/bin.js）、TENDER_PLAYWRIGHT（index.mjs）、TENDER_CHROME，执行 node scripts/native-host-smoke.mjs。设置 TENDER_TEST_CONTEXT=1 加入 context 0.48.0。脚本新建临时 HOME/DSH_HOME、独立端口，用 npm pack 原始产物；退出只关闭自己启动的浏览器和进程，不操作正式 3080 或 ~/.dsh。截图/诊断插件/临时会话不会打入 npm。

## 发布与回滚

需本次候选的新增发布授权以及 PR/main CI/不可变新 tag/OIDC 门禁。不得重新发布 0.5.4 或移动已有 tag。新宿主不能单独回滚为原始 0.5.4（有已知启动故障）；若需回滚，应还原备份的完整宿主/插件组合和 Profile，禁止覆盖仍可用的临时补丁安装。
