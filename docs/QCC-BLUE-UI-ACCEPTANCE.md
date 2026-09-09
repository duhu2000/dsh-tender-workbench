# 招投标企查查蓝 UI · v0.5.0 验收

本文保留历次验收记录。最新改动见文末「v1.5.0 参考实现校准」，已随 0.5.4 发布，其五入口/历史视图说明取代下文旧版本的四入口说明。发布证据见 [0.5.4 发布清单](RELEASE-0.5.4.md)，不代表真实 DSH / Provider 验收完成。

日期：2026-09-06。基线 main / 0.4.5；共享规范为用户指定的 DSH-UX-001 v1.1.0，参考企查查蓝 Mockup v1.1.0 和数据清洗仓库 0.8.8 验收记录。本文件记录业务适配，不复制或修改共享规范。

## 实现

- 后续交互修正（0.5.1）：点击左侧「招投标」只进入初始页，不自动打开工作台；输入框下方快捷按钮显式打开对应视图，保留会话头恢复入口。不修改宿主全局侧栏偏好或历史会话布局。
- 保留现有目标图标几何与「招投标」菜单；48px 浅蓝图标容器与「招投标智能体」标题同排；窄屏 40px/22px。隐藏当前业务的原生品牌行（包含预览标识），离开即恢复。
- 简洁说明、原生输入框外下方四个线性图标快捷导航，分别打开项目查询/规则筛选/人工复核/结果交付，不改变执行状态或调用 MCP。右侧仍是唯一权威工作台。
- 输入框左上提示词生成器，居中 Portal；固定头尾/滚动正文、键盘焦点循环/Escape/IME 保护；查询范围、关键词、时间、地区、业务目标生成可编辑描述。已有草稿提示追加/替换/取消；只替换未被修改的前次生成段。回填不发送，不包含隐藏或过期 intent 控制数据。
- 向导草稿按会话保留于 Client 内存，关闭再开保持；刷新或卸载后不保证保留。业务结果继续使用现有 Host 投影与 Artifact，不伪称新增持久化。
- 工作台保留已有真实参数、分阶段导航、规则确认、分页数据、人工复核、报告快照及完整导出逻辑。应用业务级浅深色令牌、操作蓝/状态色、浅蓝表头、可见焦点和 4/8/12/16/24/32 间距。
- 不改宿主原生模型、发送、权限、工作区控件或占位文本；不修改其它插件，不重新安装用户本机插件。

## 宿主适配边界

已只读检查依赖 @deepseek-ai/dsh-client-ui-conversation 0.1.1-rc.2 的运行代码及声明：

- hero.brand.mark 是 root/single，故不注册。会话级 Hero Bridge 仅识别 headlineText 与 fishHitbox 所在已知行，新增自有节点并可逆隐藏原行；未知结构保留原生品牌，不扫描其它插件文本，不建立全局标题改写循环。
- input.dock 在原生输入上方。菜单 Bridge 只用 data-composer-seat/card 将自有 Portal 放到输入框之后，不移动共享 slot/原生节点。缺失已知锚点时隐藏快捷菜单，右侧工作台与会话头恢复入口仍可用。
- input.overlay 为运行时已存在的 session/list，rc.2 漏掉 SlotMap 声明，本插件补上对应类型。浮层让位样式只作用于含本插件触发器的卡片，退出即自然撤销。
- OIDC 发布检查不代表宿主跨版本兼容；需用户安装后再做三个智能体的真实连续切换验收。

## 业务例外

本次是 UI 升级，不扩展数据能力。共享规范示例中的合同查询、附件下载、跨会话任务历史列表、OCR/Excel 文件向导不等同于当前招投标工具能力，未增加演示数据或假入口。历史仍从 DSH 原有会话进入；当前工作台保留四阶段，不伪造「当前/历史」双标签。向导只整理查询意图，精确字段与参数在工作台配置；本轮不声称落实共享规范所有后续业务功能。

## 验证

- npm run check 已通过：42 个测试文件，219 项通过、1 项既有跳过；typecheck、build、文档与发布一致性、178 文件打包白名单通过。
- npm run test:ui 已通过 8 组：真实 React 与实际组件 + 隔离宿主 DOM + 无头 Chromium；浅深色各覆盖 1440×900、1024×768、390×700、900×500。
- 检查同排图标、输入框下方导航、只回填/不调用、主按钮颜色、弹窗可达/焦点/Escape、侧栏宽度、普通会话品牌还原及清理；无真实网络请求。
- 运行依赖由 TENDER_UI_DEPS（react/react-dom/esbuild）、TENDER_PLAYWRIGHT、TENDER_CHROME 指定。截图与 results.json 位于忽略的 _scratch/ui-blue/，不发布到 npm。
- 实际安装/真实 QCC 查询/三个已安装插件组合的 UI 验收，仍需发布升级后复测；本轮未重启用户服务。

