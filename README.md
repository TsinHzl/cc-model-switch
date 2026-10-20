# cc-model-switch

将 `~/change-ai-config.sh` + `~/change-ai-config.json` 的能力搬上 Web：在浏览器里切换 Claude Code 模型、管理配置条目，**通过 File System Access API 直接读写本地文件，服务器不接触任何配置数据**。

React 18 + TypeScript + Vite 纯静态站，零后端逻辑、零运行时依赖（仅 react/react-dom）。

## 快速开始

```bash
npm install
npm run build
node server.mjs          # → http://localhost:15858
```

开发模式：`npm run dev`（Vite 5173 端口，同样满足 secure context）。

## 三种访问方式（必须满足 secure context）

浏览器只有 HTTPS / localhost 才开放文件读写与加密 API，按部署位置三选一：

| 方式 | 命令 | 访问地址 |
|---|---|---|
| 本机直跑 | `node server.mjs` | http://localhost:15858 |
| 远程服务器 + SSH 隧道（推荐） | `ssh -L 15858:127.0.0.1:15858 <user>@<server>` | http://localhost:15858 |
| 远程服务器 + HTTPS 反代 | Nginx/Caddy 反代 15858 并配证书 | https://你的域名 |

> ⚠️ 用 `http://<服务器IP>:15858` 直接访问**不可用**——非 secure context，浏览器禁止 File System Access API 与 `crypto.subtle`，页面会显示对应说明。
> 必须从**存放配置文件的 Mac** 上的浏览器访问（浏览器直写架构决定的）。

## 首次使用

1. Chrome / Edge（桌面版，Safari/Firefox 不支持）打开页面
2. 设置访问密码（SHA-256 哈希存 localStorage，防误触而非安全边界）
3. 依次授权 3 个文件（文件选择器中按 **Cmd+Shift+.** 显示 `.zshrc` 等隐藏文件）：
   - `~/change-ai-config.json`
   - `~/.claude/settings.json`
   - `~/.zshrc`
4. 授权持久化在 IndexedDB，刷新无需重选；浏览器重启后首次读写会请求恢复权限，一键确认

## 功能

- **模型切换**：按 URL → 渠道 双级分组（与 sh 脚本菜单一致），当前激活项高亮；写入位置二选一（`~/.zshrc` 标记块 / `~/.claude/settings.json` env），另一目标互斥清理——与 `~/change-ai-config.sh` 行为逐字节兼容（bash `printf %q` 转义、jq `--indent 2` 序列化、标记块置顶）
- **配置管理**：表单新增/编辑/删除条目，必填校验，key 默认脱敏可切明文，写回保持 4 空格缩进原格式
- **防覆盖**：每次写入前从磁盘重读最新内容再增量修改（页面长开期间外部编辑不会被覆盖），写后回读校验

## 已知局限

- 仅 Chrome / Edge 桌面版；需 secure context
- 切换后**已打开的终端不即时生效**，新开 shell / `claude` 会话生效（与 sh 脚本一致）
- 密码门禁是防误触，不是安全边界：能物理接触电脑或同源脚本可绕过
- File System Access API 不回传绝对路径，只能靠文件名校验（选错文件会被拒绝）

## 测试

```bash
npx vitest run   # 33 个用例：shellQuote/applyConfig/configModel（含真实配置分组快照）
```

## 服务管理

```bash
./start.sh   # 一键启动（已在运行则先 stop 再 start；dist 缺失时自动构建）
./stop.sh    # 一键停止（幂等，未运行时静默通过）
```

启动日志见 `.server.log`，pid 记录在 `.server.pid`（两者均已被 git 忽略风格忽略，可自行加入 .gitignore）。
