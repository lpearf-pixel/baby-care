import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SessionDto, VoiceCareSemanticResultV1, VoiceCareStateDto } from '@baby-care/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BabyCareApi } from '../src/api-client.js';
import { VoiceCarePanel } from '../src/voice-care/VoiceCarePanel.js';

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  mom: '22222222-2222-4222-8222-222222222222',
  nanny: '12121212-1212-4121-8121-121212121212',
  family: '33333333-3333-4333-8333-333333333333',
  baby: '44444444-4444-4444-8444-444444444444',
  device: '55555555-5555-4555-8555-555555555555',
  lease: '66666666-6666-4666-8666-666666666666',
  session: '77777777-7777-4777-8777-777777777777',
  otherSession: '88888888-8888-4888-8888-888888888888',
  event: '99999999-9999-4999-8999-999999999999',
  challenge: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
} as const;

const dadSession: SessionDto = {
  userId: ids.user,
  displayName: 'Dad',
  relationship: 'dad',
  permissionLevel: 'family_admin',
  familyId: ids.family,
  familyName: 'Xiangxiang Family',
  babyId: ids.baby,
  babyDisplayName: 'xiangxiang',
};
const nannySession: SessionDto = {
  ...dadSession,
  userId: ids.nanny,
  displayName: 'Nanny',
  relationship: 'nanny',
  permissionLevel: 'caregiver',
};
const digest = 'a'.repeat(64);

function bottleSession(overrides: Partial<VoiceCareStateDto['sessions'][number]> = {}) {
  return {
    id: ids.session,
    deviceId: ids.device,
    actorUserId: ids.user,
    actorDisplayName: 'Dad',
    state: 'needs_confirmation' as const,
    proposal: {
      mode: 'bottle' as const,
      startedAt: '2026-08-23T08:00:00.000Z',
      endedAt: '2026-08-23T08:12:00.000Z',
      liquidType: 'formula' as const,
      amountMl: 90,
      bottleCapacityMl: 150,
      amountValueOrigin: 'spoken' as const,
    },
    version: 3,
    proposalDigest: digest,
    warningDigest: null,
    warningCodes: [],
    finalCareEventId: null,
    startedAt: '2026-08-23T08:00:00.000Z',
    expiresAt: '2026-08-23T14:00:00.000Z',
    endedAt: '2026-08-23T08:12:00.000Z',
    confirmedAt: null,
    cancelledAt: null,
    canConfirm: true,
    canCancel: true,
    ...overrides,
  };
}

function state(overrides: Partial<VoiceCareStateDto> = {}): VoiceCareStateDto {
  return {
    devices: [{
      id: ids.device,
      capability: 'voice_care.intent.submit',
      status: 'active',
      createdAt: '2026-08-23T07:00:00.000Z',
      revokedAt: null,
    }],
    activeLeases: [],
    sessions: [bottleSession()],
    ...overrides,
  };
}

