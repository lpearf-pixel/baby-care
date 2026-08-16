import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { BabyCareApiError } from '../src/api-client.js';

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

const emptySummary = {
  asOf: '2026-08-13T08:00:00.000Z',
  lastFeeding: null,
  lastDiaper: null,
  rolling24h: {
    bottleTotalMl: 0,
    expressedBreastMilkMl: 0,
    formulaMl: 0,
    directBreastfeedingSessions: 0,
    directBreastfeedingMinutes: 0,
  },
  currentSleep: null,
} as const;

function makeApi(overrides: Record<string, unknown> = {}) {
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
    getCareSummary: vi.fn(async () => emptySummary),
    getFeedingQuickValues: vi.fn(async (liquidType: 'expressed_breast_milk' | 'formula') => ({ liquidType, values: [60] })),
    createFeedingSession: vi.fn(async (input: { occurredAt: string; components: unknown[] }) => ({
      id: '55555555-5555-4555-8555-555555555555',
      occurredAt: input.occurredAt,
      status: 'active' as const,
      components: input.components,
      relatedActions: [],
      note: null,
    })),
    createDiaper: vi.fn(),
    startSleep: vi.fn(),
    wakeSleep: vi.fn(),
    createCareAction: vi.fn(async (input: { occurredAt: string; action: { kind: string } }) => ({
      id: '66666666-6666-4666-8666-666666666666', occurredAt: input.occurredAt, status: 'active' as const, kind: input.action.kind,
    })),
    createMeasurement: vi.fn(async (input: { occurredAt: string; measurement: { kind: string } }) => ({
      id: '77777777-7777-4777-8777-777777777777', occurredAt: input.occurredAt, status: 'active' as const, kind: input.measurement.kind,
    })),
    editCareEvent: vi.fn(async (eventId: string) => ({ id: eventId, eventType: 'feeding' as const, status: 'active' as const, version: 2 })),
    undoCareEvent: vi.fn(async (eventId: string) => ({ id: eventId, status: 'voided' as const })),
    ...overrides,
  };
}

function renderWithApi(api: ReturnType<typeof makeApi>) {
  render(<App {...({ api } as unknown as Record<string, never>)} />);
}

async function openFormulaFeed() {
  await screen.findByRole('heading', { name: '护理状态' });
  fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
  fireEvent.click(screen.getByRole('button', { name: '配方奶' }));
  await screen.findByLabelText('实际喝了（ml）');
}

afterEach(() => cleanup());

