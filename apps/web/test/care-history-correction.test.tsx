import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareTimelineItemDto, UpdateCareEventRequest } from '@baby-care/contracts';
import { App } from '../src/App.js';
import { BabyCareApiError } from '../src/api-client.js';

const ids = {
  feeding: '10000000-0000-4000-8000-000000000001',
  diaper: '10000000-0000-4000-8000-000000000002',
  sleep: '10000000-0000-4000-8000-000000000003',
  burping: '10000000-0000-4000-8000-000000000004',
  spitUp: '10000000-0000-4000-8000-000000000005',
  crying: '10000000-0000-4000-8000-000000000006',
  bathing: '10000000-0000-4000-8000-000000000007',
  medication: '10000000-0000-4000-8000-000000000008',
  temperature: '10000000-0000-4000-8000-000000000009',
  weight: '10000000-0000-4000-8000-000000000010',
};

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

function base(id: string, eventType: CareTimelineItemDto['eventType']) {
  return {
    id,
    eventType,
    occurredAt: '2026-08-13T06:00:00.000Z',
    createdAt: '2026-08-13T06:02:00.000Z',
    updatedAt: '2026-08-13T06:05:00.000Z',
    status: 'active' as const,
    source: 'manual' as const,
    actorUserId: session.userId,
    actorDisplayName: 'Dad',
    note: 'night note',
    version: 2,
    isBackfilled: true,
  };
}

const details: CareTimelineItemDto[] = [
  {
    ...base(ids.feeding, 'feeding'),
    eventType: 'feeding',
    payload: {
      components: [
        { kind: 'bottle', liquidType: 'formula', amountMl: 70, bottleCapacityMl: 150 },
        { kind: 'direct_breastfeeding', durationMinutes: 12 },
      ],
      relatedActions: [{ kind: 'burping' }, { kind: 'spit_up', amount: 'small' }],
    },
  },
  {
    ...base(ids.diaper, 'diaper'),
    eventType: 'diaper',
    payload: { kind: 'urine_stool', stoolColor: '黄色', stoolConsistency: '籽状', stoolAmount: '中量' },
  },
  {
    ...base(ids.sleep, 'sleep'),
    eventType: 'sleep',
    payload: { startedAt: '2026-08-13T05:10:00.000Z', endedAt: '2026-08-13T06:00:00.000Z' },
  },
  { ...base(ids.burping, 'burping'), eventType: 'burping', payload: { action: { kind: 'burping' } } },
  { ...base(ids.spitUp, 'spit_up'), eventType: 'spit_up', payload: { action: { kind: 'spit_up', amount: 'large' } } },
  { ...base(ids.crying, 'crying'), eventType: 'crying', payload: { action: { kind: 'crying', durationMinutes: 9 } } },
  { ...base(ids.bathing, 'bathing'), eventType: 'bathing', payload: { action: { kind: 'bathing' } } },
  {
    ...base(ids.medication, 'medication'),
    eventType: 'medication',
    payload: { action: { kind: 'medication', medicationName: 'Vitamin D', dose: 0.5, doseUnit: 'mL' } },
  },
  {
    ...base(ids.temperature, 'temperature'),
    eventType: 'temperature',
    payload: { measurement: { kind: 'temperature', valueCelsius: 37.4, method: '腋温' } },
  },
  { ...base(ids.weight, 'weight'), eventType: 'weight', payload: { measurement: { kind: 'weight', valueKg: 4.25 } } },
];

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    getSetupStatus: vi.fn(async () => ({ required: false })),
    setupFamily: vi.fn(async () => ({ status: 'created' as const })),
    login: vi.fn(async () => session),
    logout: vi.fn(async () => undefined),
    getSession: vi.fn(async () => session),
    getFamily: vi.fn(async () => ({ id: session.familyId, name: session.familyName, timezone: 'Asia/Shanghai', status: 'active' as const })),
    updateFamily: vi.fn(),
    getBaby: vi.fn(async () => ({ id: session.babyId, displayName: session.babyDisplayName, birthDate: null, status: 'active' as const })),
    updateBaby: vi.fn(),
    listMembers: vi.fn(async () => []),
    createNanny: vi.fn(),
    setNannyStatus: vi.fn(),
    resetNannyPassword: vi.fn(),
    getCareSummary: vi.fn(async () => emptySummary),
    getLatestCareHandoff: vi.fn(async () => null),
    getCareHandoffSummary: vi.fn(),
    createCareHandoff: vi.fn(),
    getCareTimeline: vi.fn(async () => ({ items: details, nextCursor: null })),
    getCareEventDetail: vi.fn(async (eventId: string) => details.find((item) => item.id === eventId)),
    getCareEventRevisions: vi.fn(async () => []),
    getFeedingQuickValues: vi.fn(async (liquidType: 'expressed_breast_milk' | 'formula') => ({ liquidType, values: [] })),
    createFeedingSession: vi.fn(),
    createDiaper: vi.fn(),
    startSleep: vi.fn(),
    wakeSleep: vi.fn(),
    createCareAction: vi.fn(),
    createMeasurement: vi.fn(),
    editCareEvent: vi.fn(async (eventId: string, _input: UpdateCareEventRequest) => ({ id: eventId, eventType: 'feeding' as const, status: 'active' as const, version: 3 })),
    undoCareEvent: vi.fn(async (eventId: string) => ({ id: eventId, status: 'voided' as const })),
    ...overrides,
  };
}

