# 小程序 AI 工作说明

- Git commit 信息使用中文，说明实际改动。
- 使用 pnpm 安装、添加、更新和移除依赖；Windows 下使用 `pnpm.cmd`。
- 修改前检查 `git status --short`，保留其他会话的已有改动。
- 项目总导航在上级目录的 `AGENTS.md` 和 `项目导航.md`；仅维护项目内说明，不修改全局配置或记忆。
- 修改后按范围运行 `pnpm.cmd run typecheck` 和微信开发者工具验证。
