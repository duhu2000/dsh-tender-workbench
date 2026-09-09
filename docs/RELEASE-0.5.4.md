# dsh-tender-workbench 0.5.4

Version: **0.5.4**
Status: **release candidate**

## 范围与授权

用户已明确授权 commit、push、tag 和 npm 发布。目标为公开 npm 的 latest，由 release.yml 的 GitHub Actions OIDC 发布，并生成 provenance。

本次对齐共享交互规范 v1.5.0：Session 单例 Tab、五入口 open/focus/定位、能力探针、显式 reveal、跨 Session/Files/Tab X 竞态保护、订阅和卸载清理、缺少依赖的可行动提示。当前/历史导航、查询草稿及主要子视图在 Client 生命周期内恢复；阶段导航去除第二行状态，窄栏保留上下文与状态文字。

保留原目标图标与「招投标」菜单。不改变 Host 业务数据格式、依赖、权限、计费或其他仓库，不发布市场资料。

## 验证与限制

发布前重新执行完整 npm run check、隔离 Chromium UI 矩阵及 git diff --check。基线已有 42 文件、230 测试通过、1 项既有跳过；8 组浅深色/尺寸 UI 回归及 320px 容器验证。最终结果及 CI/Registry 回读在发布后补记。

真实 DSH 四插件同装和真实 QCC Provider 本轮未运行，不能由发布成功代签。历史仅提供本 Session 已保存查询记录；跨会话索引、实时 MCP 连接状态、细粒度未提交编辑的统一恢复未接入。查询草稿/导航内存刷新或卸载后清除，任务/制品由 Host 保留。兼容对照 Better Sidebar 0.17.1 的公开能力与 mount/store 契约，不扩大 peer 范围。

## 流程及回滚

release 分支 → PR CI/审核 → 锁定 SHA 合并 → 精确 main SHA CI → annotated v0.5.4 → OIDC npm/provenance → GitHub Release → Registry 回读。公开 tag/版本不覆盖；失败不得复用 npm 版本。

回滚：备份用户任务目录后安装 dsh-tender-workbench@0.5.3，并按既有方式重启 DSH web；本轮不操作用户生产进程。

详细采用记录：[QCC-BLUE-UI-ACCEPTANCE.md](QCC-BLUE-UI-ACCEPTANCE.md)。
