import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionDto, VoiceCareSessionDto, VoiceCareStateDto } from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';
import { VoiceCareDeviceControls } from './VoiceCareDeviceControls.js';
import { VoiceCarePendingSessions } from './VoiceCarePendingSessions.js';

export function VoiceCarePanel({ api, session }: { api: BabyCareApi; session: SessionDto }) {
  const [state, setState] = useState<VoiceCareStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    const version = ++requestVersion.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    try {
      const next = await api.getVoiceCareState(controller.signal);
      if (mounted.current && version === requestVersion.current) {
        setState(next);
        setMessage(null);
      }
      return true;
    } catch {
      if (mounted.current && version === requestVersion.current) {
        setState(null);
        setMessage('语音照护暂时无法加载');
      }
      return false;
    } finally {
      if (requestController.current === controller) requestController.current = null;
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [reload]);

  async function run(work: () => Promise<unknown>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await work();
      const refreshed = await reload();
      if (mounted.current) {
        setMessage(refreshed ? success : '操作已提交，但状态刷新失败，请手动刷新');
      }
    } catch {
      await reload();
      if (mounted.current) setMessage('语音照护操作失败，请刷新状态后重试');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function confirm(item: VoiceCareSessionDto) {
    if (!item.proposalDigest) return;
    await run(async () => {
      const semantic = await api.confirmVoiceCareSession(item.id, {
        proposalDigest: item.proposalDigest!,
        expectedVersion: item.version,
        warningDigest: item.warningDigest,
        confirmedWarningCodes: item.warningCodes,
      });
      if (semantic.code !== 'saved') throw new Error('voice_care_not_saved');
    }, '语音护理记录已保存');
  }

  async function cancel(item: VoiceCareSessionDto, reason: 'caregiver_cancelled' | 'stale') {
    await run(async () => {
      const semantic = await api.cancelVoiceCareSession(item.id, {
        expectedVersion: item.version,
        reason,
      });
      if (semantic.code !== 'accepted_pending') throw new Error('voice_care_not_cancelled');
    }, '语音护理记录已取消');
  }

  return (
    <section className="panel voice-care-panel" aria-labelledby="voice-care-title">
      <div className="care-panel-header">
        <div>
          <p className="label">Local Voice Care</p>
          <h2 id="voice-care-title">语音照护</h2>
        </div>
        <button className="text-button" type="button" disabled={loading || busy} onClick={() => void reload()}>
          刷新语音照护
        </button>
      </div>
      {loading ? <p className="inline-message" role="status">正在加载语音照护…</p> : null}
      {!loading && !state ? (
        <div className="voice-care-load-error">
          <p className="form-error">{message ?? '语音照护暂时无法加载'}</p>
          <button className="secondary" type="button" onClick={() => void reload()}>重试语音照护</button>
        </div>
      ) : null}
      {state ? (
        <>
          <VoiceCareDeviceControls api={api} session={session} state={state} busy={busy} run={run} />
          <VoiceCarePendingSessions
            session={session}
            sessions={state.sessions}
            busy={busy}
            onConfirm={confirm}
            onCancel={cancel}
          />
        </>
      ) : null}
      {state && message ? <p className="inline-message" role="status">{message}</p> : null}
      <p className="muted">语音识别只生成待确认事实；手动护理记录始终可用。</p>
    </section>
  );
}
