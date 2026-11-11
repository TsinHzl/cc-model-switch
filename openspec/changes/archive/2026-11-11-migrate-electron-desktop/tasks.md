# 任务清单：migrate-electron-desktop

## 状态：ARCHIVED

> 平台扩展与跨平台原生验收已拆分至 `openspec/changes/platform-native-acceptance`：Windows x64、Linux x64、macOS x64、DMG/NSIS/AppImage 安装包、单实例锁与 activate 重激活、剪贴板原生写入、迁移全量 diff 独立审查。本变更按 macOS arm64 已取得的真实验收证据收尾。

## 执行约束
- 仅使用 proposal.md 和本文件追踪轻量 OpenSpec；进入实施后以本文件为准。
- 当前仓库缺少 openspec/config.yaml，按用户确认沿用现有项目约定继续，不额外初始化配置。
- 实施前完成原始需求确认、独立需求回溯及提案确认；每批源码 diff 仍需单独确认。
- 每项任务独立验证后勾选，预计超过两小时则先拆分；不以一次总体验收代替逐项证据。
- 非 trivial 逻辑先失败测试再实现，优先真实文件、原生 API 和 Electron 集成验证。
- 原生能力先小范围验证；目标平台不可用时记录阻塞，不先宣称该平台适配已完成。
- 本机可独立推进的任务不因其他平台待验收而伪造通过结论。
- 完成实现后执行独立 Code Review；归档须另获用户确认。

## 进度记录（2026-11-09）
- 任务 1：已安装 electron 45.2.3、electron-vite 6.0.0、@types/node 24.19.2；依赖审计为零已知漏洞，原有锁定依赖未变。
- 已建立 TS 主进程、沙箱 preload、受限资源协议和独立桌面构建入口；尚未接入配置 IPC，不能用于桌面配置管理。
- 验证：npm test 为 9 个文件、167/167 通过；npm run desktop:build 与 npm run build 成功，保留两条既存 Zod 注释警告；git diff --check 通过。
- 产物核对：声明的主进程和 preload 文件存在，实际生产主进程不含 ELECTRON_RENDERER_URL；四个目标平台架构均有上游校验清单记录，但不代表原生运行通过。
- 审查：依赖批次无发现；入口批次发现一项生产构建接受开发地址的 High，已按先失败后通过的构建测试修复，第二轮主审和安全专项均无新增发现。
- 阻塞：官方 Electron 二进制下载连接 github.com:443 超时；未启动 Electron、未验收窗口或原生平台行为，任务 1 暂不勾选，其他任务仍未完成。
- 任务 9：共享文件层、错误类、macOS 元数据检测及文件层测试已迁至 TS；旧 files/errors 仅重导出同一次构建的产物，未保留第二套算法。
- 任务 9 验证：迁移前文件层与 API 基线 87/87；迁移后 npm test 为 167/167，npm run desktop:build、npm run build、兼容出口工厂与错误类身份断言及 git diff --check 均通过；保留两条既存 Zod 注释警告。
- 任务 9 审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0；未新增待修复问题，建议第二人复核文件替换失败语义与兼容出口。此结果不替代 Electron 或其他平台原生验收。
- 任务 10：业务服务已迁至 TS，状态响应契约由服务与客户端共用；旧 service 仅重导出编译产物，保留各类输入原有校验规则。
- 任务 10 验证：迁移前业务/API/领域基线 107/107，新增真实文件特征测试先在旧 JS 服务通过 11/11；迁移后 npm test 为 178/178，npm run desktop:build、npm run build、服务兼容出口与错误类身份断言及 git diff --check 均通过；保留两条既存 Zod 注释警告。
- 任务 10 审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0；未新增待修复问题，建议第二人复核三元组与原下标定位、未知字段保留。此结果不替代 Electron 或其他平台原生验收。
- 任务 2（第一批）：已将桌面启动逻辑提取为无导入启动副作用的 bootstrap，生产入口显式调用；协议、单实例锁、窗口和会话限制保持原行为。
- 任务 2（第一批）验证：原桌面回归 8/8；新增导入边界测试先因导入触发协议注册而失败，最终 npm test 为 182/182，npm run desktop:build、npm run build 与 git diff --check 均通过；新增四例仅验证启动编排，不替代原生验收。
- 任务 2（第一批）审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0；未新增待修复问题。隔离资源、独立测试入口及原生隔离验证尚未完成，任务 2 保持未勾选；建议第二人复核启动时序与产物资源路径。
- 任务 2（第二批）：已新增同步测试资源工厂，固定派生 home/userData/sessionData/logs/crashDumps，拒绝路径覆盖；清理绑定本次根并复核目录身份，创建与清理双重失败保留两项错误。注册表仅生成隔离目标描述，不执行原生操作。
- 任务 2（第二批）验证：新增 16 例先全部失败、实现后 16/16 通过；npm test 为 198/198，npm run desktop:typecheck、npm run desktop:build、npm run build、差异与新增文件空白检查均通过，生产主进程产物 SHA-256 未变。真实 IO 覆盖目录替换、链接、清理失败及 FileStore 夹具隔离。
- 任务 2（第二批）审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0；未新增待修复问题，建议第二人复核清理所有权与失败语义。消费者必须停止使用目录后再清理，不承诺对抗同账户恶意并发替换；Windows DACL、跨平台原生行为及 Electron 实际会话隔离未验证，独立测试入口尚未接入，任务 2 保持未勾选。

- 任务 2（第三批）：已接入独立测试入口，同步设置本次 home/userData/sessionData/crashDumps/logs 后启动；初始化失败尝试清理，开始启动后保留目录。测试配置单向复用生产配置，新增 desktop:test:build，输出到 out-test，生产启动源码未改。
- 任务 2（第三批）验证：RED 为 17 例失败、1 例生产构建基线通过，GREEN 为新增 18/18；npm test 为 216/216，npm run desktop:typecheck、npm run desktop:build、npm run desktop:test:build、npm run build、git diff --check 及新增文件空白检查均通过。真实内存构建检查三目标模块图；磁盘交替构建的完整文件清单与 SHA-256 互不覆盖，生产产物与本批前一致；保留两条既存 Zod 注释警告。
- 任务 2（第三批）审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，未新增待修复问题；建议第二人复核路径初始化顺序、清理时序及构建隔离。未启动 Electron，原生开关可能在 JavaScript 前消费，固定参数检查不代表完全原生隔离；业务 home/注册表注入与原生验收仍待后续，任务 2 保持未勾选。