## 后续调整：首页快捷按钮（0.5.2，2026-09-07）

- 重新阅读共享规范和同名 Mockup：文件内容已更新至 v1.1.3；本轮仅对齐 UX-06/UX-37 的首页快捷卡片，不扩展右侧工作台改造范围。只读参考数据清洗插件现有 dcAgentCapabilities / dcAgentCapability 实现。
- 四个现有入口保留名称、图标和对应操作，改为上图标下文字：17px 线性图标、5px 图文间距、12px 标签、108px 最小宽、54px 最小高、8px 圆角及卡片间距；默认中性描边和次级文字，悬停/键盘焦点使用浅蓝底和操作蓝。
- 窄屏最小宽 92px，菜单内部单行横向滚动，不换行、不撑宽宿主页面。上下各留 5px 内边距以完整显示 2px 焦点环及 3px 外偏移；聚焦被裁切的卡片时仅滚动本菜单，不滚动宿主会话。
- 不新增“完成”或伪选中状态。初始化、悬停、聚焦均不打开工作台；点击才打开对应视图。原生输入框、品牌行、菜单名称、其它插件和已安装包均未改动。
- 隔离 React/Chromium 8 组回归通过（浅深色 × 1440×900 / 1024×768 / 390×700 / 900×500）：新增卡片尺寸/描边/排列、图标上下居中、主题颜色、hover/focus、Tab 完整可达和窄屏内部滚动断言；保留入口默认收起、显式打开、普通会话清理和提示词向导回归。
- 发布状态见 [0.5.2 发布清单](RELEASE-0.5.2.md)。未重启用户 DSH；截图保存在 _scratch/ui-blue/，属于隔离组件验证，不替代安装后的真实宿主验收。

## v1.5.0 参考实现校准（开发验收记录，2026-09-09～10）

以下保留首次本地验收时的基线与授权状态。当时未提交、未发布；后续用户另行授权发布，已完成 `release/0.5.4` → PR #2 → main CI → annotated v0.5.4 → OIDC/npm。发布提交为 `58b3873dc46d76bfb054f6508f028a20c5d5eeb2`，完整证据见 [发布清单](RELEASE-0.5.4.md)。发布前再次通过 230 项测试（1 项既有跳过）与 8 组隔离 UI 回归；真实 DSH / Provider 层级仍为未验证。

### 基线、范围与采用登记

- 规范：DSH-UX-001 v1.5.0，完整阅读第 7、13.4、14、15、15.1 节；对照同名企查查蓝 UI Mockup v1.5.0 的五入口、宿主 Tab 条及当前/历史视图。没有复制 Mockup 的示例任务、模拟业务数据或宿主外壳到产品。
- 规范 SHA-256：`49f659d780592c56f3687d61c314c0cb207d52c0a2c8b307be9654bb796076fe`；Mockup SHA-256：`44bd4a90bd34574f8f328ea3a2023d44c3c3c4002bd6a0e1b4946208421209a9`。
- 分支 `main`；基线/最终 HEAD 均为 `e83cd50f139b1dcb963465f34fcf3f1c20c68c9f`。开始时工作树干净。本轮改动未提交，未改版本 0.5.3、依赖或 lockfile，未 commit/push/tag/npm/Release/市场操作，未安装到用户 DSH。
- 编译对照 Better Sidebar 0.17.1、Cordis 4.0.1、DSH Client 公共包 0.1.1-rc.2 的本地声明/实现；测试运行 Node 25.9.0。不是当前运行中的 DSH 版本证明，也未扩宽 peer 范围。

| 规则 | 本仓采用与证据 | 验证边界 |
| --- | --- | --- |
| UX-40 | 稳定 id `dsh-tender-workbench:agent`，single:true、顺序 40、短标题和原目标线性图标；只使用 Better Sidebar 注册容器 | descriptor/定向调用契约已测；真实宿主单例实现仍需组合回归 |
| UX-41 | 五入口统一 openTab(type, SessionScope) + Session 导航；显式 reveal 仅改变承载 Tab 的 panelOpen/bottomOpen；浮窗升起由宿主 openTab 负责 | 重复导航零 intent、新 Session、MCP；宽度/停靠/其他 Tab 不变契约已测 |
| UX-42 | 内容头无容器箭头、X 或同义展开/收起/关闭按钮；Tab 卸载只解绑视图，保留导航与查询草稿；不发送取消/删除工具 | 模拟宿主收起、Tab X、Files 选择及延迟挂载竞态已测；真实宿主按钮待验 |
| UX-43 | Better Sidebar 放在 Cordis 依赖子作用域；缺失/不兼容时核心对话槽位仍注册，按钮给出安装、升级、启用 Tab、重启提示；不生成私有侧拉 | 缺失/不兼容/延迟到达/移除测试已补；仍受既有 Hero 锚点兼容边界约束 |
| UX-17/37/39 | 当前任务/任务历史一级导航；四阶段单行等宽、图标+短名，不含第二行状态；窄栏保留状态文字、会话/查询标识；宽度和几何由宿主管理 | 实际组件浅深色矩阵及 320px 容器通过；连接状态明确为未核验，不以 Projection 就绪冒充 MCP 就绪 |

