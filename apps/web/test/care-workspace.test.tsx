import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

const session = {
  userId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Dad',
  relationship: 'dad',
  permissionLevel: 'family_admin',
  familyId: '22222222-2222-4222-8222-222222222222',
  familyName: 'Xiangxiang Family',
  babyId: '33333333-3333-4333-8333-333333333333',
  babyDisplayName: 'xiangxiang',
} as const;

const summary = {
  asOf: '2026-08-13T08:00:00.000Z',
  lastFeeding: {
    occurredAt: '2026-08-13T07:15:00.000Z',
    bottle: { liquidType: 'formula', amountMl: 60 },
  },
  lastDiaper: { occurredAt: '2026-08-13T06:40:00.000Z', kind: 'urine' },
  rolling24h: {
    bottleTotalMl: 420,
    expressedBreastMilkMl: 120,
    formulaMl: 300,
    directBreastfeedingSessions: 5,
    directBreastfeedingMinutes: 86,
  },
  currentSleep: {
    intervalId: '44444444-4444-4444-8444-444444444444',
    startedAt: '2026-08-13T07:28:00.000Z',
  },
} as const;

function fakeApi() {
  return {
    getSetupStatus: vi.fn(async () => ({ required: false })),
    setupFamily: vi.fn(async () => ({ status: 'created' as const })),
    login: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    getSession: vi.fn(async () => session),
    getFamily: vi.fn(async () => ({ id: session.familyId, name: 'Xiangxiang Family', timezone: 'Asia/Shanghai', status: 'active' as const })),
    updateFamily: vi.fn(),
    getBaby: vi.fn(async () => ({ id: session.babyId, displayName: 'xiangxiang', birthDate: null, status: 'active' as const })),
    updateBaby: vi.fn(),
    listMembers: vi.fn(async () => []),
    createNanny: vi.fn(),
    setNannyStatus: vi.fn(),
    resetNannyPassword: vi.fn(),
    getCareSummary: vi.fn(async () => summary),
    getFeedingQuickValues: vi.fn(async (liquidType: 'expressed_breast_milk' | 'formula') => ({ liquidType, values: [45, 60, 75] })),
    createFeedingSession: vi.fn(async () => ({ id: '55555555-5555-4555-8555-555555555555', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const })),
    createDiaper: vi.fn(async () => ({ id: '66666666-6666-4666-8666-666666666666', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, kind: 'urine' as const, stoolColor: null, stoolConsistency: null, stoolAmount: null, note: null })),
    startSleep: vi.fn(async () => ({ id: '77777777-7777-4777-8777-777777777777', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, startedAt: '2026-08-13T08:00:00.000Z', endedAt: null, note: null })),
    wakeSleep: vi.fn(async () => ({ id: '77777777-7777-4777-8777-777777777777', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, startedAt: '2026-08-13T07:30:00.000Z', endedAt: '2026-08-13T08:00:00.000Z', note: null })),
  };
}

function renderWorkspace() {
  const api = fakeApi();
  render(<App {...({ api } as unknown as Record<string, never>)} />);
  return api;
}

afterEach(() => cleanup());

describe('M2 fast care workspace', () => {
  it('shows the home care priorities immediately after login', async () => {
    const api = renderWorkspace();
    expect(await screen.findByRole('heading', { name: '护理状态' })).toBeInTheDocument();
    await waitFor(() => expect(api.getCareSummary).toHaveBeenCalled());
    expect(screen.getByText('45分钟前')).toBeInTheDocument();
    expect(screen.getByText('配方奶 60ml')).toBeInTheDocument();
    expect(screen.getByText('1小时20分钟前')).toBeInTheDocument();
    expect(screen.getByText('过去24小时瓶喂 420ml')).toBeInTheDocument();
    expect(screen.getByText('亲喂 5次 · 86min')).toBeInTheDocument();
    expect(screen.getByText('睡眠中 · 32min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '喂奶' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '尿布' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '睡觉/醒来' })).toBeInTheDocument();
  });

  it('uses recent actual formula amounts as shortcuts and never bottle capacities', async () => {
    const api = renderWorkspace();
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
    expect(screen.getByRole('button', { name: '母乳瓶喂' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '配方奶' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '亲喂' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配方奶' }));
    await waitFor(() => expect(api.getFeedingQuickValues).toHaveBeenCalledWith('formula'));
    for (const amount of ['45ml', '60ml', '75ml']) {
      expect(screen.getByRole('button', { name: amount })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '其他' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '90ml' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '150ml' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '200ml' })).not.toBeInTheDocument();
  });

  it('records direct breastfeeding by total minutes only', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
    fireEvent.click(screen.getByRole('button', { name: '亲喂' }));
    expect(screen.getByLabelText('本次亲喂总时长（分钟）')).toBeInTheDocument();
    expect(screen.queryByText(/左乳|右乳/)).not.toBeInTheDocument();
  });

  it('keeps urine diaper short, progressively reveals stool details, and exposes sleep backfill choices', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '尿布' }));
    expect(screen.getByRole('button', { name: '尿' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '便' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '尿+便' })).toBeInTheDocument();
    expect(screen.queryByLabelText('便便颜色')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '便' }));
    expect(screen.getByLabelText('便便颜色')).toBeInTheDocument();
    expect(screen.getByLabelText('便便性状')).toBeInTheDocument();
    expect(screen.getByLabelText('便便量')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '睡觉/醒来' }));
    for (const label of ['现在', '10分钟前', '20分钟前', '30分钟前', '自定义']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});