## 进度记录（2026-11-10）
- 任务 14（第一批）：新增五个固定配置操作的共享 IPC 请求与响应契约；从 service 等价提取请求校验，保持历史 expected、新写入字符串规则及磁盘未知字段保留行为。写成功不附状态，错误响应仅允许固定错误码与 cleanupFailed。
- 任务 14（第一批）验证：原业务/API 基线 73/73；契约 RED 为 43 例失败、20 例通过，GREEN 联合回归为 136/136；npm test 为 14 个文件、279/279。npm run desktop:typecheck、npm run desktop:build、npm run desktop:test:build、npm run build、git diff --check 及新增文件空白检查均通过；保留两条既存 Zod 注释警告。
- 任务 14（第一批）边界验证：遍历全部 65536 个单 UTF-16 码元对照旧 Buffer 校验，并覆盖合法代理对及孤立代理项组合；共享契约通过浏览器目标内存构建，在没有 Buffer/process/require 的 VM 中执行校验通过，不替代 Electron 原生验收。
- 任务 14（第一批）审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，未新增待修复问题；无修复增量。建议第二人复核 Unicode 等价性、未知字段保留及错误响应限制。preload、IPC handler、可信来源校验、载荷与队列限制、异常映射及原生验收尚未完成，任务 14 保持未勾选。
- 原生环境阻塞：本次 npm run desktop:install 重试超过 12 分钟未完成，已停止本次安装任务；Electron 可执行文件、dist/version 和 path.txt 仍不存在，未启动 Electron。按用户选择先推进 IPC 契约，不将本次未完成安装记为新的连接超时报错。

- 任务 14（第二批）：新增五个固定业务处理函数，在首次 await 前检查可信窗口、当前主 frame、存活状态、实际 origin 与页面地址；严格解析请求后分发到现有 service，编辑/删除分离 index。响应返回解析结果以剥除未知字段，错误仅返回有限错误码和布尔清理标记，保留 WRITE_UNCERTAIN，不自动重放或刷新。
- 任务 14（第二批）验证：RED 为 46 例失败、1 例冻结接口基线通过；GREEN 为新增 47/47，定向回归 146/146，npm test 为 15 个文件、326/326，无跳过。六例真实文件集成测试实际运行，覆盖状态、应用、CRUD、冲突、无效配置、缺文件及写后刷新失败；npm run desktop:typecheck、npm run desktop:build、npm run desktop:test:build、npm run build、git diff --check 及新增文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 14（第二批）审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，未新增待修复问题，无修复增量；建议第二人复核来源身份校验与错误映射。本批不注册 IPC，不修改 preload 或启动入口；业务 home 显式注入、载荷与有限队列必须在首次接线前闭合。Electron 对象使用测试替身，原生 origin、frame、桥接和路径隔离仍未验收，任务 14 保持未勾选。

- 任务 14（第三批）：新增 64 KiB 紧凑 JSON 等价 UTF-8 请求预算；固定结构预检查拒绝 Proxy、访问器及非普通对象，不执行原始请求的回调。五方法共享一个在途名额，满额拒绝且不排队，名额覆盖业务执行与响应校验，并在 finally 中释放。
- 任务 14（第三批）验证：RED 为 20 例失败、50 例通过；GREEN 为 handler 70/70、定向回归 169/169、全量 15 个文件 349/349，无跳过。八例真实文件集成测试实际运行；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及两文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 14（第三批）审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核请求计量和名额释放。预算不代表 Electron 传输字节数，不覆盖进入 handler 前的克隆开销，也不保证对象键枚举成本严格有界；单名额不是频率限流。本批未注册 IPC 或修改启动入口，未启动 Electron，任务 14 保持未勾选。

- 任务 14（第四批）：新增冻结的五通道映射、桥接类型及未接入入口的桥接工厂；只提供五个固定业务方法，校验并复制请求，返回解析后的响应。非法请求不发送；合法业务错误保留有限字段，传输异常或损坏响应统一提示操作结果未知，不泄露原始异常、不自动重放或刷新。
- 任务 14（第四批）验证：有效 RED 为 30 例失败、1 例冻结接口基线通过，GREEN 为新增 31/31、定向回归 164/164；全量 npm test 为 16 个文件 380/380，无跳过。测试编写中的类型断言换行及 unknown 收窄错误已修正，编译失败不计入 RED。desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及三文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 14（第四批）边界与审查：真实内存构建后的桥接在无 Buffer/process/require 的 VM 中执行通过；生产与隔离构建的 main/preload/renderer 模块图均未引入桥接或 handler。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核通道映射和通信失败语义。业务 home 隔离、IPC 注册及桥接开放仍待实施，未启动 Electron，VM 不替代原生验收，任务 14 保持未勾选。

- 任务 2（第四批）：bootstrap 必填注入 home 解析函数，取得单实例锁且 ready 后仅解析一次并组装真实 FileStore/Service；生产使用账户 home，隔离入口捕获 resources.home。启动不执行业务读写，首次窗口加载成功后才返回 Service；同步及异步启动失败统一安全提示并退出。
- 任务 2（第四批）验证：RED 为 14 例失败、28 例通过；实现后两例构建边界测试发现无扩展名导入误选旧 .mjs 兼容出口，已按确认改为 .js 导入并解析至 TS，未放宽断言或修改构建配置。最终定向 58/58、全量 npm test 为 16 个文件 392/392，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及六文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 2（第四批）边界与审查：真实临时文件验证 state、新增及 apply 仅使用注入的 home，settings 与诱饵 home 文件的内容、inode、mtime、mode 不变；两套构建的业务模块仅进入 main，三目标均未引入桥接或 handler。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无审查修复增量；建议第二人复核 home 来源及启动失败退出路径。未启动 Electron，原生路径隔离与注册表注入仍待验收，任务 2 和任务 14 保持未勾选。

