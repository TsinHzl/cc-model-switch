#!/usr/bin/env node
// native-acceptance.mjs —— macOS arm64 隔离入口真实验收驱动（零依赖，仅 Node 内置）
// 用途：驱动 out-test/main/index.js（隔离 home），经 CDP 核验真实窗口/协议/CSP/桥接/IPC。
// 不触碰真实 ~/.claude、~/.zshrc、~/change-ai-config.json；剪贴板原生验收不在本脚本范围。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, '../..');
const electronBin = join(repoRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const outTestMain = join(repoRoot, 'out-test/main/index.js');

const pass = [];
const fail = [];
function assert(name, cond, detail = '') {
  (cond ? pass : fail).push(name + (detail ? ` —— ${detail}` : ''));
}

function parseIsolatedRoot(stderr) {
  const m = /隔离测试目录：\s*(\S+)/.exec(stderr);
  return m ? m[1] : null;
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this._wire(); }
  _wire() {
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      // 兜底超时，避免某条 CDP 消息永不返回导致卡片
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)); } }, 8000);
    });
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res?.exceptionDetails) throw new Error('evaluate exception: ' + JSON.stringify(res.exceptionDetails));
    return res?.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findPageTarget(port, title, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json`);
      const page = list.find(t => t.type === 'page' && t.title === title);
      if (page) return page;
    } catch {}
    await wait(400);
  }
  throw new Error(`未找到页面目标(title=${title})`);
}

async function waitReady(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await fetchJson(`http://127.0.0.1:${port}/json`); return; } catch {}
    await wait(300);
  }
  throw new Error('CDP 端口未就绪');
}

// —— IPC 五方法夹具在隔离 home 内实时构造，驱动从不编排真实个人文件 ——
function configFile(root, body) {
  const d = join(root, '.claude');
  mkdirSync(d, { recursive: true });
  const p = join(root, 'change-ai-config.json');
  writeFileSync(p, body);
  return p;
}

