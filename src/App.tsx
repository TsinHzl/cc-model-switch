import Gate from './components/Gate';
import ModelSwitch from './components/ModelSwitch';
import { detectEnvironment } from './lib/fsaTypes';

const env = detectEnvironment();

export default function App() {
  // 非 secure context / 浏览器不支持：显示对应说明页（在密码门禁之前）
  if (!env.ok) {
    return (
      <main className="gate-main">
        <div className="gate-card">
          <div className="gate-icon" aria-hidden>
            ⚠️
          </div>
          <h1>浏览器环境不支持</h1>
          <p className="gate-hint">
            {env.reason === 'insecure'
              ? '当前页面不是安全上下文（HTTPS / localhost），浏览器禁止访问本地文件与加密 API。'
              : '当前浏览器不支持 File System Access API。'}
          </p>
          <p className="gate-hint">
            {env.reason === 'insecure'
              ? '请通过 SSH 隧道访问：ssh -L 15858:127.0.0.1:15858 <服务器>，然后打开 http://localhost:15858'
              : '请使用 Chrome / Edge（桌面版）打开本页面。'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <Gate>
      <ModelSwitch />
    </Gate>
  );
}