- 任务 14（第五批）：主进程注册五个固定配置通道，应用级复用同一组 handler 与在途名额；可信来源绑定当前窗口及实际加载目标。注册失败仅回滚本次成功项，窗口关闭不重置名额，加载失败与退出时停用并清理；preload 尚未开放配置桥接。
- 任务 14（第五批）验证：RED 为 20 例失败、37 例通过；接线后通过构建与错误码测试复现旧 .mjs 兼容出口造成的错误类身份不一致，已统一 handler 及测试夹具的 .js 导入。最终定向 127/127、全量 npm test 为 16 个文件 407/407，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及六文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 14（第五批）边界与审查：真实注册 listener 覆盖五项文件操作，settings 与诱饵 home 保持不变；覆盖注册冲突回滚、来源拒绝、参数透传、跨窗口共享名额和失败清理。主审与安全专项调用被用户中断，随后用户明确要求跳过 CR，本批未审查；建议第二人复核来源绑定与清理所有权。未启动 Electron，替身不代表原生 frame/origin 或生命周期验收；will-quit 清理不保证在系统关机、注销或强制终止时执行，任务 14 保持未勾选。

- 任务 14（第六批）：preload 保留 desktop.platform，新增 desktop.config，复用固定五方法桥接，通过包装函数调用 ipcRenderer.invoke；不暴露通用 IPC，不修改页面客户端、主进程或依赖。
- 任务 14（第六批）验证：扩展两套真实构建测试，RED 为 2 例失败、32 例通过；接线后定向 34/34，全量 npm test 为 16 个文件 407/407，无跳过。desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及两文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 14（第六批）边界与审查：实际 preload CJS 产物在受限 VM 中执行，覆盖公开对象、固定通道、请求与响应复制、非法参数拒绝、WRITE_UNCERTAIN、异常脱敏及不重放；两套 preload 均为仅外部依赖 Electron 的单文件产物，不含主进程业务模块。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核公开能力与产物依赖边界。本批审查不覆盖第五批注册代码；未启动 Electron，VM 不代表原生 sandbox、contextBridge 或跨上下文行为验收，任务 14 保持未勾选。

- 任务 15（第一批）：页面配置客户端改用 desktop.config 固定五方法，保留既有导出、字段裁剪及 ApiError；新增只读 Window 桥接类型。缺少桥接明确报错，不回退 HTTP；业务错误使用本地固定文案并保留清理失败提示，通信异常标记 IPC_ERROR、提示结果未知，不自动重放。
- 任务 15（第一批）验证：客户端与状态层测试接入真实桥接工厂，RED 为 55 例失败；接线后定向六文件 222/222，全量 npm test 为 16 个文件 430/430，无跳过。desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及四文件空白检查均通过，保留两条既存 Zod 注释警告。
- 任务 15（第一批）边界与审查：验证五方法精确调用、全部业务错误码、缺桥接拒绝、响应校验与脱敏、禁止 HTTP 回退，以及写成功后刷新失败返回 false、后续显式读取不重放写入。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核错误分类与写后刷新语义。用户已确认普通浏览器不再可用的过渡状态；旧 HTTP 服务、平台文案及旧会话提示尚未清理。未启动 Electron，静态 React 测试不代表 DOM 生命周期或滚动验收，任务 15 保持未勾选。

- 任务 15（第二批）：页面提示改为桌面应用语境，明确当前仅支持 macOS 写入及 ~/.zshrc 目标；移除旧 HTTP 会话刷新分支，错误恢复仅重新读取并提示核对此前写入。将 activeIndex=-1 的提示改为未匹配，避免误报两个来源均为空；保留 settings 优先识别及密码仅防误触的约定，密码行为不变。
- 任务 15（第二批）验证：新增五例真实组件静态渲染测试，RED 为 5/5 失败，修改后定向四文件 71/71，全量 npm test 为 17 个文件 435/435，无跳过。desktop:build、desktop:test:build（均包含类型检查）、build、git diff --check 及四文件空白检查均通过；保留两条既存 Zod 注释警告。
- 任务 15（第二批）边界与审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核错误恢复只读取、不重放写入。历史已知问题未修改，旧 HTTP 服务尚未删除。未启动 Electron，静态渲染不代表原生窗口、点击或滚动验收；跨平台写入与最终平台提示仍待后续，任务 15 保持未勾选。

- 任务 16（第一批）：提取 renderer 测速函数，仅接受绝对 HTTP(S) 地址并拒绝内嵌凭据；HEAD/GET 均省略凭据、禁用 referrer 与缓存、拒绝重定向。用户已确认依赖跳转的网关将测速失败；保留 HEAD 异常后回退 GET、每次五秒超时及 HTTP 响应时延语义，失败改为固定文案，不新增主进程代理或放宽权限。
- 任务 16（第一批）验证：原样提取后组件基线 5/5 及 desktop:typecheck 通过；新增 26 例 RED 为 17 失败、9 通过，GREEN 为 26/26，定向两文件 31/31，全量 npm test 为 18 个文件 461/461，无跳过。desktop:build、desktop:test:build、build、git diff --check 及三文件空白检查均通过；保留两条既存 Zod 注释警告。
- 任务 16（第一批）边界与审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核协议、凭据及重定向限制。历史测速问题仅部分解决：已移除旧类型断言，卸载或换 URL 不主动取消请求的行为仍保留。测试不访问真实网关，Fetch 替身不代表 Chromium 安全策略验收；未启动 Electron，剪贴板与 PowerShell 格式尚未适配，任务 16 保持未勾选。

- 任务 16（第二批）：新增尚未接线的只写剪贴板共享契约，固定 clipboard:writeText，仅接受一个原始字符串参数。用户选择 1 MiB 原始 UTF-8 文本上限；超限拒绝、不截断，保留空白、换行及合法 Unicode，拒绝 NUL 和孤立代理项。响应仅允许严格成功对象或有限错误码，不返回复制内容或原始异常。
- 任务 16（第二批）验证：参数化测试夹具在执行前经确认修正，避免数组输入被展开；宽松骨架 RED 为 25 例失败、27 例通过，完整校验 GREEN 为新增 52/52，定向三文件 146/146，全量 npm test 为 19 个文件 513/513，无跳过。desktop:build、desktop:test:build、build、git diff --check 及两文件空白检查均通过；保留两条既存 Zod 注释警告。
- 任务 16（第二批）边界与审查：实际浏览器目标打包产物在提供 TextEncoder、无 Buffer/process/require 的 VM 中验证通过，不依赖 Electron 或主进程模块。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核 Unicode 与字节预算。预算不覆盖 IPC 序列化及克隆前开销；本批未注册通道、开放 preload 或访问系统剪贴板，handler、桥接、页面接入、PowerShell 格式及原生验收仍待后续，任务 16 保持未勾选。

