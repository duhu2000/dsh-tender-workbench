# TW-HISTORY-PROGRESS · 0.5.8 采用记录

## 权威资料与边界

采用 DSH-UX-001《DSH智能体开发交互规范方案》v1.5.3（2026-09-11），沿用 v1.5.0 Mockup 的 Session 单例 Tab/宿主几何所有权。基线 main `70f7bc4c171bf99ea03f52827a6469af6757e52c`；分支 `feat/history-progress-058`。仅本仓实施，不抽取跨仓业务依赖，不改生产 Profile 或另外三个仓库。

## 可复用契约

- **三个范围分离**：当前业务 projection 属于 Session；持久历史摘要属于 Profile；Workspace/Session 是不可变来源标识。历史按钮仅导航同一业务 Tab 的 history 视图。摘要不能导入、复核、查询、直接下载或重绑旧 projection。
- **Profile 锚点**：DSH 0.1.2-rc.1 官方 Loader 的 `ctx.baseUrl` 由 Profile root 配置提供；保存到该目录 `.dsh-tender-workbench/history-v1.json`。不使用全局 SessionPersistence.list/storage 扫描，不回退 cwd/HOME。缺少能力或损坏索引显示 503，而非空列表。
- **索引写入**：初始实时 Session snapshot、projection onChanged 和 session/created；严格元数据白名单、顺序队列、临时文件 + 原子 rename，目录 0700/文件 0600。只存标题、时间、计数、来源与交付格式，不存原始记录、projection、制品 token 或授权信息。以 Session + query artifact ID 区分任务；失败查询以 operation ID 单独保留。完成条目不回退，来源工作区名称/ID 不随之后改名或归组修改。
- **读取/导航**：loopback + 唯一 Session header + same-origin 验证，当前 Profile Workspace 已登记但尚未 hydration 的 Session 也可读摘要；制品接口授权完全不变。20 条分页；前端 AbortController 丢弃旧 Session/卸载后的响应。用户明确打开来源后，refresh 前后检查当前 Session/插件 active，再 sessions.open；不新建任务。
- **执行事实**：`dsh-tender/progress` 为 Session 持久事件，匹配 active operation ID 后才折叠。记录 currentAction、实际返回来源数、成功记录数、失败/无权限/零/未知来源数、需复核数、recentItem 与真实时间；没有估计百分比。工具结果/匹配 turn/end 锁定终态，迟到事件不使其回退。执行元数据不提升业务 revision；projection cache stateVersion 升为 3，wire schemaVersion 仍为 2。
- **Provider 结果**：data / zero / not-needed / no-permission / failed / unknown。只有显式空数组才是 zero；缺字段/null 是 unknown。支持有限的 Result/result/data/structuredContent 包装和数字字符串总数；明确 denial/failure 不被备用文本中的成功列表掩盖。未证实的 Provider 包装不猜测为成功。
- **容器与授权不变**：Better Sidebar adapter、Session scope、targetedOpen/stateSubscription、宿主收起/Tab X/Files 切换仍是唯一容器协议。业务内容不新增同义关闭按钮。0.5.6 `src/host/tool-contract.ts` 授权校验文件未改，人工确认、不可变报告 snapshot、Excel/PDF 为主交付物均保留。

## 验证方式

单元/契约：索引跨 A/B、跨 Profile、重启、原子读写、来源不可变、完成锁定、损坏不覆盖、启动快照、注销清理、请求边界；UI 历史迟到响应/卸载、来源按钮只读、未知与零区分；进度初始计数、耗时、终态停表、独立语义；Provider 包装、数字字符串与失败不掩盖。保留 IME 测试。`npm run check` 包含 typecheck、全部 tests、build、双语版本检查、发布元数据与 tarball 白名单。

真实宿主：`scripts/native-host-smoke.mjs` 在随机非 3080 端口和全新临时 DSH_HOME/Profile 中，使用未改写 npm tarball、官方 `dsh plugin install`、真实 Agent/Session/projection/tools/制品服务；独立诊断插件只提供合成用户与 QCC 数据，无模型或付费 Provider 调用。覆盖 Workspace 归组、普通新会话、五入口幂等、Tab X、Files 切换、宿主收起与草稿恢复、A/B 不抢几何、只读历史、重启持久化及 Excel/PDF 下载。

## 验证结果与限制

2026-09-13 本地验收：45 个测试文件通过，267 项通过，1 项 Windows 专属测试在 macOS 跳过；typecheck/build/docs:check/release:check/verify-pack 均通过。Chromium 深浅色 × 1440×900 / 1024×768 / 390×700 / 900×500 共 8 组通过，含 IME 单元契约。

DSH 0.1.2-rc.1 原生隔离回归：Better Sidebar 0.18.1 与 absent 均通过真实工具管线、独立 Session/Workspace、五入口、只读 Profile 历史、真实 progress Session events、重启后从 B 读 A 历史、Excel/PDF 下载（非模型/付费 Provider）。0.17.1 组合在预检和真实启动中均按预期拒绝 `settingsNamespace` 旧接口错误。

四产品组合实装清洗 0.9.7 / 访前 0.1.22 / 填表 0.2.27 / 招投标候选 0.5.8；招投标业务和清洗、访前入口切换通过，但 AI填表入口未显示，组合 **未通过**。已回报总账，未修改其他仓或将其当作本仓业务通过证据。后续组合回归须使用填表兼容版本，重跑四入口、各自首页/任务历史、A/B、Tab X/宿主收起、热卸载重装及真实 Provider 权限分支。

发布流程结果在 npm OIDC 后独立登记，不提前声称已发布。已知边界：

- 索引是一份 Profile 本地派生文件，假设同一 Profile 单进程写入；不支持多个 DSH 进程同时修改同一文件。
- 升级前未打开的会话不全局回填；重新打开只索引当前 task，而不是重建该 Session 所有旧 task。原消息和历史制品不丢弃、不迁移。
- 打开来源会话显示其当前状态，不自动回滚到摘要对应的旧 task；旧报告从原消息访问。只读历史不可绕过制品授权。
- elapsed 是真实起止时间差（包含进程中断间隔），不是 CPU 活动时长或剩余耗时预测。新明确操作有独立 operation；完成的历史 task 不因它而变成处理中。
- 实际模型编排、付费 QCC Provider、用户生产数据未验证；热 HMR 装卸、其他插件全部业务流程也没有用单仓 CI 代签。四插件入口检查单独登记精确版本/结果。
