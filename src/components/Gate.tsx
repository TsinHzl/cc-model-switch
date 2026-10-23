/* 密码门禁组件：首次设置（二次确认）/ 登录 / 会话内免重输 */
import { useCallback, useEffect, useState } from 'react';
import { hasPassword, isUnlocked, markUnlocked, setPassword, verifyPassword } from '../lib/authStore';

type GateMode = 'loading' | 'setup' | 'login' | 'passed';

export default function Gate({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<GateMode>('loading');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(!hasPassword() ? 'setup' : isUnlocked() ? 'passed' : 'login');
  }, []);

  const submitSetup = useCallback(async () => {
    setBusy(true);
    setError('');
    const r = await setPassword(pw, pw2);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? '设置失败');
      return;
    }
    setMode('passed');
  }, [pw, pw2]);

  const submitLogin = useCallback(async () => {
    setBusy(true);
    setError('');
    const ok = await verifyPassword(pw);
    setBusy(false);
    if (!ok) {
      setError('密码错误');
      setPw('');
      return;
    }
    markUnlocked();
    setMode('passed');
  }, [pw]);

  if (mode === 'passed') return <>{children}</>;

  return (
    <main className="gate-main">
      <form
        className="gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) (mode === 'setup' ? submitSetup : submitLogin)();
        }}
      >
        <div className="gate-icon" aria-hidden>
          🔒
        </div>
        <h1>{mode === 'setup' ? '设置访问密码' : 'CC Config 控制台'}</h1>
        <p className="gate-hint">
          {mode === 'setup'
            ? '配置文件包含大量 API key，首次使用请设置访问密码（仅防误触，存储于本浏览器）'
            : '会话已锁定，请输入密码继续'}
        </p>
        <input
          type="password"
          autoFocus
          placeholder="密码"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {mode === 'setup' && (
          <input
            type="password"
            placeholder="再次输入密码"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
        )}
        {error && (
          <p className="gate-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || pw.length === 0}>
          {mode === 'setup' ? '设置并进入' : '解锁'}
        </button>
      </form>
    </main>
  );
}
