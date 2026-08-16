import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isSafeTimeZoneIdentifier, type BabyDto, type FamilyDto, type MemberDto } from '@baby-care/contracts';

export function AdminFamilyPanel({
  family,
  baby,
  members,
  busy,
  message,
  onUpdateFamily,
  onUpdateBaby,
  onCreateNanny,
  onSetNannyStatus,
  onResetNannyPassword,
}: {
  family: FamilyDto;
  baby: BabyDto;
  members: MemberDto[];
  busy: boolean;
  message: string | null;
  onUpdateFamily: (input: { name?: string; timezone?: string }) => Promise<void>;
  onUpdateBaby: (input: { displayName?: string; birthDate?: string | null }) => Promise<void>;
  onCreateNanny: (input: { loginName: string; displayName: string; password: string }) => Promise<void>;
  onSetNannyStatus: (membershipId: string, status: 'active' | 'disabled') => Promise<void>;
  onResetNannyPassword: (membershipId: string, newPassword: string) => Promise<void>;
}) {
  const [familyName, setFamilyName] = useState(family.name);
  const [timezone, setTimezone] = useState(family.timezone);
  const [babyName, setBabyName] = useState(baby.displayName);
  const [birthDate, setBirthDate] = useState(baby.birthDate ?? '');
  const [nannyLogin, setNannyLogin] = useState('nanny');
  const [nannyName, setNannyName] = useState('Nanny');
  const [nannyPassword, setNannyPassword] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    setFamilyName(family.name);
    setTimezone(family.timezone);
  }, [family]);

  useEffect(() => {
    setBabyName(baby.displayName);
    setBirthDate(baby.birthDate ?? '');
  }, [baby]);

  const nanny = useMemo(
    () => members.find((member) => member.relationship === 'nanny'),
    [members],
  );
  const timezoneValid = isSafeTimeZoneIdentifier(timezone.trim());

  async function saveFamily(event: FormEvent) {
    event.preventDefault();
    if (!timezoneValid) return;
    await onUpdateFamily({ name: familyName, timezone });
  }

  async function saveBaby(event: FormEvent) {
    event.preventDefault();
    await onUpdateBaby({ displayName: babyName, birthDate: birthDate || null });
  }

  async function createNanny(event: FormEvent) {
    event.preventDefault();
    await onCreateNanny({ loginName: nannyLogin, displayName: nannyName, password: nannyPassword });
    setNannyPassword('');
  }

  return (
    <section className="workspace-grid" aria-labelledby="family-admin-title">
      <div className="panel full-span">
        <p className="eyebrow">Dad / Mom</p>
        <h2 id="family-admin-title">家庭管理</h2>
        <p className="muted">这里只管理家庭身份和基础资料。护理记录尚未启用。</p>
        {message ? <p className="inline-message" role="status">{message}</p> : null}
      </div>

      <form className="panel form-grid" onSubmit={(event) => void saveFamily(event)}>
        <h3 className="full-width">家庭资料</h3>
        <label className="full-width">
          家庭名称
          <input value={familyName} onChange={(event) => setFamilyName(event.target.value)} />
        </label>
        <label className="full-width">
          时区
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-invalid={!timezoneValid} />
        </label>
        {!timezoneValid ? <p className="form-error full-width">请输入安全的 IANA 时区标识（例如 Asia/Shanghai）</p> : null}
        <button className="secondary full-width" type="submit" disabled={busy || !timezoneValid}>保存家庭资料</button>
      </form>

      <form className="panel form-grid" onSubmit={(event) => void saveBaby(event)}>
        <h3 className="full-width">宝宝资料</h3>
        <label className="full-width">
          宝宝昵称
          <input value={babyName} onChange={(event) => setBabyName(event.target.value)} />
        </label>
        <label className="full-width">
          出生日期
          <input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
        </label>
        <button className="secondary full-width" type="submit" disabled={busy}>保存宝宝资料</button>
      </form>

      <div className="panel full-span">
        <h3>家庭成员</h3>
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.membershipId}>
              <strong>{member.displayName}</strong>
              <span>{member.relationship === 'dad' ? 'Dad' : member.relationship === 'mom' ? 'Mom' : 'Nanny'}</span>
              <span>{member.status === 'active' ? '可用' : '已停用'}</span>
            </li>
          ))}
        </ul>

        {!nanny ? (
          <form className="form-grid nested-form" onSubmit={(event) => void createNanny(event)}>
            <h4 className="full-width">添加 Nanny / 月嫂</h4>
            <label>
              登录名
              <input value={nannyLogin} onChange={(event) => setNannyLogin(event.target.value)} />
            </label>
            <label>
              显示名
              <input value={nannyName} onChange={(event) => setNannyName(event.target.value)} />
            </label>
            <label className="full-width">
              初始密码
              <input type="password" minLength={10} value={nannyPassword} onChange={(event) => setNannyPassword(event.target.value)} />
            </label>
            <button className="primary full-width" type="submit" disabled={busy}>添加月嫂</button>
          </form>
        ) : (
          <div className="nanny-admin">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void onSetNannyStatus(nanny.membershipId, nanny.status === 'active' ? 'disabled' : 'active')}
            >
              {nanny.status === 'active' ? '停用 Nanny' : '启用 Nanny'}
            </button>
            <label>
              Nanny 新密码
              <input type="password" minLength={10} value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} />
            </label>
            <button
              className="secondary"
              type="button"
              disabled={busy || resetPassword.length < 10}
              onClick={() => void onResetNannyPassword(nanny.membershipId, resetPassword).then(() => setResetPassword(''))}
            >
              重置 Nanny 密码
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