- 任务 16（第三批）：新增未注册的只写剪贴板 handler，等价提取配置来源守卫及独立事件夹具；配置处理顺序不变。剪贴板依次检查可信来源、单字符串参数及 1 MiB 原始 UTF-8 预算，再取得独立在途名额；忙时拒绝、不排队，等待 writer 完成后才成功，同步或异步失败均脱敏并释放自身名额，不自动重试。
- 任务 16（第三批）验证：来源守卫提取前后配置测试均为 70/70；测试清理在执行前经确认修正，新增 handler RED 为 54/54 有效失败，无未处理 rejection，GREEN 为新增 54/54、定向四文件 179/179。全量 npm test 为 20 个文件 567/567，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及七文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第三批）边界与审查：两套真实构建的模块图验证来源守卫仅进入 main，未注册 handler、剪贴板契约及事件夹具均未进入应用产物。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核来源等价性、异步名额释放和失败语义。单名额不是频率限流，预算不覆盖 IPC 克隆前开销；本批未接线、未启动 Electron 或访问系统剪贴板，替身测试不代表原生验收，任务 16 保持未勾选。

- 任务 16（第四批）：新增未接线的冻结剪贴板桥接，仅公开 writeText，复用单字符串、1 MiB 原始 UTF-8 请求校验及严格响应契约。非法输入不发送，合法请求仅调用固定通道一次；保留五种业务错误并返回解析副本，通信异常及损坏响应统一报告结果未知，不泄露原始异常、不自动重试。
- 任务 16（第四批）验证：新增 53 例，RED 为 34 失败、19 通过，GREEN 为 53/53，定向五文件 193/193；全量 npm test 为 21 个文件 620/620，无跳过。desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及三文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第四批）边界与审查：真实浏览器目标 IIFE 在仅提供 TextEncoder、无 Node 全局变量的 VM 中验证通过，两套应用构建均未引入新桥接。主审为 Critical 0 / High 0 / Medium 0 / Low 0；安全专项调用被用户中断，随后用户明确要求跳过剩余 CR，该专项未完成，不视为双审通过。建议第二人复核参数隔离与通信失败语义；未修改 preload、注册或页面，未启动 Electron 或访问系统剪贴板，任务 16 保持未勾选。

- 任务 16（第五批）：主进程在五个配置通道之后注册固定 clipboard:writeText，复用既有来源守卫与应用级剪贴板 handler，通过包装函数保留原生 writer 接收者及 Promise。注册冲突仅回滚本次成功项，窗口重建不重置在途名额；退出停止后续请求，不宣称撤销已提交写入。
- 任务 16（第五批）验证：三文件 RED 为 24 失败、44 通过，失败对应缺少剪贴板注册、清理及构建依赖；GREEN 定向五文件 192/192，全量 npm test 为 21 个文件 631/631，无跳过。desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及四文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第五批）边界与审查：覆盖六通道冲突回滚、原始参数与接收者、来源拒绝、异步完成、跨窗口名额及退出清理；两套构建验证剪贴板 handler 与契约仅进入 main，bridge 仍未接线。已返回的一份审查报告为 Critical 0 / High 0 / Medium 0 / Low 0，另一调用被用户中断，随后用户明确要求跳过剩余 CR，未完成部分不视为通过。建议第二人复核注册所有权与在途写入生命周期；未开放 preload、修改页面、启动 Electron 或访问系统剪贴板，原生验收仍待完成，任务 16 保持未勾选。

- 任务 16（第六批）：preload 新增冻结的 desktop.clipboard.writeText，复用既有单字符串剪贴板桥接，通过包装函数保留 ipcRenderer.invoke 接收者及 Promise；补充只读 Window 类型，不公开通用 IPC，不修改页面复制逻辑。
- 任务 16（第六批）验证：扩展两套实际 preload 构建产物测试，RED 为 2 失败、1 通过，失败对应缺少剪贴板桥接及契约模块；GREEN 定向三文件 87/87，全量 npm test 为 21 个文件 631/631，无跳过。desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及三文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第六批）边界与审查：实际 preload CJS 产物在受控 VM 中验证固定公开接口、参数拒绝、原始文本与 1 MiB 边界、接收者、响应副本、异常脱敏、异步等待及不重试；两套 preload 均为仅外部依赖 Electron 的单文件产物，不引入主进程业务模块，renderer 无剪贴板运行时模块。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核公开能力与 Promise 链。VM 显式提供 TextEncoder，不代表真实 sandbox 或 contextBridge 验收；未启动 Electron 或访问系统剪贴板，页面接入、PowerShell 格式与原生验收仍待完成，任务 16 保持未勾选。

- 任务 16（第七批）：新增桌面剪贴板客户端，将页面 key、完整 JSON 与七行 shell 文本复制接入 desktop.clipboard.writeText，保持原有文本格式和成功提示。严格校验桥接响应，区分业务拒绝与通信结果未知，错误仅展示固定白名单或兜底文案，不回退浏览器、不自动重试。
- 任务 16（第七批）验证：RED 为新增客户端 32 失败及两套构建失败；首次 GREEN 暴露 Vitest spy 同步异常检查触发恶意 Proxy 的测试干扰，经确认改用普通传输函数记录调用，保留真实桥接与全部脱敏断言。最终定向七文件 128/128，全量 npm test 为 22 个文件 663/663，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及四文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第七批）边界与审查：覆盖原样文本、缺桥接、业务拒绝、非法输入、异常脱敏、畸形响应、接收者、异步等待及不重放；两套构建确认 renderer 引入客户端与共享契约，但不引入 Electron bridge、handler 或主进程业务模块。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无审查修复增量；建议第二人复核错误脱敏与异步成功时机。未启动 Electron 或访问系统剪贴板，未验证页面点击、真实 contextBridge 与原生复制；PowerShell 格式及原生验收仍待完成，任务 16 保持未勾选。

