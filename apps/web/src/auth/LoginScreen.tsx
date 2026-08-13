import { useState, type FormEvent } from 'react';

export function LoginScreen(props: {
  busy: boolean;
  error: string | null;
  onLogin: (loginName: string, passphrase: string) => Promise<void>;
}) {
  const [loginName, setLoginName] = useState('');
  const [passphrase, setPassphrase] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.onLogin(loginName, passphrase);
  }

  return (
    <section className="panel auth-panel" aria-labelledby="login-title">
      <p className="eyebrow">家庭成员</p>
      <h2 id="login-title">登录 Baby Care</h2>
      <p className="muted">Dad、Mom、Nanny 使用各自账号，操作会保留明确归属。</p>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label className="full-width">
          登录名
          <input value={loginName} onChange={(event) => setLoginName(event.target.value)} autoComplete="username" required />
        </label>
        <label className="full-width">
          密码
          <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="current-password" required />
        </label>
        {props.error ? <p className="form-error full-width" role="alert">{props.error}</p> : null}
        <button className="primary full-width" type="submit" disabled={props.busy}>{props.busy ? '正在登录…' : '登录'}</button>
      </form>
    </section>
  );
}
