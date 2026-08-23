import { useRef, useState } from 'react';
import {
  PairVoiceCareDeviceInputSchema,
  type SessionDto,
  type VoiceCarePairingChallengeDto,
  type VoiceCareStateDto,
} from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';
import { createClientRequestId } from '../care/client-request-id.js';

export function VoiceCareDeviceControls({
  api,
  session,
  state,
  busy,
  run,
}: {
  api: BabyCareApi;
  session: SessionDto;
  state: VoiceCareStateDto;
  busy: boolean;
  run: (work: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [challenge, setChallenge] = useState<VoiceCarePairingChallengeDto | null>(null);
  const [signedResponse, setSignedResponse] = useState('');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const challengeField = useRef<HTMLTextAreaElement | null>(null);
  const isAdmin = session.permissionLevel === 'family_admin';
  const activeLease = state.activeLeases.find((lease) => lease.revokedAt === null);
  const firstDevice = state.devices.find((device) => device.status === 'active');

  async function createChallenge() {
    await run(async () => {
      setChallenge(await api.createVoiceCarePairingChallenge());
      setSignedResponse('');
      setCopyMessage(null);
    }, '配对挑战已生成，请交给 Baby Local');
  }

  async function pair() {
    await run(async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(signedResponse);
      } catch {
        throw new Error('voice_care_pairing_response_invalid');
      }
      const input = PairVoiceCareDeviceInputSchema.safeParse(parsed);
      if (!input.success || input.data.challengeId !== challenge?.challengeId || input.data.challenge !== challenge.challenge) {
        throw new Error('voice_care_pairing_response_invalid');
      }
      await api.pairVoiceCareDevice(input.data);
      setChallenge(null);
      setSignedResponse('');
      setCopyMessage(null);
    }, '语音设备已配对');
  }

  async function copyChallenge() {
    if (!challenge) return;
    const serialized = JSON.stringify(challenge);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(serialized);
      setCopyMessage('配对挑战已复制');
    } catch {
      challengeField.current?.focus();
      challengeField.current?.select();
      setCopyMessage('挑战已选中，请复制后交给 Baby Local');
    }
  }

  return (
    <section className="voice-care-devices" aria-label="语音设备与照护租约">
      <h3>设备与照护者</h3>
      {activeLease ? (
        <div className="voice-care-lease">
          <strong>当前语音照护者：{activeLease.actorDisplayName}</strong>
          <span>有效至 {new Date(activeLease.expiresAt).toLocaleString('zh-CN')}</span>
          {(activeLease.actorUserId === session.userId || isAdmin) ? (
            <button className="secondary" type="button" disabled={busy} onClick={() => void run(
              () => api.revokeVoiceCareLease(activeLease.id),
              '语音照护已停止',
            )}>停止语音照护</button>
          ) : null}
        </div>
      ) : firstDevice ? (
        <button className="primary" type="button" disabled={busy} onClick={() => void run(
          () => api.activateVoiceCareLease(firstDevice.id, {
            clientRequestId: createClientRequestId(),
            occurredAt: new Date().toISOString(),
          }),
          '语音照护已由你接管',
        )}>在这台设备上由我照护</button>
      ) : <p className="muted">尚无可用语音设备</p>}

      {isAdmin ? (
        <div className="voice-care-admin">
          <button className="secondary" type="button" disabled={busy} onClick={() => void createChallenge()}>
            生成配对挑战
          </button>
          {challenge ? (
            <>
              <label>配对挑战包
                <textarea ref={challengeField} className="voice-care-code" readOnly value={JSON.stringify(challenge)} />
              </label>
              <button className="secondary" type="button" disabled={busy} onClick={() => void copyChallenge()}>
                复制配对挑战
              </button>
              {copyMessage ? <p className="inline-message" role="status">{copyMessage}</p> : null}
              <label>Baby Local 签名响应
                <textarea className="voice-care-code" value={signedResponse} onChange={(event) => setSignedResponse(event.target.value)} />
              </label>
              <button className="primary" type="button" disabled={busy || !signedResponse} onClick={() => void pair()}>
                配对语音设备
              </button>
            </>
          ) : null}
          {state.devices.map((device) => device.status === 'active' ? (
            <button key={device.id} className="secondary" type="button" disabled={busy} onClick={() => {
              if (window.confirm('撤销后该设备需要重新配对。确定继续吗？')) {
                void run(() => api.revokeVoiceCareDevice(device.id), '语音设备已撤销');
              }
            }}>撤销设备 {device.id.slice(0, 8)}</button>
          ) : null)}
        </div>
      ) : null}
    </section>
  );
}
