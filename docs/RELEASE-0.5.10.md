# 招投标 0.5.10 发布记录

Version: **0.5.10**
Status: **ready for release**

落实 UX-48：提示词回填不展开；当前招投标 Session 的提交经 Host `beginSubmission` 的 `onRetire(reason: observed)` 确认接纳后，自动展开对应工作台一次。失败、跨会话回调、重复结算、卸载后回调和后续进度不重复展开；可选侧栏错误不影响提交。

兼容边界：无该接纳 API 的旧 Host 保留手动打开；侧栏依赖缺失时不伪造任务进度或延迟抢焦点。本轮不重新执行付费模型/MCP 或四产品真实 Host 共存测试。

定向回归 12 项通过；完整发布门禁和精确提交 CI 在发布前验证。采用既有 GitHub OIDC Trusted Publishing，无需用户重复 npm 登录。不修改既有版本或 Tag。
