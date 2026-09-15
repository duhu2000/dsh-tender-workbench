# UX49-TENDER 采用记录（DSH-UX-001 v1.5.6）

日期：2026-09-15。状态：本地实施、PR 待审；不等于合并或 npm 上线。

## 权威基线与审计

已完整阅读共享规范（UX-49、11.1、14，并核对 UX-48）、`DSH-UX-049-四智能体首页初始引导协同.md` 和总账 2026-09-15 移交单。不复制规范全文；业务文案严格采用 11.1 的招投标首版，不宣传材料上传、附件解析或自动读取本地文件。

开始时原仓 main 无改动，远端 main 与 npm latest 0.5.10 的 gitHead 均为 `4e6f4b4e09ad803590877b47f6977f1f09141aa6`，tree `e7fa1ba64b7851c31cfdf801bf36b79b14dfeac8`；开放 PR 为 0。审计已有 worktree，使用独立 `feat/ux49-initial-draft` 分支，未修改原 main、其他分支及并行插件仓。版本保持 0.5.10，变更只写 Unreleased；本轮无 merge/tag/Release/npm 权限。

## 实现与可复用契约

- `src/contracts/initial-draft.ts`：ID `dsh-initial-draft/dsh-tender-workbench/1`，版本 1，UTF-8 SHA-256 `f2bf291eec74a12873fb6178362b61ed032f50389186bc82eec9462fd0e745ed`。完全相同才作为系统模板替换；尾部空白、替换地区或追加文字均按用户草稿，走原有替换/追加/取消。
- `src/client/initial-draft.ts`：入口发放的一次性许可；先保留 Session 标记，再等待输入根挂载。同时检查业务 ID、前台 Session、draft 严格为空、draftRev=0、imageIds+引用 chips 为空、plain、非 IME。微任务写入前再读快照，无 await 间隙；用户输入/粘贴/拖入/组合事件立即取消。
- 标记保存于宿主页面 origin 的 localStorage，key 为模板 ID + Session UUID；标记只含 ID/版本/指纹/状态，不含用户文本。先 reserved 后 initialized；存储不可用、失败、超时、卸载或切走均不重试。旧会话/刷新/重挂载没有入口许可，即使清理浏览器标记也不会补回。
- `src/client/initial-draft-host.ts`：运行时探测公开 `conversation.input.shell(id)`，读取公开 `state` 与 Lexical `getRootElement/isComposing/registerRootListener`；通过公开 `editor.update` 的 `skip-dom-selection` tag 包裹 `shell.setDraft`。不调用 keyboard/private composer，不写 DOM 文本、placeholder、selection，不调用 focus。等待最多 5 秒，所有订阅与事件在完成/取消/卸载时清理。
- `src/client/index.tsx`：仅本菜单创建成功且仍在原前台上下文时接入；迟到的创建结果不得导航抢占。初始化没有 send、MCP、任务或 reveal 依赖。既有 UX-48 Host `observed` 接纳监听保持不变。
- 查询 Schema 拒绝 `【】` 和空条件数组；Host 在读取查询状态/创建 Artifact/调用 Provider 前检查最新直接用户内容，模型偷偷删除参数里的占位符也不能绕过。业务 Skill 在缺项时只追问，不读取状态或调用分析 Agent；没有全局发送拦截。
- Projection 改为首个业务动作才实例化，普通对话/澄清不生成空业务 Projection；首个真实 tool/call 绑定实际 turn。缓存版本从 3 升到 4，旧缓存由 Host 日志重放，Profile 历史、origin 和不可变 Artifact 不迁移或重写。

复用对象是上述 port、双快照/取消测试模式和能力探测，不是招投标业务代码或四仓共享运行时依赖。

## 验证层级

自动化覆盖：空/非空/空白草稿、图片及文件引用、IME、输入未就绪、晚到修订/附件/组合/Session 竞态、用户主动清空、刷新/重挂载保留标记、A/B、普通与其他产品 Session、卸载、存储失败、精确模板、零发送/零业务工具/零开台、查询防线、UX-48 既有用例。

真实宿主使用 DSH 0.1.2-rc.1、独立临时 Profile、随机端口和本地 tarball，未连接生产 Profile 或 3080。分别覆盖 Sidebar 0.18.1 present/absent：真实原生可编辑文本、一次写入、不抢焦点、用户清空+刷新、无初始 Projection/提交/工具事件、入口不开台；旧会话和真实 Host 重启不补回。

