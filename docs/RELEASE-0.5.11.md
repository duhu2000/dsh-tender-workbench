# 招投标 0.5.11 发布记录

Version: **0.5.11**
Status: **ready for release**

本轮在用户明确授权 commit、push、tag、npm 后发布 UX-49（PR #8）。原实现提交 e4b3e4bf21f7f4f423128333a709460f53256f3f 已通过 PR CI；本次同步版本及资料，不修改业务实现。

## 更新

- 仅本菜单新建的业务 Session 预填一次原生可编辑引导，采用第 11.1 节招投标文案。
- 双快照检查就绪状态、空草稿/附件、IME 与 Session；异步迟到、用户清空、刷新、重挂载及旧会话不覆盖或补回，不抢焦点。
- 稳定模板 ID、版本与精确指纹；修改后的内容按用户草稿处理。占位符或缺项先澄清，Host 查询防线拒绝无效条件，不调用 Provider。
- 不自动发送、创建任务或展开工作台，保留 UX-48 接纳后展开、只读 Profile 历史、origin、真实 progress、人工定案和不可变 Excel/PDF 快照。

## 验证与边界

实施门禁：311 passed / 1 平台条件 skipped，8 个 UI 场景通过。真实 DSH 0.1.2-rc.1 独立 Profile 下 Sidebar 0.18.1 present/absent、清空刷新、Host 重启及四插件隔离均通过；组合为清洗 0.9.15、尽调 0.1.35、填表 0.2.30。真实 Host 工具使用合成 Provider，验证了人工复核和 Excel/PDF 文件链路，不代表真实收费 MCP 或模型已验证。操作系统中文输入法候选交互仍需人工验收。

公开 input shell/编辑器能力、可写浏览器存储缺失或 5 秒未就绪时安全跳过引导，不做 DOM 回退。Projection 缓存版本为 4，宿主从原日志重放；不迁移或重写 Profile 历史及交付文件。完整采用记录见仓库 docs/UX49-INITIAL-DRAFT-ADOPTION.md。

## 发布与升级

使用 v0.5.11 tag 触发 release.yml，Linux Node 24 执行完整门禁后通过 npm Trusted Publishing/OIDC 发布，附带 provenance；随后由既有工作流生成 GitHub Release。发布成功以 Actions 和 npm registry 的实际结果为准。

升级前备份完整 Profile；执行 `dsh plugin --profile web add dsh-tender-workbench@0.5.11` 后完整重启对应 dsh web。既有会话不会补回初始模板，需从「招投标」菜单新建业务 Session 验证。回滚使用完整已验证 Profile 备份。
