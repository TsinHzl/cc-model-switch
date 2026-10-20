# 项目上下文

## 技术栈

- 本仓库为多项目根目录（无统一技术栈），各子目录独立项目
- 本次变更技术栈：React 18 + TypeScript（Web UI），静态部署，无后端运行时依赖
- 浏览器 File System Access API（`window.showOpenFilePicker` / `showSaveFilePicker`），仅 Chrome/Edge 支持

## 架构约定

- 浏览器直写架构：服务端仅托管静态资源（端口 15858），本地文件读写全部由用户 Mac 上的浏览器完成
- 本地 `~/change-ai-config.json` 为唯一配置数据源，Web UI 不在服务端存任何配置副本
- 与 `~/change-ai-config.sh` 行为完全对齐：切换模型时互斥写入 `~/.zshrc` 标记块或 `~/.claude/settings.json` env 块，并清理另一处
- 访问控制：Web UI 密码保护（首次访问设置密码，密码哈希存 localStorage）

## 目录结构

- `openspec/`：OpenSpec 规范文件（project.md、changes/、specs/）
- 各业务项目为根目录下独立子目录，互不依赖

## 开发约定

- 无统一 linter/测试配置；本次变更按子项目自带配置执行
- 提交信息遵循 `<type>(<change-name>): <description>` 格式