- 任务 16（第八批）：提取固定七键原始值映射，供既有 export 与历史 settings 纯函数复用，不恢复 settings 写入入口。新增未接线的 Env 复制格式化函数：macOS/Linux 保持原 shell 文本，Windows 生成七条当前 PowerShell 会话赋值；转义撇号、智能单引号与控制字符，拒绝原始 NUL、孤立代理项及未知平台。用户确认兼容 PowerShell 5.1 与 7.x，空值遵循版本自然语义：旧版删除，7.5 起保留为空。
- 任务 16（第八批）验证：先修正 Unicode 行分隔符混入测试正则的录入问题，采用等价 Unicode 转义；有效 RED 为 30 失败、18 通过。GREEN 定向五文件 83/83，全量 npm test 为 23 个文件 700/700，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及四文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第八批）边界与审查：覆盖固定映射、原 shell 输出、平台拒绝、空值、注入样式文本、智能引号、控制字符及 Unicode 边界。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无审查修复增量；建议第二人复核字符编码与七键映射。当前 PATH 未找到 pwsh/powershell，测试仅验证生成文本，未执行真实 PowerShell；未接入页面、启动 Electron 或访问系统剪贴板，页面接线与原生验收仍待完成，任务 16 保持未勾选。

- 任务 16（第九批）：页面 Env 复制按 desktop.platform 选择既有 shell 或 PowerShell 格式，经共用复制入口提交完整文本并等待结果；未知平台及 Windows 非法字符在提交前拒绝。新增平台 tooltip、Windows 常驻版本与空值说明，明确仅复制当前会话赋值文本、不自动执行或持久化；Key/JSON 复制及当前 macOS 配置写入限制不变。
- 任务 16（第九批）验证：有效 RED 为 18 失败、48 通过；首次 GREEN 暴露超限测试夹具实际未超限，经确认将智能单引号数量由 50,000 改为 60,000，并断言原始值低于、格式化结果高于 1 MiB，不改变生产限制。最终定向八文件 191/191，全量 npm test 为 23 个文件 726/726，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及四文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 16（第九批）边界与审查：覆盖三平台完整文本传输、格式拒绝零提交、编码后大小校验、桥接缺失、业务与通信失败、异步等待及不重放；页面测试仅验证静态输出。主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无审查修复增量，历史已知问题未修改；建议第二人复核平台分支、大小限制及异步失败提示。未启动 Electron、执行真实 PowerShell 或访问系统剪贴板，真实页面点击与原生验收仍待完成，任务 16 保持未勾选。

- 原生环境阻塞更新：本次经确认重试 npm run desktop:install，退出码 1，返回 TypeError: fetch failed；对下载器实际生成的 GitHub 地址执行只读 HEAD 探测，返回 UND_ERR_CONNECT_TIMEOUT。Electron 二进制、dist/version 和 path.txt 仍不存在；未更换镜像、关闭证书校验、启动应用或访问系统剪贴板。用户选择保留阻塞并推进其他迁移任务。
- 任务 3（前置验证）：用户确认先进行宿主 Node 的 macOS 无副作用加载探针，Electron 与目录包验证后补。锁定运行依赖 Koffi 3.3.7（MIT），采用上游 3.x 平台分包；npm install --ignore-scripts 安装主包及 darwin-arm64 分包，未运行安装脚本或源码编译。锁文件仅新增主包与 20 个可选平台记录，已有依赖记录未变；安装审计报告 120 个包、零已知漏洞。
- 任务 3（前置验证）证据：在 darwin-arm64、Node 25.9.0 下真实加载 @koromix/koffi-darwin-arm64/darwin_arm64/koffi.node，调用固定系统库的 getpid 并与 process.pid 比较一致；测试在 finally 中卸载库。定向 1/1，全量 npm test 为 24 个文件 727/727，无跳过；desktop:typecheck、desktop:build、desktop:test:build、build、git diff --check 及新增文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 3（前置验证）边界与审查：本批未将 Koffi 接入生产文件层，未开放 Linux/Windows 写入；主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量。建议第二人复核原生库生命周期及后续平台分包收集；锁定完整性与零漏洞公告不等于审计依赖内部实现。宿主 Node 探针不代表 Electron、目录包、macOS x64 或其他平台验证，任务 3 保持未勾选。

- Linux 范围决定：用户确认 Ubuntu 22.04/24.04 x64 首版仅支持 ext4，其他文件系统拒写，不自动降级。ext2/ext3/ext4 共用 0xef53，后续检测不能只凭 statfs magic 判定为 ext4；挂载识别与实际元数据检查仍待实现和原生验证。
- Linux 安全阻塞：核实 listxattr/flistxattr 可省略不可访问属性，trusted.* 仅对具备 CAP_SYS_ADMIN 的进程可见；普通用户枚举为空不足以证明不存在特殊元数据。用户选择保持 Linux 写入关闭，不放宽现有“不静默丢失属性”契约，不增加提权能力；安全方案与原生验证闭合后须另获确认才开放写入。
- Linux 调研边界：本轮仅完成只读架构调研与官方文档核验，未新增检测器、修改生产写入链或执行 Linux 原生测试。当前 PATH 未找到 Docker、Podman、Colima、Lima、Multipass、QEMU 或 Orb，本轮未连接 Linux 验收环境；不据此断言机器上不存在其他环境。任务 4、11、21 及 Linux 写入验收保持未完成。

- 任务 17（第一批）：删除旧 HTTP 前先补有效回归，仅修改三个 TS 测试文件，新增 157 行、29 例。覆盖 settings 完整三元组优先及损坏回退、最新配置重定位与重复应用不写、三元组逐字段冲突、并发新增不丢增量、编辑/删除下标冲突、非法 IPC 输入与磁盘错误脱敏，以及资源目录链接越界和悬空链接拒绝。
- 任务 17（第一批）验证：本批为既有行为补测试，未修改生产代码，不计为新实现的 RED/GREEN。定向 npm test -- server/__tests__/service.test.ts electron/__tests__/configIpc.test.ts electron/__tests__/renderer.test.ts 为 132/132；全量 npm test 为 24 个文件 756/756，无跳过。npm run desktop:typecheck、npm run desktop:build、npm run desktop:test:build、npm run build、git diff --check 及三文件空白检查通过，保留两条既存 Zod 注释警告。
- 任务 17（第一批）边界与审查：主审与安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，无修复增量；建议第二人复核身份冲突、并发新增及资源链接夹具。旧 HTTP 服务、协议测试、启停脚本和领域构建全部保留，删除范围与 diff 仍须另获确认；未启动 Electron、访问系统剪贴板或开放 Linux/Windows 写入，任务 17 保持未勾选。

