# dsh-tender-workbench 0.5.6

Version: **0.5.6**
Status: **ready for release**

用户已追加授权本版 commit、push、tag 与 npm 发布。经本地与远端门禁后发布，不复用版本或移动旧 Tag。

## 范围

Better Sidebar 统一为 optional peer；基础安装不默认安装侧栏，运行时仍通过可卸载的依赖子 Context 接入，缺少能力不阻断对话功能。不新增替代抽屉、不重写工作台容器。

修复实际 DSH 0.1.2-rc.1 Host 工具路径：改用 Session.snapshotEvents() 读取事件，从 turn/start 获取当前轮次，不再依赖已移除的 Session.events 或 UserMessage.turn。此前页面/Skill 列表 smoke 未覆盖这一业务缺陷；本版补实际 Session 契约测试和隔离 Host 查询→规则预览/确认→人工复核→Excel/PDF 流程。

基础预检接受没有侧栏的 DSH 0.1.2-rc.1；显式 --workbench / Windows -Workbench 要求侧栏已安装启用。已有 DSH 0.1.2-rc.1 + Sidebar 0.17.1 的 settingsNamespace 故障仍阻断，optional 不豁免宿主硬不兼容。未测试版本提示未验证，context 非必装。

## 业务边界与验收

无侧栏仍有原生独立会话、提示词生成、对话草稿、行为 Skill 和 Host 工具。对话驱动的查询、规则预览/确认、人工复核、报告生成与 Artifact 下载使用相同服务；原生模型是否正确选择工具和真实 QCC 授权/额度属于另层验收。可视化条件面板、表格筛选/详情、批量复核控件、历史视图及下载按钮仍需工作台；流程按钮在无侧栏时仅给出提示，不创建任务或自动执行工具。

脚本 scripts/native-host-smoke.mjs 支持 TENDER_TEST_SIDEBAR=absent / compatible / incompatible。测试使用原始 npm pack、隔离 HOME/DSH_HOME 与随机非生产端口，调用实际 DSH 的 initProfile 和 dsh plugin install。官方 Profile 模板使用 hoisted / autoInstallPeers:false，由完整宿主提供核心 peers；脚本不自创或放宽依赖解析参数。坏组合验证升级预检阻断，并在专用隔离 Profile 复现已安装旧侧栏的实际启动故障。空 npm 项目不是完整 DSH Profile，其自动补齐核心 peers 存在连接器旧范围引发的 ERESOLVE，不宣称该路径已通过。

scripts/native-business-fixture.mjs 仅为独立诊断插件：通过实际注册工具、原生 Agent/Session、投影及本地 Artifact 执行流程，QCC 返回和直接用户消息是合成 fixture，没有真实模型或计费 MCP。该诊断代码、临时 Profile 和输出不打入 npm。测试结果、证据与仍待组合回归项登记于本仓 docs/OPTIONAL-SIDEBAR-ADOPTION.md。