function makeApi(initial = state()) {
  let current = initial;
  const api = {
    getVoiceCareState: vi.fn(async (_signal?: AbortSignal) => current),
    createVoiceCarePairingChallenge: vi.fn(async () => ({
      challengeId: ids.challenge,
      challenge: 'A'.repeat(43),
      expiresAt: '2026-08-23T08:05:00.000Z',
    })),
    pairVoiceCareDevice: vi.fn(async () => current.devices[0]!),
    revokeVoiceCareDevice: vi.fn(async () => undefined),
    activateVoiceCareLease: vi.fn(async () => {
      const lease = {
        id: ids.lease,
        deviceId: ids.device,
        actorUserId: ids.user,
        actorDisplayName: 'Dad',
        issuedAt: '2026-08-23T08:00:00.000Z',
        expiresAt: '2026-08-23T16:00:00.000Z',
        revokedAt: null,
      };
      current = { ...current, activeLeases: [lease] };
      return lease;
    }),
    revokeVoiceCareLease: vi.fn(async () => undefined),
    confirmVoiceCareSession: vi.fn(async (): Promise<VoiceCareSemanticResultV1> => ({
      schemaVersion: 1 as const,
      code: 'saved' as const,
      careSessionId: ids.session,
      careEventId: ids.event,
      sessionVersion: 4,
      proposalDigest: digest,
      warningDigest: null,
      warningCodes: [],
      readback: null,
    })),
    cancelVoiceCareSession: vi.fn(async (): Promise<VoiceCareSemanticResultV1> => ({
      schemaVersion: 1 as const,
      code: 'accepted_pending' as const,
      careSessionId: ids.session,
      careEventId: null,
      sessionVersion: 4,
      proposalDigest: null,
      warningDigest: null,
      warningCodes: [],
      readback: null,
    })),
  };
  return api as unknown as BabyCareApi & typeof api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('M5 Voice Care panel', () => {
  it('lets Dad activate his lease and review typed facts without model or security material', async () => {
    const api = makeApi();
    render(<VoiceCarePanel api={api} session={dadSession} />);

    expect(await screen.findByText('配方奶 90 ml')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '在这台设备上由我照护' }));
    expect(await screen.findByText('当前语音照护者：Dad')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/transcript|signature|public.?key|modelVersion/i);
  });

  it('keeps pairing and device revocation out of the Nanny DOM', async () => {
    render(<VoiceCarePanel api={makeApi()} session={nannySession} />);
    expect(await screen.findByRole('heading', { name: '语音照护' })).toBeVisible();
    expect(screen.getByRole('button', { name: '在这台设备上由我照护' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '生成配对挑战' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /撤销设备/ })).not.toBeInTheDocument();
  });

  it('shows another caregiver lease and expiry to Nanny without cross-actor stop control', async () => {
    render(<VoiceCarePanel api={makeApi(state({
      activeLeases: [{
        id: ids.lease,
        deviceId: ids.device,
        actorUserId: ids.user,
        actorDisplayName: 'Dad',
        issuedAt: '2026-08-23T08:00:00.000Z',
        expiresAt: '2026-08-23T16:00:00.000Z',
        revokedAt: null,
      }],
    }))} session={nannySession} />);
    expect(await screen.findByText('当前语音照护者：Dad')).toBeVisible();
    expect(screen.getByText(/有效至/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '停止语音照护' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '在这台设备上由我照护' })).not.toBeInTheDocument();
  });

  it('allows only the same actor to confirm while Dad may cancel another stale session', async () => {
    const api = makeApi(state({
      sessions: [
        bottleSession(),
        bottleSession({
          id: ids.otherSession,
          actorUserId: ids.mom,
          actorDisplayName: 'Mom',
          canConfirm: false,
          canCancel: true,
        }),
      ],
    }));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    const dad = await screen.findByRole('article', { name: 'Dad 的待确认语音记录' });
    const mom = screen.getByRole('article', { name: 'Mom 的待确认语音记录' });
    fireEvent.click(within(dad).getByRole('button', { name: '确认并保存' }));
    await waitFor(() => expect(api.confirmVoiceCareSession).toHaveBeenCalledWith(ids.session, {
      proposalDigest: digest,
      expectedVersion: 3,
      warningDigest: null,
      confirmedWarningCodes: [],
    }));
    expect(within(mom).queryByRole('button', { name: '确认并保存' })).not.toBeInTheDocument();
    fireEvent.click(within(mom).getByRole('button', { name: '取消这条语音记录' }));
    await waitFor(() => expect(api.cancelVoiceCareSession).toHaveBeenCalledWith(ids.otherSession, {
      expectedVersion: 3,
      reason: 'stale',
    }));
  });

  it('requires explicit warning confirmation and links a committed fact to the timeline', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = makeApi(state({
      sessions: [
        bottleSession({ warningCodes: ['possible_duplicate'], warningDigest: 'b'.repeat(64) }),
        bottleSession({
          id: ids.otherSession,
          state: 'committed',
          finalCareEventId: ids.event,
          canConfirm: false,
          canCancel: false,
        }),
      ],
    }));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    expect(await screen.findByText('可能与近期记录重复')).toBeVisible();
    const save = screen.getByRole('button', { name: '确认并保存' });
    fireEvent.click(save);
    expect(api.confirmVoiceCareSession).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(api.confirmVoiceCareSession).toHaveBeenCalledWith(ids.session, expect.objectContaining({
      warningDigest: 'b'.repeat(64),
      confirmedWarningCodes: ['possible_duplicate'],
    })));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: '查看已保存护理记录' })).toHaveAttribute(
      'href',
      `#care-event-${ids.event}`,
    );
  });

  it('uses an operator-assisted challenge exchange and clears it after pairing', async () => {
    const api = makeApi(state({ devices: [] }));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    fireEvent.click(await screen.findByRole('button', { name: '生成配对挑战' }));
    const challenge = await screen.findByLabelText('配对挑战包');
    expect((challenge as HTMLTextAreaElement).value).toContain(ids.challenge);
    const response = {
      challengeId: ids.challenge,
      challenge: 'A'.repeat(43),
      deviceId: ids.device,
      publicKey: `${'B'.repeat(42)}A`,
      signature: `${'C'.repeat(85)}A`,
    };
    fireEvent.change(screen.getByLabelText('Baby Local 签名响应'), {
      target: { value: JSON.stringify(response) },
    });
    fireEvent.click(screen.getByRole('button', { name: '配对语音设备' }));
    await waitFor(() => expect(api.pairVoiceCareDevice).toHaveBeenCalledWith(response));
    expect(screen.queryByLabelText('配对挑战包')).not.toBeInTheDocument();
  });

  it('offers a copy action with a selection fallback for the pairing challenge', async () => {
    const api = makeApi(state({ devices: [] }));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    fireEvent.click(await screen.findByRole('button', { name: '生成配对挑战' }));
    const challenge = await screen.findByLabelText('配对挑战包') as HTMLTextAreaElement;
    const select = vi.spyOn(challenge, 'select');
    fireEvent.click(screen.getByRole('button', { name: '复制配对挑战' }));
    expect(select).toHaveBeenCalledOnce();
    expect(screen.getByText('挑战已选中，请复制后交给 Baby Local')).toBeVisible();
  });

  it('fails closed with bounded feedback for an invalid signed pairing response', async () => {
    const api = makeApi(state({ devices: [] }));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    fireEvent.click(await screen.findByRole('button', { name: '生成配对挑战' }));
    fireEvent.change(await screen.findByLabelText('Baby Local 签名响应'), {
      target: { value: '{"challengeId":"wrong"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '配对语音设备' }));
    expect(await screen.findByText('语音照护操作失败，请刷新状态后重试')).toBeVisible();
    expect(api.pairVoiceCareDevice).not.toHaveBeenCalled();
  });

  it('shows a bounded load failure and supports retry', async () => {
    const api = makeApi();
    api.getVoiceCareState.mockRejectedValueOnce(new Error('private database detail'));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    expect(await screen.findByText('语音照护暂时无法加载')).toBeVisible();
    expect(screen.queryByText('private database detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试语音照护' }));
    expect(await screen.findByText('配方奶 90 ml')).toBeVisible();
  });

  it('aborts the in-flight state request when the panel unmounts', async () => {
    const api = makeApi();
    let requestSignal: AbortSignal | undefined;
    api.getVoiceCareState.mockImplementation((signal?: AbortSignal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const rendered = render(<VoiceCarePanel api={api} session={dadSession} />);
    await waitFor(() => expect(api.getVoiceCareState).toHaveBeenCalledOnce());
    rendered.unmount();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not report saved for a closed semantic conflict', async () => {
    const api = makeApi();
    api.confirmVoiceCareSession.mockResolvedValueOnce({
      schemaVersion: 1,
      code: 'state_conflict',
      careSessionId: ids.session,
      careEventId: null,
      sessionVersion: 4,
      proposalDigest: null,
      warningDigest: null,
      warningCodes: [],
      readback: null,
    });
    render(<VoiceCarePanel api={api} session={dadSession} />);
    fireEvent.click(within(await screen.findByRole('article', { name: 'Dad 的待确认语音记录' }))
      .getByRole('button', { name: '确认并保存' }));
    expect(await screen.findByText('语音照护操作失败，请刷新状态后重试')).toBeVisible();
    expect(screen.queryByText('语音护理记录已保存')).not.toBeInTheDocument();
  });

  it('submits one lease activation under a same-tick double click', async () => {
    const api = makeApi();
    api.activateVoiceCareLease.mockImplementation(() => new Promise(() => undefined));
    render(<VoiceCarePanel api={api} session={dadSession} />);
    const activate = await screen.findByRole('button', { name: '在这台设备上由我照护' });
    fireEvent.click(activate);
    fireEvent.click(activate);
    expect(api.activateVoiceCareLease).toHaveBeenCalledTimes(1);
  });
});
