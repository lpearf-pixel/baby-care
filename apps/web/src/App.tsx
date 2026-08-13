import { useEffect, useState } from 'react';
import { BabyCareApiError, babyCareApi, type BabyCareApi } from './api-client.js';
import { AuthenticatedShell } from './auth/AuthenticatedShell.js';
import { LoginScreen } from './auth/LoginScreen.js';
import { SetupScreen } from './auth/SetupScreen.js';
import type { AppState } from './auth/types.js';
import './app.css';

function errorCode(error: unknown): string | undefined {
  if (error instanceof BabyCareApiError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '');
  }
  return undefined;
}

export interface AppProps {
  api?: BabyCareApi;
}

export function App({ api = babyCareApi }: AppProps) {
  const [state, setState] = useState<AppState>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void api.getSetupStatus()
      .then(async ({ required }) => {
        if (!active) return;
        if (required) {
          setState({ kind: 'setup-required' });
          return;
        }
        try {
          const session = await api.getSession();
          if (active) setState({ kind: 'authenticated', session });
        } catch (sessionError) {
          if (!active) return;
          if (errorCode(sessionError) === 'unauthenticated') setState({ kind: 'login' });
          else setState({ kind: 'degraded' });
        }
      })
      .catch(() => {
        if (active) setState({ kind: 'degraded' });
      });

    return () => {
      active = false;
    };
  }, [api]);

  async function handleSetup(input: Parameters<BabyCareApi['setupFamily']>[0], setupToken: string) {
    setBusy(true);
    setError(null);
    try {
      await api.setupFamily(input, setupToken);
      setState({ kind: 'login' });
    } catch (setupError) {
      setError(errorCode(setupError) === 'setup_token_invalid' ? 'Setup Token 不正确' : '初始化失败，请检查信息后重试');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(loginName: string, passphrase: string) {
    setBusy(true);
    setError(null);
    try {
      const session = await api.login(loginName, passphrase);
      setState({ kind: 'authenticated', session });
    } catch {
      setError('登录名或密码不正确');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      setError(null);
      setBusy(false);
      setState({ kind: 'login' });
    }
  }

  const babyName = state.kind === 'authenticated' ? state.session.babyDisplayName : 'xiangxiang';

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="product-title">
        <p className="eyebrow">Birth Ready · Family Workspace</p>
        <h1 id="product-title">Baby Care</h1>
        <p className="subtitle">{babyName} 的家庭护理工作台</p>
      </section>

      {state.kind === 'checking' ? (
        <section className="panel" aria-live="polite"><p>正在检查家庭工作台…</p></section>
      ) : null}

      {state.kind === 'degraded' ? (
        <section className="panel" aria-live="polite">
          <h2>服务暂不可用</h2>
          <p className="muted">家庭资料没有丢失，请稍后刷新重试。</p>
        </section>
      ) : null}

      {state.kind === 'setup-required' ? (
        <SetupScreen busy={busy} error={error} onSetup={handleSetup} />
      ) : null}

      {state.kind === 'login' ? (
        <LoginScreen busy={busy} error={error} onLogin={handleLogin} />
      ) : null}

      {state.kind === 'authenticated' ? (
        <AuthenticatedShell api={api} session={state.session} onLogout={handleLogout} />
      ) : null}

      <p className="foundation-note">
        M1 只启用家庭身份、权限和基础资料。护理记录将在真实家庭习惯确认后进入下一阶段。
      </p>
    </main>
  );
}
