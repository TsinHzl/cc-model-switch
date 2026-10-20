# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`cc-model-switch` 是 `~/change-ai-config.sh` 的 Web 替代：在浏览器中切换 Claude Code 模型配置、增删改配置条目。React 18 + TypeScript + Vite 纯静态站，无后端运行时。

## 常用命令

```bash
npm install
npm run dev        # Vite 开发服务器，端口 5173（localhost 满足 secure context）
npm run build      # tsc -b && vite build → dist/
npm run serve      # node server.mjs，静态托管 dist/，端口 15858
npm test           # vitest run（45 用例）
npx vitest run src/lib/__tests__/applyConfig.test.ts   # 单文件
npx vitest run -t "关键词"                              # 按用例名过滤
npx tsc -b         # 仅类型检查（noEmit）；仓库无 ESLint/Prettier 配置
./start.sh         # 后台启动，先 stop 旧进程；dist 缺失时自动构建
./stop.sh          # 幂等停止（pidfile + 端口兜底清理）
```

## 核心架构：浏览器直写

服务端 `server.mjs` 只做 `dist/` 静态托管（含路径穿越防护与 SPA 兜底），**不接触任何配置数据**。本地文件读写全部由访问者 Mac 上的 Chrome/Edge 通过 File System Access API 完成：

- 三个目标文件在 `src/lib/fileAccess.ts` 的 `FILE_METAS` 中定义：`config`（`~/change-ai-config.json`）、`settings`（`~/.claude/settings.json`）、`zshrc`（`~/.zshrc`）。
- `handleStore.ts` 把 `FileSystemFileHandle` 持久化到 IndexedDB；每次操作前 `queryPermission`，失效时由 `ModelSwitch` 的 `ErrorPane` 引导逐个重新授权（picker 消耗 transient activation，一次点击只能开一个选择器）。
- FSA 不回传绝对路径，只能按文件名校验（`FileMismatchError`）。
- 仅 secure context（HTTPS/localhost）下的 Chrome/Edge 可用；`fsaTypes.detectEnvironment()` 在密码门禁之前拦截并给出对应指引。部署到远程服务器时必须走 SSH 隧道或 HTTPS 反代，`http://<IP>:15858` 直接访问必然失败。

## 数据流

`configStore.loadConfigState()` 每次从磁盘重读三个文件：
1. `JSON.parse` config 文本 → `groupConfigs()` 按 base_url → channel 双级分组（保留 JSON 出现顺序，每项携带原数组下标，分组扁平序 ≠ 数组序）。
2. `readActive()` 优先读 settings.json env 的 `ANTHROPIC_MODEL/BASE_URL/AUTH_TOKEN` 三元组，为空或损坏时回退 zshrc 标记块；`findActiveIndex()` 要求三元组完全相等。
3. `applyModel()` 写前重新加载，按三元组而非下标定位条目（防外部编辑导致 index 漂移），然后写目标文件并互斥清理另一处。

`ConfigEditor` 的增/改/删同样基于磁盘最新内容做增量修改，编辑/删除时用「下标 + 三元组」双重校验，不匹配即中止写入。

## 与 sh 脚本的字节级兼容（改动时最易破坏）

`applyConfig.ts` / `shellQuote.ts` 是 `~/change-ai-config.sh` 的移植，两套工具写同一批文件，必须保持逐字节一致：

- zshrc：标记块 `# >>> change-ai-config >>>` / `# <<< change-ai-config <<<` 置顶插入，含 7 个 `ANTHROPIC_*` export；写 zshrc 时清理 settings.json 的 7 个同名键，反之亦然。
- settings.json：`JSON.stringify(..., null, 2) + '\n'`（对齐 `jq --indent 2`），仅动 env 中的 7 键。
- change-ai-config.json：4 空格缩进 + 末尾换行。
- 值转义：`shellQuote()` 复刻 bash `printf %q`（含 UTF-8 多字节字符直通）。

改动这些纯函数后必须跑 `applyConfig.test.ts` / `shellQuote.test.ts` / `configModel.test.ts`（含真实配置快照）。

## 原子写入契约

所有写入走 `fileAccess.writeFileAtomic(key, transform)`，transform 必须满足（函数头注释有完整说明）：
- **纯函数**：基于传入的磁盘最新文本计算，不得依赖页面内存副本；
- **幂等**：`InvalidStateError` 重试时会重复调用；
- **不动点 = 目标状态**：`transform(s) === s` 当且仅当 s 已是目标状态——收敛检测依赖此性质判定「close 报错但已落盘」是否成功。

写后回读校验；`InvalidStateError` 的各类分支（未落盘重试 / 已落盘不重试 / 收敛判定）在 `fileAccess.test.ts` 中用 mock 句柄覆盖，改动重试逻辑需同步更新用例。

## UI 结构

`App.tsx`：环境检测 → `Gate`（密码门禁）→ 双 Tab（无路由）`ModelSwitch` / `ConfigEditor`。密码仅防误触，SHA-256(salt+pw) 存 localStorage，sessionStorage 记录会话解锁，不是安全边界。key 默认由 `maskKey()` 脱敏，可切换明文。

## 规范

- `openspec/specs/cc-config-management/spec.md` 是功能行为的规范来源；`openspec/project.md` 记录架构约定。
- 提交信息实际使用 `<type>: <中文描述>`（feat/fix 等），与 `openspec/project.md` 中 `<type>(<change-name>)` 的写法有出入，以仓库实际历史为准。
