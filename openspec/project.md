# 项目上下文

## 技术栈

- 单项目仓库：React 18 + TypeScript + Vite 前端，原生 Node HTTP/文件服务，Zod 边界校验，Vitest 测试。
- 服务运行在配置所在 Mac，浏览器通过同源 API 操作，不依赖 File System Access API。

## 架构约定

- 生产监听 `127.0.0.1:15858`，托管 dist 和 API；开发由 Vite 在 `127.0.0.1:5173` 挂载同一 API。Host 精确匹配，不开放 CORS 或远程静态部署。
- 配置来自服务进程用户 home 的固定三个文件；config 可读写，zshrc 可读写，settings 只读，不存服务端配置副本。
- 模型切换仅写 zshrc，保留七键 export、标记块及转义格式；settings 优先用于激活态识别，不做互斥清理。
- 只支持普通文件，拒绝符号链接；写前重读、校验三元组/原数组下标，进程内串行原子替换、写后回读，不宣称跨进程 CAS。
- 密码门禁仅防误触；API 采用 Host/Origin/同源 bootstrap/内存 token 校验。会话失效需整页刷新，写入不确定时核对状态，不自动重放。

## 目录结构

- `src/`：页面、API 客户端和共享领域纯函数。
- `server/`：固定文件 IO、元数据检测、业务服务、HTTP 边界及真实 IO/HTTP 测试。
- `server.mjs`：生产服务入口；`vite.domain.config.ts`：共享领域构建入口。
- `dist/`：前端产物；`dist-server/`：非静态托管的服务端领域产物。
- `openspec/`：项目上下文、当前 specs 与历史 changes 归档。

## 开发约定

- 使用 `npm test`（先构建领域模块）和 `npm run build` 验证；无 ESLint/Prettier 配置。
- 测试只用临时配置与自建服务，不修改真实个人文件或停止既有进程。
- 常规提交格式沿用 `<type>: <中文描述>`；跳过 OpenSpec 的变更另遵守用户确认的前缀约定。