function renderApp(api = makeApi()) {
  render(<App {...({ api } as unknown as Record<string, never>)} />);
  return api;
}

async function openOnlyDetail(item: CareTimelineItemDto, overrides: Record<string, unknown> = {}) {
  const api = makeApi({
    getCareTimeline: vi.fn(async () => ({ items: [item], nextCursor: null })),
    getCareEventDetail: vi.fn(async () => item),
    ...overrides,
  });
  renderApp(api);
  fireEvent.click(await screen.findByRole('button', { name: '查看详情' }));
  return { api, detail: await screen.findByRole('region', { name: '护理记录详情' }) };
}

afterEach(() => cleanup());

describe('M3 complete care history correction', () => {
  it.each([
    [details[0]!, ['实际喝了 70ml', '奶瓶容量 150ml（不计入摄入量）', '亲喂 12min', '拍嗝', '少量吐奶']],
    [details[1]!, ['尿+便', '便便颜色 黄色', '便便性状 籽状', '便便量 中量']],
    [details[2]!, ['睡眠开始 2026-08-13 13:10', '睡眠结束 2026-08-13 14:00']],
    [details[3]!, ['拍嗝']],
    [details[4]!, ['吐奶量 大量']],
    [details[5]!, ['哭闹时长 9min']],
    [details[6]!, ['洗澡']],
    [details[7]!, ['实际用药 Vitamin D', '实际剂量 0.5 mL']],
    [details[8]!, ['体温 37.4°C', '测量方式 腋温']],
    [details[9]!, ['体重 4.25kg']],
  ])('renders full typed facts for %s', async (item, facts) => {
    const { detail } = await openOnlyDetail(item);
    for (const fact of facts) expect(within(detail).getByText(fact)).toBeInTheDocument();
    expect(within(detail).getByText('实际发生时间 2026-08-13 14:00')).toBeInTheDocument();
    expect(within(detail).getByText('Dad · 手动记录 · 补记')).toBeInTheDocument();
    expect(within(detail).getByText('版本 2')).toBeInTheDocument();
    expect(within(detail).getByText('备注 night note')).toBeInTheDocument();
    expect(within(detail).queryByText(/建议|推荐|计算剂量/)).not.toBeInTheDocument();
  });

  it('edits formula actual amount and time with the current version', async () => {
    const { api } = await openOnlyDetail(details[0]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '76' } });
    fireEvent.change(screen.getByLabelText('实际发生时间'), { target: { value: '2026-08-13T06:20' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalledWith(ids.feeding, {
      expectedVersion: 2,
      event: expect.objectContaining({
        eventType: 'feeding',
        occurredAt: new Date('2026-08-13T06:20').toISOString(),
        components: expect.arrayContaining([
          expect.objectContaining({ kind: 'bottle', amountMl: 76, bottleCapacityMl: 150 }),
          expect.objectContaining({ kind: 'direct_breastfeeding', durationMinutes: 12 }),
        ]),
      }),
    }));
  });

  it('adds and removes feeding components and edits related care facts', async () => {
    const { api } = await openOnlyDetail(details[0]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '删除亲喂组成' }));
    fireEvent.click(screen.getByRole('button', { name: '添加亲喂' }));
    fireEvent.change(screen.getByLabelText('亲喂总时长（分钟）'), { target: { value: '18' } });
    fireEvent.click(screen.getByLabelText('记录拍嗝'));
    fireEvent.change(screen.getByLabelText('吐奶量'), { target: { value: 'large' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalledWith(ids.feeding, {
      expectedVersion: 2,
      event: expect.objectContaining({
        eventType: 'feeding',
        components: [
          expect.objectContaining({ kind: 'bottle', amountMl: 70, bottleCapacityMl: 150 }),
          { kind: 'direct_breastfeeding', durationMinutes: 18 },
        ],
        relatedActions: [{ kind: 'spit_up', amount: 'large' }],
      }),
    }));
  });

  it('can clear an existing note without retaining the old value', async () => {
    const { api } = await openOnlyDetail(details[0]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalled());
    expect(api.editCareEvent.mock.calls[0]![1].event).not.toHaveProperty('note');
  });

  it('edits diaper kind and progressive stool detail', async () => {
    const { api } = await openOnlyDetail(details[1]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '便' }));
    fireEvent.change(screen.getByLabelText('便便颜色'), { target: { value: '绿色' } });
    fireEvent.change(screen.getByLabelText('便便性状'), { target: { value: '糊状' } });
    fireEvent.change(screen.getByLabelText('便便量'), { target: { value: '少量' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalledWith(ids.diaper, {
      expectedVersion: 2,
      event: expect.objectContaining({
        eventType: 'diaper', kind: 'stool', stoolColor: '绿色', stoolConsistency: '糊状', stoolAmount: '少量',
      }),
    }));
  });

  it('removes hidden stool facts when changing a diaper record to urine', async () => {
    const { api } = await openOnlyDetail(details[1]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '尿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalled());
    expect(api.editCareEvent.mock.calls[0]![1].event).toEqual(expect.objectContaining({ eventType: 'diaper', kind: 'urine' }));
    expect(api.editCareEvent.mock.calls[0]![1].event).not.toHaveProperty('stoolColor');
    expect(api.editCareEvent.mock.calls[0]![1].event).not.toHaveProperty('stoolConsistency');
    expect(api.editCareEvent.mock.calls[0]![1].event).not.toHaveProperty('stoolAmount');
  });

  it('edits the complete sleep interval', async () => {
    const { api } = await openOnlyDetail(details[2]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.change(screen.getByLabelText('睡眠开始时间'), { target: { value: '2026-08-13T05:20' } });
    fireEvent.change(screen.getByLabelText('睡眠结束时间'), { target: { value: '2026-08-13T06:10' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalledWith(ids.sleep, {
      expectedVersion: 2,
      event: expect.objectContaining({
        eventType: 'sleep', startedAt: new Date('2026-08-13T05:20').toISOString(), endedAt: new Date('2026-08-13T06:10').toISOString(),
      }),
    }));
  });

  it('edits only medication facts, actual time, and note', async () => {
    const { api } = await openOnlyDetail(details[7]!);
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.change(screen.getByLabelText('药物名称'), { target: { value: '维生素 D3' } });
    fireEvent.change(screen.getByLabelText('实际剂量'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('剂量单位'), { target: { value: '滴' } });
    fireEvent.change(screen.getByLabelText('实际发生时间'), { target: { value: '2026-08-13T06:30' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '已实际服用' } });
    expect(screen.queryByText(/建议|推荐|应服|剂量计算/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(api.editCareEvent).toHaveBeenCalledWith(ids.medication, {
      expectedVersion: 2,
      event: {
        eventType: 'medication',
        occurredAt: new Date('2026-08-13T06:30').toISOString(),
        note: '已实际服用',
        action: { kind: 'medication', medicationName: '维生素 D3', dose: 1, doseUnit: '滴' },
      },
    }));
  });

  it('requires explicit confirmation before undoing an older record', async () => {
    const { api } = await openOnlyDetail(details[1]!);
    fireEvent.click(screen.getByRole('button', { name: '撤销此记录' }));
    expect(api.undoCareEvent).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog', { name: '确认撤销历史记录' });
    expect(within(confirmation).getByText('撤销会保留原记录和修订历史，不会删除事实。')).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(api.undoCareEvent).toHaveBeenCalledWith(ids.diaper, { expectedVersion: 2 }));
  });

  it('does not misreport a committed undo when derived-view refresh fails', async () => {
    const getCareSummary = vi.fn()
      .mockResolvedValueOnce(emptySummary)
      .mockRejectedValueOnce(new Error('refresh failed'));
    const { api } = await openOnlyDetail(details[1]!, { getCareSummary });
    fireEvent.click(screen.getByRole('button', { name: '撤销此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    expect(await screen.findByText('记录已撤销，护理视图刷新失败，请手动刷新')).toBeInTheDocument();
    expect(api.undoCareEvent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '撤销此记录' })).not.toBeInTheDocument();
  });

  it('reloads the advanced version after a successful edit', async () => {
    const updated = { ...details[0]!, version: 3, note: 'updated note' };
    const getCareEventDetail = vi.fn()
      .mockResolvedValueOnce(details[0])
      .mockResolvedValueOnce(updated);
    await openOnlyDetail(details[0]!, { getCareEventDetail });
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('版本 3')).toBeInTheDocument();
    expect(screen.getByText('备注 updated note')).toBeInTheDocument();
    expect(getCareEventDetail).toHaveBeenCalledTimes(2);
  });

  it('keeps the committed version when the following detail refresh fails', async () => {
    const getCareEventDetail = vi.fn()
      .mockResolvedValueOnce(details[0])
      .mockRejectedValueOnce(new Error('refresh failed'));
    const { api } = await openOnlyDetail(details[0]!, { getCareEventDetail });
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('记录已保存，详情刷新失败，请关闭后重试')).toBeInTheDocument();
    expect(screen.getByText('版本 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销此记录' }));
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    await waitFor(() => expect(api.undoCareEvent).toHaveBeenCalledWith(ids.feeding, { expectedVersion: 3 }));
  });

  it('refreshes stale detail while preserving the typed edit draft', async () => {
    const latest = { ...details[0]!, version: 3 };
    const getCareEventDetail = vi.fn()
      .mockResolvedValueOnce(details[0])
      .mockResolvedValueOnce(latest)
      .mockResolvedValueOnce(latest)
      .mockResolvedValue({ ...latest, version: 4 });
    const editCareEvent = vi.fn()
      .mockRejectedValueOnce(new BabyCareApiError('care_state_conflict', 'stale version'))
      .mockRejectedValueOnce(new BabyCareApiError('care_state_conflict', 'stale version'))
      .mockResolvedValueOnce({ id: ids.feeding, eventType: 'feeding' as const, status: 'active' as const, version: 4 });
    const { api } = await openOnlyDetail(details[0]!, { getCareEventDetail, editCareEvent });
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '88' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('记录已被其他照护者修改，请刷新后确认')).toBeInTheDocument();
    expect(screen.getByLabelText('实际喝了（ml）')).toHaveValue(88);
    expect(screen.getByText('最新版本 3，当前草稿基于版本 2')).toBeInTheDocument();
    expect(getCareEventDetail).toHaveBeenCalledTimes(2);
    expect(api.getCareEventRevisions).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(editCareEvent).toHaveBeenCalledTimes(2));
    expect(editCareEvent.mock.calls[1]![1]).toEqual(expect.objectContaining({ expectedVersion: 2 }));
    expect(screen.getByLabelText('实际喝了（ml）')).toHaveValue(88);

    fireEvent.click(screen.getByRole('button', { name: '确认以最新版本为基础' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(editCareEvent).toHaveBeenCalledTimes(3));
    expect(editCareEvent.mock.calls[2]![1]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
    expect(await screen.findByText('版本 4')).toBeInTheDocument();
  }, 10_000);

  it('resets the editor when selecting a different timeline event', async () => {
    const first = details[0]!;
    const second = details[1]!;
    const api = makeApi({
      getCareTimeline: vi.fn(async () => ({ items: [first, second], nextCursor: null })),
      getCareEventDetail: vi.fn(async (eventId: string) => details.find((item) => item.id === eventId)),
    });
    renderApp(api);
    const detailButtons = await screen.findAllByRole('button', { name: '查看详情' });
    fireEvent.click(detailButtons[0]!);
    await screen.findByRole('region', { name: '护理记录详情' });
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '88' } });

    fireEvent.click(detailButtons[1]!);
    expect(await screen.findByText('便便颜色 黄色')).toBeInTheDocument();
    expect(screen.queryByLabelText('实际喝了（ml）')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '修改此记录' }));
    expect(screen.getByLabelText('便便颜色')).toHaveValue('黄色');
  });

  it('refreshes timeline and pinned handoff after a recent correction', async () => {
    const getCareTimeline = vi.fn(async () => ({ items: [], nextCursor: null }));
    const getLatestCareHandoff = vi.fn(async () => null);
    const createFeedingSession = vi.fn(async () => ({
      id: ids.feeding,
      occurredAt: '2026-08-13T06:00:00.000Z',
      status: 'active' as const,
    }));
    const api = makeApi({ getCareTimeline, getLatestCareHandoff, createFeedingSession });
    renderApp(api);
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
    fireEvent.click(screen.getByRole('button', { name: '配方奶' }));
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    await screen.findByText('刚刚记录：配方奶 60ml');
    const timelineCallsBeforeEdit = getCareTimeline.mock.calls.length;
    const handoffCallsBeforeEdit = getLatestCareHandoff.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(getCareTimeline.mock.calls.length).toBeGreaterThan(timelineCallsBeforeEdit));
    expect(getLatestCareHandoff.mock.calls.length).toBeGreaterThan(handoffCallsBeforeEdit);
  });

  it('refreshes a recent conflict and requires explicit reconciliation before retrying', async () => {
    const createFeedingSession = vi.fn(async () => ({
      id: ids.feeding,
      occurredAt: '2026-08-13T06:00:00.000Z',
      status: 'active' as const,
    }));
    const getCareEventDetail = vi.fn(async () => ({ ...details[0]!, version: 3 }));
    const editCareEvent = vi.fn()
      .mockRejectedValueOnce(new BabyCareApiError('care_state_conflict', 'stale version'))
      .mockResolvedValueOnce({ id: ids.feeding, eventType: 'feeding' as const, status: 'active' as const, version: 4 });
    const api = makeApi({ createFeedingSession, getCareEventDetail, editCareEvent });
    renderApp(api);
    await screen.findByRole('heading', { name: '护理状态' });
    fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
    fireEvent.click(screen.getByRole('button', { name: '配方奶' }));
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));
    await screen.findByText('刚刚记录：配方奶 60ml');
    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    fireEvent.change(screen.getByLabelText('实际喝了（ml）'), { target: { value: '88' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('记录已被其他照护者修改，请刷新后确认')).toBeInTheDocument();
    expect(getCareEventDetail).toHaveBeenCalledWith(ids.feeding);
    expect(screen.getByLabelText('实际喝了（ml）')).toHaveValue(88);
    expect(screen.getByText('最新版本 3，当前草稿基于版本 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认以最新版本为基础' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(editCareEvent).toHaveBeenCalledTimes(2));
    expect(editCareEvent.mock.calls[1]![1]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
  });

  it('renders attributable, typed before/after revisions without raw JSON', async () => {
    const revisions = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        eventId: ids.feeding,
        action: 'edit' as const,
        actorUserId: '77777777-7777-4777-8777-777777777777',
        actorDisplayName: 'Nanny',
        createdAt: '2026-08-13T06:10:00.000Z',
        fromVersion: 1,
        toVersion: 2,
        before: {
          eventType: 'feeding' as const,
          occurredAt: '2026-08-13T06:00:00.000Z',
          note: 'before note',
          components: [{ kind: 'bottle' as const, liquidType: 'formula' as const, amountMl: 60, bottleCapacityMl: 150 }],
          relatedActions: [{ kind: 'burping' as const }],
        },
        after: {
          eventType: 'feeding' as const,
          occurredAt: '2026-08-13T06:05:00.000Z',
          note: 'after note',
          components: [{ kind: 'bottle' as const, liquidType: 'formula' as const, amountMl: 70, bottleCapacityMl: 150 }],
          relatedActions: [{ kind: 'spit_up' as const, amount: 'small' as const }],
        },
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        eventId: ids.feeding,
        action: 'void' as const,
        actorUserId: session.userId,
        actorDisplayName: 'Dad',
        createdAt: '2026-08-13T06:20:00.000Z',
        fromVersion: 2,
        toVersion: 3,
        before: { status: 'active' as const },
        after: { status: 'voided' as const },
      },
    ];
    const { detail } = await openOnlyDetail(details[0]!, {
      getCareEventRevisions: vi.fn(async () => revisions),
    });
    const history = within(detail).getByRole('region', { name: '修订历史' });
    expect(within(history).getByText('Nanny · 修改 · 版本 1 → 2 · 2026-08-13 06:10')).toBeInTheDocument();
    expect(within(history).getByText('修改前：配方奶实际喝了 60ml（奶瓶容量 150ml，不计入摄入量） · 拍嗝 · 时间 2026-08-13 06:00 · 备注 before note')).toBeInTheDocument();
    expect(within(history).getByText('修改后：配方奶实际喝了 70ml（奶瓶容量 150ml，不计入摄入量） · 少量吐奶 · 时间 2026-08-13 06:05 · 备注 after note')).toBeInTheDocument();
    expect(within(history).getByText('Dad · 撤销 · 版本 2 → 3 · 2026-08-13 06:20')).toBeInTheDocument();
    expect(within(history).getByText('修改前：有效记录')).toBeInTheDocument();
    expect(within(history).getByText('修改后：已撤销')).toBeInTheDocument();
    for (const rawJsonToken of ['{', '}', '[', ']', '"']) {
      expect(history).not.toHaveTextContent(rawJsonToken);
    }
  });
});