- 任务 17（第二批）：经完整 diff 确认，删除旧 HTTP 服务、协议测试、启停脚本、三个 mjs 兼容出口、独立领域构建及 serverDomain 聚合入口，共删除 10 个文件。通用 dev/build/preview 指向桌面脚本，根 Vite 配置仅保留测试转换，业务直接导入原有纯函数；同步四份当前文档。记录前本批涉及 21 个文件，新增 130 行、删除 967 行；非文档/测试新增 8 行、删除 429 行，净减少 421 行。
- 任务 17（第二批）验证：先执行 npm test -- electron/__tests__/testing-build.test.ts，得到 1 通过、2 失败，两套构建均因仍含 serverDomain 而触发新增断言；清理后定向 npm test -- electron/__tests__/testing-build.test.ts electron/__tests__/configIpc.test.ts server/__tests__/service.test.ts 为 111/111。全量 npm test 为 23 个文件 694/694，无跳过；减少的 62 例来自删除的旧 HTTP 测试文件，有效业务回归已在第一批迁移。npm run desktop:typecheck、npm run build（调用 desktop:build）、npm run desktop:test:build 通过，保留两条既存 Zod 注释警告。
- 任务 17（第二批）独立性与清理检查：在不含 dist/dist-server/out/out-test 的临时源码副本中，复用已安装 node_modules，重新执行全量测试、类型检查和两套构建均通过，且未生成旧领域或网页产物；这不是重新安装依赖验证。初次空白检查发现五处末尾空行，经单独确认删除后 git diff --check 通过。旧有效导入、脚本和当前使用指引已清零；保留负例、构建排除断言、历史记录及忽略规则中的旧名称，未删除工作目录遗留产物、日志或 pid 文件。
- 任务 17（第二批）审查与边界：两片主审及安全专项均为 Critical 0 / High 0 / Medium 0 / Low 0，审后文件指纹一致，无修复增量；建议第二人复核旧入口删除、构建依赖闭合及错误码过滤。未安装新依赖、启动 Electron、执行启停脚本、访问真实配置或剪贴板，未开放 Linux/Windows 写入。任务 17 的源码清理与验证闭合，其余原生、平台及安装包任务保持未完成。

## 进度记录（2026-11-11）

- 任务 18（打包前置·依赖研究）：在临时解析副本核实 electron-builder 26.18.0 候选，注册表元数据与依赖链（builder → app-builder-lib/@electron/universal）。npm audit 出现 6 项 moderate：同一根源 minimatch GHSA-g3hv-75wg-m249，依赖传播经 app-builder-lib（^10.2.5 → 10.2.6）与 @electron/universal（^9.0.3 → 9.0.9）。审计唯一降级建议（builder 25.1.0，跨主版本）不可机械采用；未执行 audit fix。任务 18 保持未勾选。
- 任务 18（打包前置·兼容评估）：只读核查官方发布包调用的真实 minimatch 用法：app-builder-lib fileMatcher `new Minimatch(pattern,{dot:true})`、filter 读 `.set`/`.match(path, isDir&&!negate)`；@electron/universal `minimatch(path,pattern,{matchBase:true})` 白名单。直接调用均默认 optimizationLevel=1，未进入公告的 firstPhasePreProcess（optimizationLevel>=2）触发路径。差分实测 minimatch 9.0.9/10.2.6 对样例均 false，11.0.1/11.0.5 均 true（`Minimatch('a!(b)*',{dot:true}).match('ab')`、`minimatch('Contents/ab','a!(b)*',{matchBase:true})`），覆盖升级会扩大文件收集或白名单匹配范围，无安全兼容替换。
- 任务 18（打包前置·依赖落地）：经完整 diff 与用户两次确认（暂接收风险落地）：package.json devDependencies 精确新增 `"electron-builder": "26.18.0"`；package-lock.json 采用临时解析副本，新增 269 锁节点、删除 0、既有版本变更 0，与 npm 官方 registry 解析一致。npm test 仍 694/694，npm run desktop:typecheck 与 git diff --check 通过。npm audit 锁定后仍 6 项 moderate（同源传播），已记录并接受，未执行安装脚本或打包。主审通过（Critical 0 / High 0 / Medium 0 / Low 1）：唯一 LOW 为事实性更正，electron-winstaller@5.4.0（builder 的 Windows peer 链）带 `hasInstallScript`，将来 npm install 会触发，本次落地未执行任何安装脚本；任务 18 保持未勾选。
- 任务 18（打包前置·本机目录包配置）：经确认新增 package.json 最小 build 配置并校验合法：`author: "Harllan"`（取 LICENSE 版权署名），`appId: "com.harlan.cc-model-switch"`（用户授权自拟反向域），`files: ["out/**/*"]`、`asar: true`、`asarUnpack: ["node_modules/koffi/**/*","node_modules/@koromix/**/*"]`（Koffi 原生模块出 asar 加载）、`mac: { target: ["dir"], category: "public.app-category.developer-tools" }`（仅本机目录包，不含 DMG）、`directories: { output: "release" }`（限本机目录包生成，三平台安装器另待授权）。用 app-builder-lib 26.18.0 scheme.json 对照字段逐个核验全合法。npm test 仍 694/694、desktop:typecheck 与 diff --check 通过。主审通过（Critical 0 / High 0 / Medium 0 / Low 1）：唯一 LOW 为目录包输出 `release/` 未忽略，经单独确认在 .gitignore 新增 `release/` 修复，diff --check 通过。未真实打包（Electron 二进制仍缺），本批仅核对配置导出，不宣称产物或原生验收；任务 18 保持未勾选。
- 任务 23（移除桌面密码门禁）：经完整 diff 确认，删除 `src/components/Gate.tsx`（90 行）与 `src/lib/authStore.ts`（56 行），`App.tsx` 改为直接渲染 `ModelSwitch`，删除 `components.css` 中 gate-* 样式段（66 行），同步 CLAUDE.md、README、openspec/project.md 与当前 spec（把「页面密码门禁」Requirement 替换为「页面直接进入配置管理」）。验证：npm test 694/694、desktop:typecheck 通过、desktop:test:build 通过，构建产物中 gate-* 样式与「设置访问密码」文案均为 0 命中，`git diff --check` 通过（初次发现 components.css 末尾空行，已单独修正）。隔离入口真实窗口验收（CDP）18 项断言全部通过，其中新增「无密码输入框 count=0」「直接进入配置界面 .page 已渲染」；单实例锁在隔离入口因各进程派生独立 userData 无法验证，明确记为未验证。
- 任务 18（macOS arm64 目录包）+ 任务 3（Koffi 随包）：执行 `npx electron-builder --mac dir`（builder 26.18.0、Electron 45.2.3、arm64）退出 0，产物 `release/mac-arm64/cc-model-switch.app`（271 MB）。校验：`app.asar`（11 MB）与 `app.asar.unpacked/node_modules/koffi`、`app.asar.unpacked/node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node` 存在，`file` 确认 arm64；asar 顶层仅 `out`、`node_modules`、`package.json`，非 node_modules 部分无测试/隔离入口/个人配置泄漏（仅第三方 zod 自带 `.test.ts` 随包，属上游发布内容）。首次打包误用本机 Apple Development 证书（jun wang / Team X36AT7C9SA）签名，经用户确认改为 `mac.identity: null`，重打包日志 `skipped macOS code signing  reason=identity explicitly is set to null`，`codesign -dv` 显示 `Signature=adhoc`，符合提案「首版未签名本地包」。注意：adhoc/linker-signed 的 arm64 包在 Gatekeeper 下仍可能被拒（`spctl` 需另行验证），未宣称可直接分发。
- 任务 3 验证（Koffi 随包加载）：在 cwd=`/private/tmp` 下用包内 Electron（`ELECTRON_RUN_AS_NODE=1`）加载 `app.asar.unpacked/node_modules/koffi`，调用 `/usr/lib/libSystem.B.dylib` 的 `getpid` 返回当前 pid，退出码 0；证明不依赖仓库 node_modules、不依赖仓库 cwd。首个被打包的产物曾含旧门禁代码（构建产物在移除门禁前生成），已重新 `npm run desktop:build` 并重打包，包内 renderer 现为 `index-9xtzW3VE.js` / `index-B85gpxBc.css`，`设置访问密码`/`cccfg.auth` 命中 0。
- 任务 18（非仓库工作目录启动）：在 `/tmp` 直接执行 `release/mac-arm64/cc-model-switch.app/Contents/MacOS/cc-model-switch`，进程存活 6–7 秒，终止后无残留进程；未签名包启动未崩溃。该项仅证明进程可启动，未验证窗口渲染与业务操作（窗口级验收走隔离入口 CDP）。
- 任务 13/14/15/16（部分，macOS arm64 真实窗口）：新增 `electron/__tests__/native-acceptance.mjs`（零依赖 CDP 驱动，驱动 `out-test/main/index.js` 隔离入口，隔离 home 由入口自建并通过 stderr 打印）。24 项断言全通过：受限协议初始 URL、`window.desktop` 仅 platform/config/clipboard 三键、`platform=darwin`、无 `require`/`process` 泄漏、无密码输入框、`.page` 直接渲染、受限协议越界被明确拒绝（网络错误或 >=400，超时不算通过）、对外导航被拒（location 不变）、state 成功、settings 三元组优先、add 成功且 entries=2、settings 未被修改（READ_ONLY）、apply 成功、zshrc 写入 `export ANTHROPIC_MODEL=m2`、缺 config → FILE_MISSING、坏 config → INVALID_CONFIG、额外字段 → INVALID_REQUEST、超 64 KiB → BODY_TOO_LARGE、窗口内可对允许跨源的 HTTP 端点测速（本地临时 loopback，200/3ms）、非 HTTP(S)（file:）被拒、无 CORS 头的目标测速降级为失败而非崩溃。剪贴板原生验收按用户要求排除。单实例锁与重激活因隔离入口使用独立 userData/window 无法验证，明确未验证。任务 13/14/15/16 整体仍未勾选（缺重激活、剪贴板、Windows 等）。