async function main() {
  // 隔离入口由 createTestResources() 自建临时根并打印 `隔离测试目录：<root>`；文件须布置到 <root>/home
  const isolatedTmp = mkdtempSync(join(tmpdir(), 'ccms-native-acc-'));
  let homeRoot = null;
  let zshrcPath = null;
  let configPath = null;

  const port = 9400 + Math.floor(Math.random() * 400);

  // spawn 隔离入口（传 --remote-debugging-port，不在守卫黑名单；守卫只拒 packaged/ready/三个路径switch/ELECTRON_LOG_FILE）
  const child = spawn(electronBin, ['--remote-debugging-port=' + port, outTestMain], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrBuf = '';
  child.stderr.on('data', d => { stderrBuf += d.toString(); });
  child.on('exit', (code, sig) => { console.error(`[child exit] code=${code} sig=${sig}`); });

  let ws = null;
  try {
    console.error('\n[步骤] 解析隔离根并布置三文件');
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const m = /隔离测试目录：\s*(\S+)/.exec(stderrBuf);
      if (m) { homeRoot = join(m[1], 'home'); break; }
      await wait(200);
    }
    if (!homeRoot) throw new Error('未解析到隔离测试目录');
    mkdirSync(join(homeRoot, '.claude'), { recursive: true });
    const settingsPath = join(homeRoot, '.claude', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      env: { ANTHROPIC_MODEL: 'model-from-settings', ANTHROPIC_BASE_URL: 'https://s', ANTHROPIC_AUTH_TOKEN: 'k-s' },
    }, null, 2));
    const cfgBody = JSON.stringify([{ base_url: 'https://s', model: 'model-from-settings', key: 'k-s', channel: '' }], null, 2);
    configPath = join(homeRoot, 'change-ai-config.json');
    writeFileSync(configPath, cfgBody);
    zshrcPath = join(homeRoot, '.zshrc');
    writeFileSync(zshrcPath, '# >>> change-ai-config >>>\nexport ANTHROPIC_MODEL="model-from-zshrc"\n# <<< change-ai-config <<<\n');

    await waitReady(port);
    console.error('\n[步骤] 连接页面目标');
    const page = await findPageTarget(port, 'CC Config 控制台');
    // DevTools 层直接拿到真实 ws（ws://127.0.0.1:<真实端口>/devtools/page/...）
    ws = new WebSocket(page.webSocketDebuggerUrl);
    const cdp = new CdpClient(ws);
    await new Promise(res => ws.addEventListener('open', res));
    console.error('\n[步骤] H4 窗口/协议/CSP/桥接');

    assert('初始 URL 为受限协议', page.url === 'cc-model-switch://app/index.html', page.url);
    const keys = await cdp.evaluate(`Object.keys(window.desktop).sort().join(',')`);
    assert('window.desktop 仅四键', keys === 'chat,clipboard,config,platform', keys);
    assert('platform 为 darwin', await cdp.evaluate(`window.desktop.platform`) === 'darwin');
    assert('无 node 泄漏 (require undefined)', await cdp.evaluate(`typeof window.require`) === 'undefined');
    assert('无 node 泄漏 (process undefined)', await cdp.evaluate(`typeof window.process`) === 'undefined');
    // 密码门禁已移除：窗口打开即直接进入配置页（.page 容器），且页面不含密码输入框
    const pwInputs = await cdp.evaluate(`document.querySelectorAll('input[type="password"]').length`);
    assert('无密码输入框（门禁已移除）', pwInputs === 0, `count=${pwInputs}`);
    const hasPage = await cdp.evaluate(`!!document.querySelector('.page')`);
    assert('直接进入配置界面(.page 已渲染)', hasPage === true);

    // —— 对话页页签切换与空状态 ——
    const tabClick = await cdp.evaluate(`(() => {
      const btns = document.querySelectorAll('nav.tabs .tab');
      for (const b of btns) if (b.textContent.includes('对话')) { b.click(); return 'clicked'; }
      return 'not-found';
    })()`);
    await wait(400);
    const chatPage = await cdp.evaluate(`!!document.querySelector('.chat-page')`);
    assert('点击对话页签出现对话页', tabClick === 'clicked' && chatPage === true, tabClick);
    // 对话页应自行读到隔离 home 已布置的配置（model-from-settings），
    // 模型下拉不能显示「无可用模型」——这正是对话页首次接入时漏读配置的回归点。
    await wait(600);
    const chatEmpty = await cdp.evaluate(`document.querySelector('.chat-empty')?.textContent ?? ''`);
    const modelSelect = await cdp.evaluate(`(() => {
      const opts = document.querySelectorAll('.composer-model select option');
      return Array.from(opts).map(o => o.textContent).join('|');
    })()`);
    assert('对话页读到配置模型（非无可用模型）', chatEmpty.includes('选择模型后发送消息'), chatEmpty || '无空状态');
    assert('模型下拉含配置条目', String(modelSelect).includes('model-from-settings'), String(modelSelect));
    // 修复回归：optgroup 不能嵌套（Chromium 丢弃内层 option）。断言模型 option 直接挂在
    // select 的 optgroup 下，且 optgroup 本身不是 select 的直接子节点中嵌套的。
    const modelOptCount = await cdp.evaluate(`(() => {
      const sel = document.querySelector('.composer-model select');
      const opts = sel ? Array.from(sel.querySelectorAll(':scope > optgroup option')) : [];
      return { count: opts.length, html: opts.map(o => o.value).join(',') };
    })()`);
    assert('模型 option 为 select 直接后代 optgroup 的子节点', modelOptCount && modelOptCount.count === 1 && modelOptCount.html === 'model-from-settings:https://s', JSON.stringify(modelOptCount));
    // 滚动隔离：根容器不整页滚动，仅 .chat-messages 是对话滚动容器。
    const scrollIsolation = await cdp.evaluate(`(() => {
      const root = document.getElementById('root');
      const chatPage = document.querySelector('.chat-page');
      const messages = document.querySelector('.chat-messages');
      const cs = (el) => el ? getComputedStyle(el).overflowY : '';
      const isScrollable = (el) => el ? cs(el) === 'auto' || cs(el) === 'scroll' : false;
      return {
        body: cs(document.body),
        root: cs(root),
        chatPage: cs(chatPage),
        messages: cs(messages),
        messagesScrollTarget: isScrollable(messages),
      };
    })()`);
    assert('根容器不整页滚动(overflow hidden)', scrollIsolation && scrollIsolation.root === 'hidden' && (scrollIsolation.body === 'visible' || scrollIsolation.body === 'hidden'), JSON.stringify(scrollIsolation));
    // 仅 .chat-messages 是对话滚动容器；body / root / chat-page 都不是滚动目标。
    assert('对话页滚动容器为 .chat-messages(overflow auto)', scrollIsolation && scrollIsolation.messagesScrollTarget && !(scrollIsolation.messages === 'hidden' || scrollIsolation.chatPage === 'auto' || scrollIsolation.chatPage === 'scroll' || scrollIsolation.root === 'auto' || scrollIsolation.root === 'scroll'), JSON.stringify(scrollIsolation));

    // —— 对话 IPC：额外字段 / 超限被拒（不发真实网络请求）——
    const chatStart = await cdp.evaluate(`window.desktop.chat.start({ model: 'x', base_url: 'https://example.invalid', messages: [{ role: 'user', content: 'hi' }], effort: 'off', webSearch: false, key: 'leak' })`);
    assert('chat:start 携带密钥字段被拒', chatStart && chatStart.success === false && chatStart.code === 'INVALID_REQUEST', chatStart?.code);
    const chatUnknown = await cdp.evaluate(`window.desktop.chat.start({ model: 'no-such', base_url: 'https://example.invalid', messages: [{ role: 'user', content: 'hi' }], effort: 'off', webSearch: false })`);
    assert('chat:start 未配置三元组被拒', chatUnknown && chatUnknown.success === false && chatUnknown.code === 'UNKNOWN_ENTRY', chatUnknown?.code);
    // 切回配置页，验证零回归
    const backToConfig = await cdp.evaluate(`(() => {
      const btns = document.querySelectorAll('nav.tabs .tab');
      for (const b of btns) if (b.textContent.includes('模型切换')) { b.click(); return true; }
      return false;
    })()`);
    await wait(300);
    assert('切回配置页仍在渲染', backToConfig === true && await cdp.evaluate(`!!document.querySelector('.page')`), String(backToConfig));

    // 受限协议越界路径：真正被拦只应表现为协议处理拒绝（fetch 抛网络错误）。
    // 超时不算通过（可能是 CSP 挂起而非拒绝），4xx/5xx 与 err 才是明确拒绝；2xx 视为放行＝失败。
    await cdp.send('Runtime.evaluate', { expression: `undefined`, returnByValue: true }); // warm
    const badProbe = await cdp.evaluate(
      `(async () => {
        try {
          const r = await Promise.race([
            fetch('cc-model-switch://app/../escape').then(res => 'status:' + res.status),
            new Promise(res => setTimeout(() => res('timeout'), 2000)),
          ]);
          return 'probe:' + r;
        } catch {
          return 'probe:err';
        }
      })()`,
    );
    const probeValue = String(badProbe);
    const probeStatus = /^probe:status:(\d+)$/.exec(probeValue);
    const blocked = probeValue === 'probe:err'
      || (probeStatus !== null && Number(probeStatus[1]) >= 400);
    assert('受限协议越界路径被明确拒绝(网络错误或>=400)', blocked, probeValue);

    // 导航/新窗口拒绝（真实 webContents）：仍由 will-navigate / setWindowOpenHandler 拦截
    const before = await cdp.evaluate(`location.href`);
    await cdp.evaluate(`try { location.href = 'https://example.invalid/'; } catch (_) {}`);
    await wait(500);
    const after = await cdp.evaluate(`location.href`);
    assert('对外导航被拒(location 不变)', after === before, `${before} → ${after}`);

    // —— H5 隔离 home 业务/CRUD/切换/错误 ——
    // settings 优先：state() 成功返回 .data.entries 与 .data.activeIndex
    const st = await cdp.evaluate(`window.desktop.config.state({})`);
    const stData = st && st.success === true ? (st.data || st) : null;
    assert('state 返回成功', st && st.success === true, JSON.stringify(st && { keys: st.data && st.data.entries && st.data.entries.length }));
    assert('settings 优先识别激活', stData && stData.entries[stData.activeIndex]?.model === 'model-from-settings',
      JSON.stringify(stData && { entries: stData.entries, active: stData.activeIndex }));

    // CRUD 只写 config：add —— addSchema=POST=strictObject({entry})，无 expected 字段
    const add = await cdp.evaluate(`window.desktop.config.add({ entry: { base_url: 'https://b', model: 'm2', key: 'k2', channel: 'c2' } })`);
    assert('add 成功', add && add.success === true);
    const st2 = await cdp.evaluate(`window.desktop.config.state({})`);
    const st2Data = st2 && st2.success === true ? (st2.data || st2) : null;
    assert('add 后 entries 增为 2', st2Data && st2Data.entries.length === 2, `len=${st2Data && st2Data.entries.length}`);
    const st2Model = st2Data && st2Data.entries[1].model;
    assert('add 条目内容正确', st2Model === 'm2', st2Model);
    assert('settings 未被修改（READ_ONLY）', readFileSync(settingsPath, 'utf8').includes('model-from-settings'));

    // await apply：切换写 zshrc，但仅写 zshrc，settings 不变
    const apply = await cdp.evaluate(`window.desktop.config.apply({ expected: { model: 'm2', base_url: 'https://b', key: 'k2' } })`);
    assert('apply 成功', apply && apply.success === true);
    const zshrc = readFileSync(zshrcPath, 'utf8');
    // shellQuote 对安全字符不添加引号，实际输出形如 `export ANTHROPIC_MODEL=m2`
    assert('zshrc 写入新块', /^export ANTHROPIC_MODEL=m2$/m.test(zshrc), zshrc.split('\n').find(l => l.includes('ANTHROPIC_MODEL')) || '');

    // 错误恢复：delete config → FILE_MISSING
    const savedConfig = readFileSync(configPath, 'utf8');
    rmSync(configPath);
    const miss = await cdp.evaluate(`window.desktop.config.state({})`);
    assert('缺 config → 有限错误', miss && miss.success === false && typeof miss.code === 'string', miss?.code);

    // 坏 config → INVALID_CONFIG
    writeFileSync(configPath, '{ this is not valid json');
    const bad = await cdp.evaluate(`window.desktop.config.state({})`);
    assert('坏 config → INVALID_CONFIG', bad && bad.success === false && bad.code === 'INVALID_CONFIG', bad?.code);
    writeFileSync(configPath, savedConfig);

    // 额外字段 → INVALID_REQUEST（严格 schema）
    const extra = await cdp.evaluate(`window.desktop.config.state({ unexpected: 1 })`);
    assert('额外字段 → INVALID_REQUEST', extra && extra.success === false && extra.code === 'INVALID_REQUEST', extra?.code);

    // 超预算请求 → BODY_TOO_LARGE（64 KiB 紧凑 JSON 预算）
    const oversized = await cdp.evaluate(
      `window.desktop.config.add({ entry: { base_url: 'https://x', model: 'm', key: '${'k'.repeat(70000)}', channel: '' } })`,
    );
    assert('超 64KiB → BODY_TOO_LARGE', oversized && oversized.success === false && oversized.code === 'BODY_TOO_LARGE', oversized?.code);

    // 测速前提：窗口内能对真实 HTTP 端点发起请求并得到时延（CSP connect-src 允许 http:）
    // 仅起本次进程内临时 loopback 服务器，不访问外网、不携带配置密钥。
    const http = await import('node:http');
    // 带 CORS 头的临时 loopback 端点：模拟允许跨源读取的测速目标
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
      res.end('ok');
    });
    // 不带 CORS 且 302 跳转的端点：模拟要求登录的普通网关
    const noCors = http.createServer((req, res) => {
      if (req.url === '/gw') {
        res.writeHead(302, { Location: '/ok' });
        return res.end();
      }
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    await new Promise(res => noCors.listen(0, '127.0.0.1', res));
    const probePort = server.address().port;
    const noCorsPort = noCors.address().port;
    const latency = await cdp.evaluate(
      `(async () => {
        const t0 = performance.now();
        const r = await fetch('http://127.0.0.1:${probePort}/ping', {
          method: 'HEAD', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        });
        const ms = Math.round(performance.now() - t0);
        // 测速实际使用的模式：no-cors + 跟随重定向，无 CORS 头的 302 网关也应可测。
        let noCorsOk = false;
        try {
          await fetch('http://127.0.0.1:${noCorsPort}/gw', {
            method: 'HEAD', mode: 'no-cors', redirect: 'follow', credentials: 'omit',
          });
          noCorsOk = true;
        } catch {}
        let fileBlocked = false;
        try { await fetch('file:///etc/passwd'); } catch { fileBlocked = true; }
        return { status: r.status, ms, noCorsOk, fileBlocked };
      })()`,
    );
    await new Promise(res => server.close(res));
    await new Promise(res => noCors.close(res));
    assert('窗口内可对允许跨源的 HTTP 端点测速', latency && latency.status === 200 && Number.isFinite(latency.ms), JSON.stringify(latency));
    assert('非 HTTP(S) 目标被拒(file:)', latency && latency.fileBlocked === true, JSON.stringify(latency));
    // 无 CORS 头的网关在 no-cors 模式下不可读响应体，但仍能测到时延。
    assert('无 CORS 且 302 的网关可测速', latency && latency.noCorsOk === true, JSON.stringify(latency));

    // 单实例锁：隔离入口为每个进程派生独立 userData，锁键不同路径，无法互斥。
    // 因此这里不把它们当作失败，只记录“未验证”，真实单实例需同一 userData 场景另行验收。
    console.error('[未验证] 单实例锁：隔离入口使用不同 userData，无法在此场景验证');

    cdp.close();
  } finally {
    try { ws?.close(); } catch {}
    child.kill('SIGTERM');
    await wait(300);
    try { rmSync(isolatedTmp, { recursive: true, force: true }); } catch {}
  }

  // —— 结果汇总 ——
  console.log('\n===== 原生验收结果 =====');
  const seen = new Set();
  for (const p of pass) if (!seen.has(p)) { seen.add(p); console.log('PASS: ' + p); }
  for (const f of fail) console.log('FAIL: ' + f);
  console.log(`\n通过 ${pass.length} / 失败 ${fail.length}`);
  if (fail.length) process.exit(1);
}

main().catch(e => { console.error('\n启动/驱动失败:', e.message); console.error(e.stack); process.exit(1); });