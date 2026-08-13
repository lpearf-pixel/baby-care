import { useState, type FormEvent } from 'react';
import type { SetupInput } from '@baby-care/contracts';

export function SetupScreen({
  busy,
  error,
  onSetup,
}: {
  busy: boolean;
  error: string | null;
  onSetup: (input: SetupInput, setupToken: string) => Promise<void>;
}) {
  const [familyName, setFamilyName] = useState('Xiangxiang Family');
  const [babyDisplayName, setBabyDisplayName] = useState('xiangxiang');
  const [dadLogin, setDadLogin] = useState('dad');
  const [dadPassword, setDadPassword] = useState('');
  const [momLogin, setMomLogin] = useState('mom');
  const [momPassword, setMomPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSetup(
      {
        familyName,
        babyDisplayName,
        dad: { loginName: dadLogin, password: dadPassword },
        mom: { loginName: momLogin, password: momPassword },
      },
      setupToken,
    );
  }

  return (
    <section className="panel auth-panel" aria-labelledby="setup-title">
      <p className="eyebrow">首次使用</p>
      <h2 id="setup-title">初始化家庭</h2>
      <p className="muted">只在第一次启动时执行。Setup Token 不会保存在浏览器中。</p>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label>
          家庭名称
          <input value={familyName} onChange={(event) => setFamilyName(event.target.value)} required />
        </label>
        <label>
          宝宝昵称
          <input value={babyDisplayName} onChange={(event) => setBabyDisplayName(event.target.value)} required />
        </label>
        <label>
          爸爸登录名
          <input value={dadLogin} onChange={(event) => setDadLogin(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          爸爸密码
          <input type="password" value={dadPassword} onChange={(event) => setDadPassword(event.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
        <label>
          妈妈登录名
          <input value={momLogin} onChange={(event) => setMomLogin(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          妈妈密码
          <input type="password" value={momPassword} onChange={(event) => setMomPassword(event.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
        <label className="full-width">
          Setup Token
          <input type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="new-password" required />
        </label>
        {error ? <p className="form-error full-width" role="alert">{error}</p> : null}
        <button className="primary full-width" type="submit" disabled={busy}>{busy ? '正在初始化…' : '创建家庭'}</button>
      </form>
    </section>
  );
}