### 五入口映射

| 对话框下方按钮 | 同一 Tab 内目标 | 业务副作用 |
| --- | --- | --- |
| 找机会 | opportunity | 无任务创建/工具调用 |
| 筛候选 | screening | 同上 |
| 人工定案 | decision | 同上 |
| 形成交付 | delivery | 同上 |
| 任务历史 | history 一级视图 | 只读当前 Session 的已保存查询记录 |

菜单名称仍为「招投标」、首页标题仍为「招投标智能体」、原图标几何不变。业务阶段选择不推进 Projection 状态。历史读取当前 Session 已有 Projection，不另建 Tab、不执行新查询；显示真实目标、查询记录标识、查询时间、结果记录数量及工作流状态，可返回已保存任务的当前阶段。没有跨 Session 历史 API，不把本会话记录冒充完整历史；无记录和读取失败有各自说明。

### 可复用 adapter 契约（供另外三仓对照，不是共享业务依赖）

1. **能力而非版本判断**：必须同时校验 `targetedOpen`、`stateSubscription` 和 registerTab/isTabEnabled/openTab/getSnapshot/subscribeState 五个可调用方法。当前不调用 onClose/onActivate 等生命周期 API，不额外要求 tabLifecycle；未来使用时须同步加探针和测试。
2. **明确所有权**：type 为稳定命名空间 id；single 去重交给宿主。SessionScope 始终带目标 sessionId，并在可用时带该 Session 的 cwd，不借用前台 cwd。导航控制器、查询视图内存属于业务 Client 生命周期，不保存宿主几何。
3. **显式展开握手**：openTab(type-only) 后记录 reveal 请求；subscribeState 和 Tab attach 都可尝试消费。SidebarStore.reduce 修改的是当前 Session，因此消费前和 reducer 内必须重新核对 getSnapshot().sessionId。不能只在点击时检查一次，也不能靠 DOM 点击宿主图标。
4. **用户最新意图优先**：若宿主 X 已移除该类型 Tab，清掉待展开；若 Files 已成为同窗格活动 Tab，不抢回焦点或展开。请求在 reducer 前消费，避免同步通知重入。一般状态订阅不是持续自动展开，宿主收起后不会被再次打开。
5. **几何隔离**：右/底部仅打开拥有目标 Tab 的面板；已展开返回原状态；浮窗几何不写入。不调用 setSession、closeTab、activateTab 去补偿焦点，不修改其他 Tab/splits/width/bottomHeight/停靠位置。
6. **生命周期分离**：Cordis 核心入口不依赖 Better Sidebar。依赖子作用域注册 descriptor、订阅并持有 controller；子作用域卸载即注销本 descriptor、取消订阅、清 pending/targets，清掉可调用服务引用。核心卸载还清导航、查询视图内存和提示词草稿。未连接服务的 controller 是惰性 no-op，只用于隔离渲染。
7. **恢复不是重跑**：Session 导航记忆保留最后一级视图与阶段，重复目标不反复调用选择回调。查询目标、范围、条件、查询分支、机会/筛选子视图按 Session 缓存在本 Client；生产组件以 Session 为 key，Tab X 后重开可恢复。任务事实与制品仍归 Host Projection/Artifact，内存不能代替持久化。

可以对照复制的是上述端口形状、行为断言和故障注入模式；不要让另外三仓依赖招投标的 Projection、intent、查询规则、history 数据形状或业务组件。

### 控件与私有容器审计

- 正式入口 `src/client/index.tsx` 只注册一个 Better Sidebar descriptor，不注册旧 TenderResultsEntry。
- 正式工作台内容没有宿主同义关闭/收起/展开控件；记录详情 X 的名称为「收起详情」，提示词弹窗为「关闭提示词向导」，移除筛选按钮包含筛选对象，均为局部作用域。
- 源码中仍保留旧 TenderResultsEntry/TenderResultsPanel 及旧测试。它们未接入正式入口，构建 Client 不含 results-backdrop/TenderResultsEntry，不属于 UX-43 降级路径；本轮不删除旧兼容代码。若未来重新接入，必须先迁入同一 Tab，禁止恢复其 fixed 结果抽屉。
- 唯一仍用于正式业务的 fixed 浮层是局部提示词向导，不是工作台。测试 fixture 的收起按钮和移动端外壳仅模拟宿主，不打入产品；为避免中央提示词触发器遮住模拟宿主，fixture 外壳补上自身层级，没有修改产品宿主样式。

