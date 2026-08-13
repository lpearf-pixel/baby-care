import { useCallback, useEffect, useState } from 'react';
import type { BabyDto, FamilyDto, MemberDto, SessionDto } from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';
import { AdminFamilyPanel } from '../family/AdminFamilyPanel.js';
import { NannyFamilyView } from '../family/NannyFamilyView.js';

export function AuthenticatedShell({
  api,
  session,
  onLogout,
}: {
  api: BabyCareApi;
  session: SessionDto;
  onLogout: () => Promise<void>;
}) {
  const [family, setFamily] = useState<FamilyDto | null>(null);
  const [baby, setBaby] = useState<BabyDto | null>(null);
  const [members, setMembers] = useState<MemberDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [nextFamily, nextBaby, nextMembers] = await Promise.all([
      api.getFamily(),
      api.getBaby(),
      api.listMembers(),
    ]);
    setFamily(nextFamily);
    setBaby(nextBaby);
    setMembers(nextMembers);
  }, [api]);

  useEffect(() => {
    let active = true;
    void reload()
      .catch(() => {
        if (active) setMessage('家庭资料暂时无法加载，请稍后重试');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function runMutation(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage(successMessage);
    } catch {
      setMessage('保存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="identity-card">
        <div>
          <p className="label">当前照护者</p>
          <strong>{session.displayName}</strong>
          <span className="role-badge">
            {session.relationship === 'dad' ? 'Dad' : session.relationship === 'mom' ? 'Mom' : 'Nanny'}
          </span>
        </div>
        <button className="text-button" type="button" onClick={() => void onLogout()}>退出登录</button>
      </section>

      {loading ? <p className="foundation-note">正在加载家庭资料…</p> : null}
      {!loading && (!family || !baby) ? <p className="form-error" role="alert">{message ?? '家庭资料暂不可用'}</p> : null}

      {!loading && family && baby && session.permissionLevel === 'family_admin' ? (
        <AdminFamilyPanel
          family={family}
          baby={baby}
          members={members}
          busy={busy}
          message={message}
          onUpdateFamily={(input) => runMutation(() => api.updateFamily(input), '家庭资料已保存')}
          onUpdateBaby={(input) => runMutation(() => api.updateBaby(input), '宝宝资料已保存')}
          onCreateNanny={(input) => runMutation(() => api.createNanny(input), 'Nanny 账号已创建')}
          onSetNannyStatus={(membershipId, status) => runMutation(() => api.setNannyStatus(membershipId, status), status === 'active' ? 'Nanny 已启用' : 'Nanny 已停用')}
          onResetNannyPassword={(membershipId, newPassword) => runMutation(() => api.resetNannyPassword(membershipId, newPassword), 'Nanny 密码已重置，旧会话已失效')}
        />
      ) : null}

      {!loading && family && baby && session.permissionLevel === 'caregiver' ? (
        <NannyFamilyView family={family} baby={baby} members={members} />
      ) : null}
    </>
  );
}