- 任务 22（文档同步，部分）：经确认同步 README.md、CLAUDE.md、openspec/project.md 的验收状态：删除「Electron 二进制下载失败」「Koffi 仅完成宿主前置验证」等过期表述，写入 macOS arm64 已完成的真实窗口（隔离入口 CDP 24 项）、目录包构建、Koffi 随包加载与非仓库 cwd 启动；同时保留未签名 Gatekeeper、x64、Windows/Ubuntu、安装器、剪贴板原生与单实例锁的未验收声明。npm test 694/694、git diff --check 通过（纯文档）。独立审查（第二审查人）与最终验收确认尚未进行，任务 22 保持未勾选。

- 修复（真实 xattr 写入被拒）：用户新增模型写入 `~/change-ai-config.json` 时报「文件包含无法可靠保留的特殊元数据。」根因为 `server/metadata.ts` 旧实现「任何 xattr 存在即拒」，而 macOS 真实 config 常带 5 个良性 xattr（TextEncoding/lastuseddate/kMDItemWhereFroms/kMDLabel/quarantine）。经完整 diff 确认，重写为「捕获可保留 xattr（名称+十六进制值）→ 写入临时新 inode → 复制并核对 → rename 后逐项核对未被丢弃」；ACL、flags、异常权限仍拒绝，守住不静默丢失属性契约。`server/files.ts` replaceFile 在 chmod 后捕获 ready 前 applyXattrs/verifyXattrs（避免 mtime 干扰），rename 后在 WRITE_UNCERTAIN 判定前 verifyXattrs。测试原「拒绝真实 xattr」改为「保留单 xattr 并写新内容」「保留多 xattr 二进制值与含空格值」。验证：TDD 先两条 xattr 用例失败（METADATA_UNSUPPORTED），实现后 files.test 26/26、全量 npm test 695/695、desktop:typecheck 通过。CR：采用独立审查，Critical 0 / High 0 / Medium 0 / Low 3（并发新增 xattr 非 CAS 竞态窗口内静默丢失、系统自动盖章属性可能整体拒写、发布后瞬时读失败映射 WRITE_UNCERTAIN），用户选择全部不修，均与既有非 CAS 竞态同档、不破坏安全契约。

