# 搜索发现与安装验收

拟议市场中文描述：招投标智能体：支持招投标搜索、招标查询、投标查询、标讯查询、拟建项目与项目筛选，辅助商机发现、人工复核及 Excel/PDF 导出，使用客户自备授权的企查查 MCP。

拟议英文描述：Tender search and bid intelligence in DeepSeek Harness with proposed project search, rule screening, human review and Excel/PDF exports using user-authorized Qichacha MCP.

npm keywords 已在包清单内更新。GitHub description 建议使用上述英文描述；topics 在保留现有项的基础上加入：dsh-plugin, tender-search, bid-intelligence, proposed-projects, procurement。

市场只检索登记字段，不读取 npm keywords、README 或 GitHub topics。默认下载排序保持原规则；不承诺文案直接提升默认排名。

固定查询：招投标 / 招标查询 / 投标查询 / 标讯查询 / 拟建项目 / 商机发现 / 项目筛选 / tender search / bid intelligence / proposed project / 企查查MCP / 企查查 MCP。

验收：使用实时完整目录和原版搜索函数对比登记描述更新前后；记录语言、命中位置、结果数与版本。独立目录缺失条目必须标为未上线，不能把模拟添加的结果当作上线结果。

发布清单：完成仓库 check；审核 README 与包清单差异；如需让 npm 展示更新内容，另行授权一个新的补丁版本并按项目发布流程执行。当前改动未更改版本，不得覆盖已发布版本或移动 tag。仅登记 YAML 更新无需发布 npm。

## 安装与三分钟上手

招投标智能体：支持招投标搜索、招标查询、投标查询、标讯查询、拟建项目与项目筛选，辅助商机发现、人工复核及 Excel/PDF 导出，使用客户自备授权的企查查 MCP。

```sh
dsh plugin --profile web add dsh-tender-workbench@0.5.3
```

请先满足下文的 DSH、连接器及侧边栏依赖要求；安装后完整停止并重启对应 Profile。

进入“招投标”，设置地区、关键词和时间范围，使用已授权的 qcc-tender 查询。检查规则影响预览并确认筛选条件，人工复核记录后选择导出 Excel 或 PDF。三分钟用于熟悉操作，不承诺查询或报告一定在三分钟完成。

**流程样例（示意，非真实调用结果）：** 地区/日期/关键词 → 标讯与拟建项目 → 规则影响预览 → 人工复核 → Excel/PDF（未完成复核会标注部分交付）。

**能力边界：** 投标查询指已授权数据源内的公开标讯查询，不代办投标。无 Web 搜索兜底、订阅或自动 Bid/No-Bid 决策；不提供在线 PDF 预览。

**升级与回滚：** 升级前停止 Profile 并备份任务目录，记录当前精确版本；使用上面的固定版本命令升级，再完整重启。回滚时将版本号替换为升级前记录的版本，并使用升级前任务目录副本；不以旧版直接读取已迁移任务目录。

相关智能体：[数据清洗补全](https://github.com/duhu2000/dsh-data-cleaning-agent) · [AI填表](https://github.com/duhu2000/dsh-form-fill-agent) · [访前尽调](https://github.com/duhu2000/dsh-pre-duediligence) · [招投标](https://github.com/duhu2000/dsh-tender-workbench)