### 测试模式、结果与证据分层

- **层 1：单元/契约**——42 个测试文件，230 项通过、1 项既有跳过。能力标记虚报（缺少 subscribeState 方法）、禁用 Tab、延迟挂载、非前台 Session、前台切换回来、Files 抢先选择、Tab X 抢先关闭、宿主再次收起、底部/浮窗几何不变、注销订阅/清理 pending、依赖延迟到达与移除、重复五入口零写操作均有断言。单例数量依赖宿主的 single 契约，不能把 mock openTab 调用证明写成真实宿主去重验收。
- **层 2：实际 React / 隔离 DOM**——五个真实流程按钮；导航、历史/当前切换、Tab 内容卸载/重挂、查询草稿恢复和新 Session 隔离；对 workflow JSON 不变、sendIntent/createIntentId 零调用做断言。缺失依赖的可行动提示及重试后清理错误已测。
- **层 2：真实 Chromium / 隔离宿主外壳**——浅/深色 × 1440×900、1024×768、390×700、900×500 共 8 组通过；另含浅深色 320px 容器断言及截图。验证五入口逐一关/开、仅一份业务组件、阶段菜单无描述、容器溢出、导航卡片键盘可达、品牌恢复、向导回填/关闭。网络全部拦截，无真实 DSH/MCP。
- **本地工程检查**——npm run check（typecheck/test/build/docs:check/release:check/verify-pack）通过；打包白名单 180 文件。最后补充生命周期测试后再次 typecheck/test 通过。release:check 仅检查本地版本文件，不代表发布授权或发布完成。git diff --check 通过。
- **层 3：真实 DSH**——未安装本次未提交构建，未重启用户 dsh web、未修改用户配置；不能宣称真实四插件组合通过。
- **层 4：真实 QCC Provider**——未调用，未发生新增查询/付费调用验证；连接权限/额度/实际计费不由隔离测试证明。

截图和 `results.json` 位于忽略目录 `_scratch/ui-blue/`，不加入市场资料或 npm。人工查看浅色 320px、深色窄屏截图，确认内容头无宿主同义控件、阶段标签无第二行状态、320px 不横向撑开。首次无授权沙箱运行 4 个本地 HTTP 用例报 listen EPERM，允许本地测试监听后通过；上游 ui-primitives 缺少 source map 的告警仍存在，不影响测试结果。

### 已知限制与后续组合回归

- 不是完整 v1.5.0 产品验收：跨会话历史索引和真实 MCP 连接状态探测未接入；界面明确限定当前会话记录并标注连接未核验。
- 草稿/导航记忆仅在当前 Client 生命周期；页面刷新/插件卸载后清除，已保存任务仍按 Host 恢复。细粒度记录选中、临时表格筛选、尚未提交的规则/复核编辑尚未统一恢复，不应宣称所有业务编辑都能跨 Tab X 保留。
- 真正不挂载折叠 Tab 内容的未来宿主实现需要新的公开 reveal 端口；当前适配依赖 0.17.1 的 Tab mount/store 契约，不支持私有 DOM 兜底。
- 四插件同装逐项复测：普通新会话、四入口轮转、每个快捷按钮连击、同 Session 的 Files/业务 Tab 切换、异步 open 后立即切 Session、侧拉收起/恢复、Tab X 后重开（任务运行中也测）、拖宽/键盘调整/复位、右/底部/浮窗/窄屏合并面板、禁用/卸载/重装 Better Sidebar、插件 HMR/卸载后监听数量归零。
- 组合回归必须记录真实 DSH 和 Better Sidebar 版本、四插件版本、任务/制品标识与工具调用计数，确认没有几何污染、焦点抢占、重复 Tab/任务/MCP。还需长中文任务名、缩放、320px 的真实宿主录像和真实 Provider 授权场景；本轮不代签这些环节。

### 改动文件

- 核心：`src/client/better-sidebar-adapter.ts`、`src/client/index.tsx`、`src/client/TenderEntry.tsx`。
- 工作台：`src/client/workbench/TenderWorkbench.tsx`、`navigation-controller.ts`、新增 `session-view-memory.ts`、`tender-workbench.module.css`。
- 回归：`tests/better-sidebar-adapter.spec.ts`、`tests/client-integration.spec.ts`、`tests/entry.spec.tsx`、`tests/workbench.spec.tsx`、`scripts/tender-ui-fixture.tsx`、`scripts/ui-blue-regression.mjs`。
- 记录：本文件与 `CHANGELOG.md` 的 Unreleased 段。无跨仓业务依赖、无版本/发布配置修改。