## 任务
- [x] 1. 锁定桌面依赖与构建入口：核对兼容性、许可、漏洞及预构建支持；验证最小 TS 主进程和 preload 的类型检查与构建。（macOS arm64；Electron 45.2.3、electron-vite 6.0.0、electron-builder 26.18.0 已锁定并构建通过）
- [x] 2. 建立隔离测试入口：固定测试专用临时 home/userData/注册表根，生产入口不能接受这些覆盖；测试越权注入被拒绝。（真实窗口经 out-test 隔离入口启动验收）
- [x] 3. 验证 Koffi 随包加载：先构建目录包，逐目标架构执行无副作用原生调用；记录成功或环境阻塞。（macOS arm64 目录包内加载 koffi 并调用系统函数成功；其他架构见 platform-native-acceptance）
- [x] 4. 实现 Linux 元数据检测：用真实临时文件覆盖普通属性、xattr、ACL、flags、检测失败及不支持文件系统。（拆至 platform-native-acceptance：安全方案未闭合，写入保持关闭）
- [x] 5. 实现 Windows 注册表读取与快照：在隔离键验证七键、缺失值、值类型、Unicode 和权限错误，不读取真实用户环境。（拆至 platform-native-acceptance）
- [x] 6. 实现 Windows 七键提交：逐写入阶段注入失败，验证部分写入、回读失败、flush、通知失败及不自动回滚。（拆至 platform-native-acceptance）
- [x] 7. 实现 Windows 文件安全检查：真实 NTFS 测试 owner/DACL、reparse point、硬链接、数据流、特殊属性及文件占用。（拆至 platform-native-acceptance）
- [x] 8. 实现 Windows 安全文件替换：验证临时文件访问权限、替换前冲突、元数据保持、失败后状态与清理，不承诺 POSIX 目录同步语义。（拆至 platform-native-acceptance）
- [x] 9. 迁移共享文件层与 macOS 检测至 TS：现有真实 IO 回归通过，保持无变化不写、依赖复核及 WRITE_UNCERTAIN 语义。
- [x] 10. 迁移业务服务与共享契约至 TS：验证 settings 优先、三元组与原下标定位、未知字段和序列化兼容。
- [x] 11. 集成 Linux 激活目标：验证账户登录 shell 到 bash/zsh 文件映射、其他 shell 拒绝、缺文件反馈与七键转义。（拆至 platform-native-acceptance）
- [x] 12. 集成 Windows 存储：临时配置与隔离注册表联合验证 CRUD、切换、settings 遮蔽及部分写入结果。（拆至 platform-native-acceptance）
- [x] 13. 实现 Electron 窗口与资源边界：验证单实例、退出与重新激活、生产资源路径、CSP、导航及新窗口拒绝。（arm64 真实窗口验证协议/CSP/导航；单实例与重激活见 platform-native-acceptance）
- [x] 14. 实现 preload 与 IPC：验证可信窗口/主 frame/origin、严格 schema、额外字段、载荷限制、错误脱敏及有限队列。（arm64 真实窗口验收）
- [x] 15. 替换页面客户端与状态反馈：测试固定桥接调用、平台写入文案、写后刷新失败、不重放和滚动保持。（arm64 真实窗口验收）
- [x] 16. 适配剪贴板与测速：验证只写剪贴板、Windows PowerShell 转义、HTTP(S) 限制及失败反馈，不新增主进程 URL 代理。（测速已在真实窗口验证；剪贴板原生写入见 platform-native-acceptance）
- [x] 17. 删除旧网页专属入口：删除 HTTP 服务、旧协议测试、服务脚本和独立领域构建；迁移有效业务测试后确认零引用并通过全量检查。
- [x] 18. 配置三平台安装包：检查产物白名单、原生模块加载、非仓库工作目录启动，排除测试数据、配置密钥和日志。（macOS arm64 目录包已验证；DMG/NSIS/AppImage 见 platform-native-acceptance）
- [x] 19. 执行 macOS 原生验收：分别记录 arm64/x64 的目录包、DMG、CRUD、切换、错误恢复与 settings 不变证据。（arm64 已完成 24 项真实窗口断言；x64 见 platform-native-acceptance）
- [x] 20. 执行 Windows 原生验收：非管理员隔离账户验证 NSIS、真实文件权限、用户环境持久化、部分失败和应用重启。（拆至 platform-native-acceptance）
- [x] 21. 执行 Ubuntu 原生验收：22.04/24.04 x64 验证 AppImage、bash/zsh 与元数据拒写；不预装额外检测工具。（拆至 platform-native-acceptance）
- [x] 22. 同步文档并完成独立审查：核对实际开发/构建命令、平台限制和安全边界；按确认项修复并提供验证证据。（文档已同步；全量 diff 独立审查拆至 platform-native-acceptance）
- [x] 23. 移除桌面密码门禁：删除 `Gate` 组件、`authStore` 及其本地/会话存储键和门禁样式，`App.tsx` 直接渲染 `ModelSwitch`；同步 CLAUDE.md、README、project.md 与当前 spec 的门禁描述。验证：页面加载即进入配置界面、无密码输入框、仓库无 authStore/Gate 引用；npm test、desktop:typecheck 与构建通过。

## 验收标准
- [x] 在当前仓库交付 Electron 桌面应用，应用与测试源码采用 TS，不保留独立配置 HTTP 服务。
- [x] 原有主要界面能力可用，renderer 无 Node/任意 IPC/任意文件或命令执行能力。（macOS arm64 真实窗口 24 项断言）
- [x] 配置增删改仅写固定 config；settings 内容保持不变，激活态优先级与现有规则一致。
- [x] macOS、Linux、Windows 分别写入已确认目标，不执行配置、不修改其他 shell profile。（macOS 写入已验证；Linux/Windows 拆至 platform-native-acceptance，保持写入关闭）
- [x] Linux 元数据检测无需用户另装工具；不支持情况安全拒写，Windows 文件权限及安全属性不被静默丢失。（Linux 拆至 platform-native-acceptance，写入关闭）
- [x] Windows 七键非原子写入的部分失败与通知失败被准确表达，不自动重放或盲目回滚。（拆至 platform-native-acceptance）
- [x] 类型检查、领域回归、存储集成、IPC 对抗及真实 Electron 关键流程测试提供实际结果。（npm test 695/695、desktop:typecheck、desktop:test:build、真实窗口 24 项）
- [x] 支持矩阵中的各平台及架构均有对应原生验收证据；缺少环境的项目保持未完成，不以 mock 代替。（macOS arm64 已完成；其余拆至 platform-native-acceptance 并保持未完成）
- [x] 安装包可在对应系统启动，未签名限制已说明，不携带个人配置或测试秘密。（macOS arm64 目录包；DMG/NSIS/AppImage 拆至 platform-native-acceptance）
- [x] 用户确认验收且独立审查完成后才允许归档；提交和发布另行授权。（用户于 2026-11-11 确认手动验收通过，并确认按平台拆分后归档）
