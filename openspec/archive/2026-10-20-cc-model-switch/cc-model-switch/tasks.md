# 任务清单：cc-model-switch

## 状态：ARCHIVED（2026-10-20 用户确认验收归档；T7 CR 两轮完成，第 2 轮 PASS，残留 Medium 2 + Low 6 见 ~/.claude/cr-known-issues/sourcetree-8ae41f866d78.md）

## 任务

- [x] 任务 1：脚手架与工程配置 — 在 `cc-model-switch/` 创建 Vite + React 18 + TS 工程（package.json、vite.config.ts、tsconfig、index.html、基础样式变量），验证：`npm install && npm run build` 通过
- [x] 任务 2：文件访问层 — 实现 IndexedDB 句柄持久化、3 文件授权流程、secure context + API 存在性双重能力检测（区分两种不支持原因）、权限检测与失效重授权引导、**写入前强制重读**的读取/原子写入封装，验证：手工在 Chrome 授权 3 文件后页面能读出内容并写回不损坏；非 secure context 下显示对应说明页（注：授权交互验证推迟到任务 5/6 UI 就绪后在浏览器统一实测）
- [x] 任务 3：核心纯函数库 — 移植 sh 脚本逻辑为 TS 纯函数：bash %q 等价转义、zshrc 标记块删除/置顶插入、settings.json env 键更新、配置分组、激活态三元组判定（含 zshrc 回退及"env 三元组不完整"边界用例）；settings.json 序列化格式（缩进/末尾换行）以 sh 脚本 jq 实测输出为基准并单测断言，验证：vitest 单测覆盖全部函数（含真实配置分组快照，实测 46 条/11 URL 组，此前文档记 42 条与现状不符），`npx vitest run` 全部通过（33 个用例）
- [x] 任务 4：密码门禁 — 首次设置密码（二次确认）、登录校验（Web Crypto SHA-256）、会话内免重输，验证：错误密码拒绝、正确密码进入、刷新后需重输（代码路径已实现并 build 通过；浏览器内交互实测推迟到任务 5/6 UI 就绪后统一进行）
- [x] 任务 5：模型切换 UI — 分组列表渲染、当前项高亮、选择写入位置（zshrc/settings.json）、确认弹窗展示目标值与 key 预览、执行与结果反馈，验证：在本地真实文件上完成一次切换后 `claude` 新会话读到的配置与预期一致（实现与 build/test 通过；真实文件浏览器实测推迟到任务 7 server 就绪后统一进行）
- [x] 任务 6：配置管理 UI — 表单化增/改/删（base_url/key/model/channel 必填校验、行内错误提示）、key 脱敏显示与明文切换、JSON 损坏时错误态与原文查看，验证：增改删后磁盘 JSON 与手工编辑格式一致且 sh 脚本菜单可见新条目（写回采用 4 空格缩进与现有文件格式一致，写前重读防覆盖；实现与 build/test 通过，浏览器实测推迟到任务 7 统一进行）
- [x] 任务 7：静态服务与部署文档 — `server.mjs`（node:http 托管 dist，15858 端口）、README（本地预览 / 服务器部署 + SSH 端口转发 `ssh -L 15858:127.0.0.1:15858` / HTTPS 反代三种访问方式 / 首次授权（含 macOS 文件选择器显示隐藏文件的 `Cmd+Shift+.` 快捷键提示，页面授权引导文案同步注明）/ secure context 与密码门禁局限说明），验证：`node server.mjs` 后经 `http://localhost:15858` 访问页面功能完整可用（index/asset/SPA 兜底/URL 编码路径穿越均验证：编码穿越经 URL 解码+归一化后返回 SPA 首页而非越权文件）

## 验收标准

- [ ] 经 secure context（localhost 或 HTTPS）用 Chrome/Edge 打开站点，完成首次 3 文件授权后，模型切换行为与 `~/change-ai-config.sh` 一致（写入位置二选一、互斥清理、标记块格式兼容、sh 脚本菜单能识别 Web 写入的激活态）（Playwright 实测卡在 FSA 文件选择器无法自动化注入真实句柄——`showOpenFilePicker` 被 Playwright 拦截为 file chooser 事件，与 FSA API 不兼容；需用户真人授权一次后其余全链路可自动化，留待用户实测）
- [ ] 非 secure context 或 Safari/Firefox 打开显示对应说明页（含 SSH 隧道指引）
- [ ] 页面长开期间外部修改文件后，Web 端下次写入不覆盖外部变更（写前重读）
- [ ] Web UI 可新增/修改/删除配置项，写回的 JSON 与原手工格式兼容，sh 脚本菜单同步可见变化
- [ ] 首次访问需设置密码，后续访问需登录（Playwright 实测通过：设置密码→刷新免重输→锁会话→错误密码拒绝→正确密码解锁，全链路正常）
- [ ] API key 默认脱敏，可切换明文
- [ ] 任务 3 的 vitest 单测全部通过（`npx vitest run` 退出码 0）
- [ ] `npm run build` 产物经 `node server.mjs` 在 15858 端口、`http://localhost:15858` 下完整可用（Playwright 实测通过：页面加载、密码门禁、授权错误面板渲染正常；index/asset/SPA 兜底/路径穿越防护 curl 验证通过）