四插件脚本按实际入口定位：招投标 button/`新建招投标会话`、清洗 button/`数据清洗补全`、尽调 button/`访前尽调`、填表 link/`AI 填表`（校验 href）。填表 0.2.30 的 aria-label 新增空格，已按实际安装源码校准，不用旧标签误报业务失败。检查各产品原生草稿不含招投标模板，设置各自用户草稿后跨产品切换并等待帧回调，确认不串写；纯契约测试另控制迟到初始化队列。

真实注册 Host 工具测试使用合成 Provider：验证缺项拒绝时零 Provider、无查询 Projection；随后正常查询、规则、人工复核、真实 Excel/PDF 字节、Profile 历史只读与终态导航保持。真实收费 Provider 与真实模型的澄清行为未执行，不以 fixture 冒充真实 MCP 成功。

## 兼容边界与后续组合回归

### 2026-09-15 本地门禁与证据

- `npm run check`：48 个文件通过，311 passed / 1 skipped（既有平台条件测试），typecheck/build/docs:check/release:check/verify-pack 全绿，198 个白名单文件。Node v25.9.0；依赖自带 sourcemap 缺失警告不影响结果。
- `npm run test:ui`：Chromium 深浅色 × 1440×900 / 1024×768 / 390×700 / 900×500，共 8 场景通过。测试依赖仅在临时目录恢复，未改锁文件。
- `node scripts/native-host-smoke.mjs`：present + 最新三插件（清洗 0.9.15、尽调 0.1.35、填表 0.2.30）通过，证据目录 `/var/folders/ws/tmsn44b140lf8b89ml5qqjf00000gn/T/tender-native-cuJ8Xq`，含 `result.json`、截图和本地 tarball。包 SHA-256 `d2d43ef755e59cb864cbd46f61e2a76ca13ada6eb24b0a520cd4c939ee2478c2`。
- 同脚本 `TENDER_TEST_SIDEBAR=absent` 通过，证据目录 `/var/folders/ws/tmsn44b140lf8b89ml5qqjf00000gn/T/tender-native-wsChdA`，包 SHA-256 `8a475a0415c85257f4e7b47c61277a3826eab8de4ead50b39e4f53fea541953b`。包指纹不同来自文档更新；两次安装的业务 JS 与最终本地构建逐字一致。
- 最终 client JS SHA-256 `20911bd7ca8e83aacc874afcd056803541ab2d19eaf83b1703d4fe79dc51a7e9`；Host JS `fe521dec151a6eb8fe5453f70ddfff69f5d75210b5f7fa43900b2c77431fdade`。真实 Host 测试明确零初始化 user/message、turn/start、tool/call；缺项 Host guard 返回错误且零 Provider，随后正常业务链路与重启通过。
- 初次沙箱测试因禁止 localhost 监听失败，授权隔离网络后全绿；最新组合初次失败为填表入口标签变化，定位修正后全绿。Node 25 的 jsdom 存储替身显式模拟浏览器 Storage，真实 Chrome 存储路径另已验收。

### 未覆盖及降级约束

- 仅验证完整 DSH 0.1.2-rc.1；缺失公开 shell/编辑器能力、localStorage 不可写或 5 秒未就绪时安全跳过引导，基础输入及业务入口仍可用。不尝试旧 API/DOM 填充回退。
- 要求 pristine draftRev=0；宿主未来改变空白编辑器修订基线时会安全跳过，须重测后再适配。
- IME 用例是确定性状态/事件测试；真实操作系统中文输入法候选交互仍需人工组合回归。
- 本地业务边界可以确定性拒绝无效工具参数与源消息占位符；无真实模型验收，不能保证模型一定遵循 Skill 而完全不尝试调用工具。没有安装额外全局拦截器。
- 原生 Host 接纳后的自动 reveal 沿用 UX-48，失败提交不展开；本次没有消耗真实模型配额复测发送。须与四仓 UX-49 PR 最终候选包、实际 IME、Files/业务 Tab/浮窗和真实用户授权 Provider 做后续共同验收。
- 最终运行结果、命令、tarball 指纹与 CI 在本 PR 的验收回报登记；无 npm 发布结论。
