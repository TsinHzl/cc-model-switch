# CLAUDE.md

本文为 Claude Code 提供本仓库开发约定。

## 项目概览

`cc-model-switch` 在浏览器中切换 Claude Code 模型、增删改配置条目。React 18 + TypeScript + Vite + Zod 前端，通过同源 API 调用同机原生 Node 服务；不再使用 File System Access API 或 IndexedDB 文件句柄。

## 常用命令

```bash
npm install
npm run dev          # predev 构建领域模块；127.0.0.1:5173，同源 API
npm run build        # tsc -b + 领域模块构建 + 前端构建
npm run build:domain # 生成 dist-server/domain.mjs
npm run serve        # Node API + dist 静态资源，127.0.0.1:15858
npm run preview      # 同生产入口，需先构建
npm test             # pretest 构建领域模块；vitest run
npm test -- server/__tests__/api.test.mjs
npm test -- src/lib/__tests__/applyConfig.test.ts
npm test -- -t "关键词"
npx tsc -b           # 类型检查；仓库无 ESLint/Prettier 配置
./start.sh           # 先停旧服务，每次完整构建；缺依赖时安装
./stop.sh            # pidfile + 端口兜底清理
```

注意 start/stop 会终止占用 15858 的进程。测试不得调用这些脚本或结束非本次创建的进程。

## 核心架构：同机文件服务

- `server.mjs` 导出 `createLocalServer({ home, root })`，仅直接执行时监听 `127.0.0.1:15858`；生产 home 来自 `os.userInfo().homedir`，测试才注入临时目录。
- `vite.config.ts` 的 configureServer 挂载同一 `createApiHandler`，监听 `127.0.0.1:5173`，不设跨端口代理或 CORS。
- `server/files.mjs` 固定三个目标：config（`~/change-ai-config.json`）、settings（`~/.claude/settings.json`）、zshrc（`~/.zshrc`）；只有 config/zshrc 可写。
- `server/api.mjs` 校验 Host、Origin、启动期 token、请求类型/大小/超时及限流；bootstrap 要求同源 Fetch Metadata 和自定义请求头。Host 必须为 `127.0.0.1:实际端口`，不能推荐 localhost 或远程部署 URL。
- `server/service.mjs` 用 Zod 校验业务输入和配置列表；HTTP 不接收 home、任意路径、文件全文或 transform。错误不暴露原文、密钥或真实 home。
- `src/lib/serverDomain.ts` 仅导出服务需要的纯函数，经独立 Vite library 构建到静态目录之外的 `dist-server/domain.mjs`；不要复制一份转义/分组算法。

## 数据流与客户端契约

- `apiClient.ts` 先 bootstrap，token Promise 仅内存缓存；请求强制同源、不跟随重定向、不缓存。`GET /api/state` 返回校验后的 entries/groups/activeIndex，不返回文件原文。
- `configStore.loadConfigState()` 调用 state API；服务读取三个最新文件，按 URL → channel 分组，保留 JSON 顺序及原数组下标。分组扁平序不等于数组序。
- `readActive()` 优先使用 settings env 的 model/base_url/key 三元组：任意字段非空即使用，三字段全空或解析失败才回退 zshrc；`findActiveIndex()` 要求完全相等。
- `POST /api/apply` 按 expected 三元组在最新 config 中定位，仅写 zshrc，settings 原样保留；channel 不参与身份判定。
- `POST /api/entries` 新增，`PATCH/DELETE /api/entries/:index` 同时校验原下标和 expected 三元组。新增/删除保留其他条目的未知字段；编辑整体替换目标为四个已知字段。
- 写成功为 204，不附带状态；写失败抛 ApiError。`reload()` 返回 boolean 且自行设置安全错误态，`applyModel()` 写成功后返回刷新结果；不能把刷新失败当作写入未发生。
- `SESSION_EXPIRED` 需要整页刷新，`WRITE_UNCERTAIN` 需要重读核对；禁止自动重新鉴权并重放写请求。ready 状态刷新不先卸载列表，防滚动归零。

## 与脚本兼容的格式

- zshrc 标记为 `# >>> change-ai-config >>>` / `# <<< change-ai-config <<<`，置顶插入 7 个 `ANTHROPIC_*` export；`shellQuote()` 保持 bash `printf %q` 等价转义。
- change-ai-config.json 保持四空格缩进和末尾换行。
- 当前 Web 行为不再包含写 settings 或互斥清理；不要因历史纯函数仍在而恢复这些入口。
- 改动共享纯函数必须回归 applyConfig、shellQuote、configModel 测试。

## 文件写入契约

- 所有写入经 `createFileStore().update(key, transform)`，基于传入最新文本计算；依赖读取必须经 transform 的 `readDependency` 登记快照。
- 只支持普通文件，拒绝目标及父路径符号链接；拒绝 root、硬链接和不支持的写权限/所有权。`server/metadata.mjs` 保守检测 ACL、xattr、flags，检测失败不得退化为直接写入。
- 无变化不写；写队列串行，排他创建同目录 0600 临时文件，保留允许的 mode/uid/gid，fsync，替换前复核目标/依赖，再 rename、目录 fsync、回读。
- 替换前失败清理临时文件；rename 后异常报告 WRITE_UNCERTAIN，不自动重试。不要移植旧 FSA 的 InvalidStateError 重试或收敛判定。
- 队列及替换前检查不是跨进程 CAS，不宣称绝对互斥。不得 source、执行或 shell 插值用户配置。
- 文件层与 HTTP 测试使用临时 home 和随机 loopback 端口，不访问真实配置；浏览器验收也必须隔离 home 与浏览器数据。

## UI 结构

`App.tsx`：`Gate` → 单页 `ModelSwitch`，包含搜索、分组、切换确认与增删改弹窗。密码仅防误触：SHA-256(salt+pw) 存 localStorage，sessionStorage 记录会话解锁，不是 API 安全边界。key 默认由 `maskKey()` 脱敏。测速仍从浏览器发起，不迁到服务端。

## 规范

- `openspec/specs/cc-config-management/spec.md` 是当前行为规范，`openspec/project.md` 记录架构约定；归档保留历史，不作为恢复旧行为的依据。
- 常规提交格式沿用 `<type>: <中文描述>`；用户确认跳过 OpenSpec 的变更遵守其专用提交前缀约定。