describe('M2 warnings, frequent care, and corrections', () => {
  it('offers frequent care facts without any medication recommendation UI', async () => {
    const api = makeApi();
    renderWithApi(api);
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    for (const label of ['拍嗝', '吐奶', '哭闹', '洗澡', '体温', '体重', '喂药']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '喂药' }));
    expect(screen.getByLabelText('药物名称')).toBeInTheDocument();
    expect(screen.getByLabelText('实际剂量')).toBeInTheDocument();
    expect(screen.getByLabelText('剂量单位')).toBeInTheDocument();
    expect(screen.queryByText(/推荐剂量|建议剂量|应该服用/)).not.toBeInTheDocument();
  });

  it('shows a warning and continues with the unchanged input plus confirmed warning code', async () => {
    const createFeedingSession = vi.fn()
      .mockRejectedValueOnce(new BabyCareApiError('care_confirmation_required', 'Confirmation is required.', {
        warnings: [{ code: 'unusual_value', summary: '这个奶量与近期记录差异较大' }],
      }))
      .mockImplementation(async (input: { occurredAt: string; components: unknown[] }) => ({
        id: '55555555-5555-4555-8555-555555555555', occurredAt: input.occurredAt, status: 'active', components: input.components, relatedActions: [], note: null,
      }));
    const api = makeApi({ createFeedingSession });
    renderWithApi(api);
    await openFormulaFeed();
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));

    expect(await screen.findByRole('dialog', { name: '确认这条护理记录' })).toBeInTheDocument();
    expect(screen.getByText('这个奶量与近期记录差异较大')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续记录' }));
    await waitFor(() => expect(createFeedingSession).toHaveBeenCalledTimes(2));

    const first = createFeedingSession.mock.calls[0]![0];
    const second = createFeedingSession.mock.calls[1]![0];
    expect(second.clientRequestId).toBe(first.clientRequestId);
    expect(second.components).toEqual(first.components);
    expect(second.confirmedWarnings).toEqual(['unusual_value']);
  });

  it('keeps entered fields and the same client request id after an ordinary save failure', async () => {
    const createFeedingSession = vi.fn()
      .mockRejectedValueOnce(new BabyCareApiError('request_failed', 'offline'))
      .mockImplementation(async (input: { occurredAt: string; components: unknown[] }) => ({
        id: '55555555-5555-4555-8555-555555555555', occurredAt: input.occurredAt, status: 'active', components: input.components, relatedActions: [], note: null,
      }));
    const api = makeApi({ createFeedingSession });
    renderWithApi(api);
    await openFormulaFeed();
    const amount = screen.getByLabelText('实际喝了（ml）');
    fireEvent.change(amount, { target: { value: '68' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    expect(await screen.findByText('保存失败，已保留当前填写内容，可重试')).toBeInTheDocument();
    expect(amount).toHaveValue(68);

    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    await waitFor(() => expect(createFeedingSession).toHaveBeenCalledTimes(2));
    expect(createFeedingSession.mock.calls[1]![0].clientRequestId).toBe(createFeedingSession.mock.calls[0]![0].clientRequestId);
  });

  it('surfaces the most recent successful record with edit and undo actions', async () => {
    const api = makeApi();
    renderWithApi(api);
    await openFormulaFeed();
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));

    expect(await screen.findByText('刚刚记录：配方奶 60ml')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '修改' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(api.undoCareEvent).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      { expectedVersion: 1 },
    ));
    expect(screen.queryByText('刚刚记录：配方奶 60ml')).not.toBeInTheDocument();
  });

  it('uses the latest edit receipt version for a following undo', async () => {
    const api = makeApi();
    renderWithApi(api);
    await openFormulaFeed();
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    await screen.findByText('刚刚记录：配方奶 60ml');

    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      expect.objectContaining({ expectedVersion: 1, event: expect.objectContaining({ eventType: 'feeding' }) }),
    ));
    await screen.findByText('刚刚记录：配方奶 60ml');

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(api.undoCareEvent).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      { expectedVersion: 2 },
    ));
  });

  it('uses version 2 after completing an existing sleep interval', async () => {
    const getCareSummary = vi.fn(async () => ({
      ...emptySummary,
      currentSleep: {
        intervalId: '88888888-8888-4888-8888-888888888888',
        startedAt: '2026-08-13T07:30:00.000Z',
      },
    }));
    const wakeSleep = vi.fn(async () => ({
      id: '88888888-8888-4888-8888-888888888888',
      occurredAt: '2026-08-13T08:00:00.000Z',
      status: 'active' as const,
      startedAt: '2026-08-13T07:30:00.000Z',
      endedAt: '2026-08-13T08:00:00.000Z',
      note: null,
      version: 7,
    }));
    const api = makeApi({ getCareSummary, wakeSleep });
    renderWithApi(api);
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '睡觉/醒来' }));
    fireEvent.click(screen.getByRole('button', { name: '现在' }));
    await screen.findByText('刚刚记录：醒来');

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(api.undoCareEvent).toHaveBeenCalledWith(
      '88888888-8888-4888-8888-888888888888',
      { expectedVersion: 7 },
    ));
  });

  it('keeps the edit draft and shows the approved conflict message after a stale write', async () => {
    const editCareEvent = vi.fn(async () => {
      throw new BabyCareApiError('care_state_conflict', 'stale version');
    });
    const api = makeApi({ editCareEvent });
    renderWithApi(api);
    await openFormulaFeed();
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    await screen.findByText('刚刚记录：配方奶 60ml');

    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    const time = screen.getByLabelText('实际发生时间');
    fireEvent.change(time, { target: { value: '2026-08-13T07:45' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('记录已被其他照护者修改，请刷新后确认')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '修改最近护理记录' })).toBeInTheDocument();
    expect(screen.getByLabelText('实际发生时间')).toHaveValue('2026-08-13T07:45');
    expect(editCareEvent).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      expect.objectContaining({ expectedVersion: 1 }),
    );
  });

  it('consumes a committed edit receipt even when the following summary refresh fails', async () => {
    const getCareSummary = vi.fn()
      .mockResolvedValueOnce(emptySummary)
      .mockResolvedValueOnce(emptySummary)
      .mockRejectedValueOnce(new Error('refresh failed'));
    const api = makeApi({ getCareSummary });
    renderWithApi(api);
    await openFormulaFeed();
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    await screen.findByText('刚刚记录：配方奶 60ml');

    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('记录已保存，护理状态刷新失败，请手动刷新')).toBeInTheDocument();
    expect(screen.getByText('刚刚记录：配方奶 60ml')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(api.undoCareEvent).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      { expectedVersion: 2 },
    ));
  });
});
