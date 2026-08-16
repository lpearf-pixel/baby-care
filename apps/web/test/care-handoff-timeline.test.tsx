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

const checkpoint = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  occurredAt: '2026-08-13T08:00:00.000Z',
  createdAt: '2026-08-13T08:00:10.000Z',
  actorUserId: session.userId,
  actorDisplayName: 'Dad',
  source: 'manual',
} as const;

const previousCheckpoint = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  occurredAt: '2026-08-13T06:00:00.000Z',
  createdAt: '2026-08-13T06:00:05.000Z',
  actorUserId: '99999999-9999-4999-8999-999999999999',
  actorDisplayName: 'Mom',
  source: 'manual',
} as const;

function timelineBase(id: string, occurredAt: string) {
  return {
    id,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    status: 'active' as const,
    source: 'manual' as const,
    actorUserId: session.userId,
    actorDisplayName: 'Dad',
    note: null,
    version: 1,
    isBackfilled: false,
  };
}

const timelinePageOne = [
  {
    ...timelineBase('10000000-0000-4000-8000-000000000001', '2026-08-13T07:58:00.000Z'),
    eventType: 'feeding' as const,
    payload: {
      components: [
        { kind: 'bottle' as const, liquidType: 'formula' as const, amountMl: 70, bottleCapacityMl: 150 },
        { kind: 'direct_breastfeeding' as const, durationMinutes: 12 },
      ],
      relatedActions: [{ kind: 'burping' as const }],
    },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000002', '2026-08-13T07:52:00.000Z'),
    eventType: 'diaper' as const,
    actorUserId: '77777777-7777-4777-8777-777777777777',
    actorDisplayName: 'Nanny',
    payload: {
      kind: 'urine_stool' as const,
      stoolColor: 'yellow',
      stoolConsistency: 'seedy',
      stoolAmount: 'medium',
    },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000003', '2026-08-13T07:40:00.000Z'),
    eventType: 'sleep' as const,
    source: 'device' as const,
    actorUserId: null,
    actorDisplayName: null,
    isBackfilled: true,
    payload: {
      startedAt: '2026-08-13T07:10:00.000Z',
      endedAt: '2026-08-13T07:40:00.000Z',
    },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000004', '2026-08-13T07:35:00.000Z'),
    eventType: 'burping' as const,
    payload: { action: { kind: 'burping' as const } },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000005', '2026-08-13T07:30:00.000Z'),
    eventType: 'spit_up' as const,
    actorUserId: '77777777-7777-4777-8777-777777777777',
    actorDisplayName: 'Nanny',
    payload: { action: { kind: 'spit_up' as const, amount: 'medium' as const } },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000006', '2026-08-13T07:25:00.000Z'),
    eventType: 'crying' as const,
    payload: { action: { kind: 'crying' as const, durationMinutes: 15 } },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000007', '2026-08-13T07:20:00.000Z'),
    eventType: 'bathing' as const,
    source: 'guardian' as const,
    actorUserId: null,
    actorDisplayName: null,
    payload: { action: { kind: 'bathing' as const } },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000008', '2026-08-13T07:15:00.000Z'),
    eventType: 'medication' as const,
    payload: {
      action: {
        kind: 'medication' as const,
        medicationName: 'Vitamin D',
        dose: 0.5,
        doseUnit: 'mL',
      },
    },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000009', '2026-08-13T07:10:00.000Z'),
    eventType: 'temperature' as const,
    payload: { measurement: { kind: 'temperature' as const, valueCelsius: 37.4, method: 'axillary' } },
  },
  {
    ...timelineBase('10000000-0000-4000-8000-000000000010', '2026-08-13T07:05:00.000Z'),
    eventType: 'weight' as const,
    source: 'import' as const,
    actorUserId: null,
    actorDisplayName: null,
    payload: { measurement: { kind: 'weight' as const, valueKg: 4.25 } },
  },
];

const timelinePageTwo = [
  {
    ...timelineBase('10000000-0000-4000-8000-000000000011', '2026-08-13T06:55:00.000Z'),
    eventType: 'feeding' as const,
    payload: {
      components: [{ kind: 'bottle' as const, liquidType: 'expressed_breast_milk' as const, amountMl: 50 }],
      relatedActions: [],
    },
  },
];

const rollingBriefing = {
  checkpoint,
  previousCheckpoint: null,
  window: {
    mode: 'rolling_24h' as const,
    from: '2026-08-12T08:00:00.000Z',
    to: '2026-08-13T08:00:00.000Z',
  },
  careState: summary,
  feeding: {
    bottleTotalMl: 420,
    expressedBreastMilkMl: 120,
    formulaMl: 300,
    directBreastfeedingSessions: 5,
    directBreastfeedingMinutes: 86,
  },
  diapers: { urine: 2, stool: 1, urineStool: 1 },
  sleep: { intervals: 4, completedMinutes: 190 },
  notableEvents: timelinePageOne.slice(0, 3),
  notableEventCount: 3,
  actorActivity: [
    { actorUserId: session.userId, actorDisplayName: 'Dad', eventCount: 6 },
    { actorUserId: '77777777-7777-4777-8777-777777777777', actorDisplayName: 'Nanny', eventCount: 4 },
  ],
  corrections: [
    {
      eventId: timelinePageOne[0]!.id,
      action: 'edit' as const,
      actorDisplayName: 'Nanny',
      createdAt: '2026-08-13T07:59:00.000Z',
    },
  ],
  correctionCount: 1,
} as const;

const checkpointBriefing = {
  ...rollingBriefing,
  previousCheckpoint,
  window: {
    mode: 'checkpoint' as const,
    from: previousCheckpoint.occurredAt,
    to: checkpoint.occurredAt,
  },
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
    getCareSummary: vi.fn(async () => summary),
    getFeedingQuickValues: vi.fn(async (liquidType: 'expressed_breast_milk' | 'formula') => ({ liquidType, values: [45, 60, 75] })),
    createFeedingSession: vi.fn(async () => ({ id: '55555555-5555-4555-8555-555555555555', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const })),
    createDiaper: vi.fn(async () => ({ id: '66666666-6666-4666-8666-666666666666', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, kind: 'urine' as const, stoolColor: null, stoolConsistency: null, stoolAmount: null, note: null })),
    startSleep: vi.fn(async () => ({ id: '77777777-7777-4777-8777-777777777777', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, startedAt: '2026-08-13T08:00:00.000Z', endedAt: null, note: null, version: 1 })),
    wakeSleep: vi.fn(async () => ({ id: '77777777-7777-4777-8777-777777777777', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, startedAt: '2026-08-13T07:30:00.000Z', endedAt: '2026-08-13T08:00:00.000Z', note: null, version: 2 })),
    createCareAction: vi.fn(async () => ({ id: '88888888-8888-4888-8888-888888888888', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, kind: 'burping' as const })),
    createMeasurement: vi.fn(async () => ({ id: '99999999-9999-4999-8999-999999999999', occurredAt: '2026-08-13T08:00:00.000Z', status: 'active' as const, kind: 'temperature' as const })),
    editCareEvent: vi.fn(async (eventId: string) => ({ id: eventId, eventType: 'feeding' as const, status: 'active' as const, version: 2 })),
    undoCareEvent: vi.fn(async (eventId: string) => ({ id: eventId, status: 'voided' as const })),
    getLatestCareHandoff: vi.fn(async () => rollingBriefing),
    getCareHandoffSummary: vi.fn(async () => checkpointBriefing),
    createCareHandoff: vi.fn(async () => checkpointBriefing),
    getCareTimeline: vi.fn(async () => ({ items: timelinePageOne, nextCursor: 'cursor-page-2' })),
    ...overrides,
  };
}

function renderApp(api: ReturnType<typeof makeApi>) {
  render(<App {...({ api } as unknown as Record<string, never>)} />);
}

afterEach(() => {
  cleanup();
});

describe('M3 handoff briefing and typed timeline', () => {
  it('renders the recent-24h briefing, separated feeding facts, typed timeline, and cursor continuation accessibly', async () => {
    const getCareTimeline = vi.fn()
      .mockResolvedValueOnce({ items: timelinePageOne, nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ items: timelinePageOne, nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ items: [timelinePageOne[0]!], nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ items: timelinePageTwo, nextCursor: null });
    const api = makeApi({ getCareTimeline });
    renderApp(api);

    expect(await screen.findByRole('heading', { name: '护理状态' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '交接摘要' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '护理时间线' })).toBeInTheDocument();
    expect(screen.getByText('最近24小时交接摘要')).toBeInTheDocument();
    expect(screen.getByText('窗口 2026-08-12 08:00 → 2026-08-13 08:00')).toBeInTheDocument();
    expect(screen.getByText('Dad 6 条 · Nanny 4 条')).toBeInTheDocument();
    expect(screen.getByText('最近修正 1 条 · Nanny edit')).toBeInTheDocument();
    expect(screen.getByText('总瓶喂 420ml')).toBeInTheDocument();
    expect(screen.getByText('母乳瓶喂 120ml')).toBeInTheDocument();
    expect(screen.getByText('配方奶 300ml')).toBeInTheDocument();
    expect(screen.getAllByText('亲喂 5次 · 86min').length).toBeGreaterThan(0);
    expect(document.querySelector('dl.facts')).not.toBeNull();
    expect(screen.getByRole('button', { name: '我来接手' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新交接摘要' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '喂奶' })).toBeEnabled();

    for (const text of [
      '2026-08-13 07:58',
      '配方奶 70ml · 亲喂 12min',
      '尿布 · 尿+便',
      '睡眠 30min',
      '拍嗝',
      '吐奶 · medium',
      '哭闹 15min',
      '洗澡',
      '喂药 · Vitamin D 0.5mL',
      '体温 37.4°C · axillary',
      '体重 4.25kg',
      '系统 · 设备记录 · 补记',
      '系统 · Guardian 记录',
      '系统 · 导入记录',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Dad · 手动记录').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nanny · 手动记录').length).toBeGreaterThan(0);

    expect(screen.queryByText(/150ml/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').every((element) => element.getAttribute('aria-live') === 'polite')).toBe(true);
    expect(document.querySelector('audio')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: '查看这24小时护理记录' }));
    await waitFor(() => expect(getCareTimeline).toHaveBeenLastCalledWith({
      category: 'all',
      from: '2026-08-12T08:00:00.000Z',
      to: '2026-08-13T08:00:00.000Z',
      limit: 20,
    }));

    fireEvent.click(screen.getByRole('button', { name: '只看喂养' }));
    await waitFor(() => expect(getCareTimeline).toHaveBeenLastCalledWith({
      category: 'feeding',
      from: '2026-08-12T08:00:00.000Z',
      to: '2026-08-13T08:00:00.000Z',
      limit: 20,
    }));

    fireEvent.click(screen.getByRole('button', { name: '加载更多护理记录' }));
    await waitFor(() => expect(getCareTimeline).toHaveBeenLastCalledWith({
      category: 'feeding',
      cursor: 'cursor-page-2',
      from: '2026-08-12T08:00:00.000Z',
      to: '2026-08-13T08:00:00.000Z',
      limit: 20,
    }));
    expect(await screen.findByText('母乳瓶喂 50ml')).toBeInTheDocument();
  });

  it('keeps a checkpoint briefing pinned on refresh instead of drifting to the latest window', async () => {
    const getLatestCareHandoff = vi.fn(async () => checkpointBriefing);
    const getCareHandoffSummary = vi.fn(async () => checkpointBriefing);
    const api = makeApi({
      getLatestCareHandoff,
      getCareHandoffSummary,
      getCareTimeline: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    renderApp(api);

    expect(await screen.findByText('交接窗口 2026-08-13 06:00 → 2026-08-13 08:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新交接摘要' }));

    await waitFor(() => expect(getCareHandoffSummary).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(getLatestCareHandoff).toHaveBeenCalledTimes(1);
    expect(screen.getByText('交接窗口 2026-08-13 06:00 → 2026-08-13 08:00')).toBeInTheDocument();
  });

  it('keeps a recent-24h briefing pinned to its checkpoint when refreshed', async () => {
    const getLatestCareHandoff = vi.fn(async () => rollingBriefing);
    const getCareHandoffSummary = vi.fn(async () => rollingBriefing);
    const api = makeApi({
      getLatestCareHandoff,
      getCareHandoffSummary,
      getCareTimeline: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    renderApp(api);

    expect(await screen.findByText('最近24小时交接摘要')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新交接摘要' }));

    await waitFor(() => expect(getCareHandoffSummary).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(getLatestCareHandoff).toHaveBeenCalledTimes(1);
  });

  it('reuses one handoff request id across retry while applying the returned briefing directly', async () => {
    let rejectFirst: ((error: unknown) => void) | null = null;
    const createCareHandoff = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject;
      }))
      .mockImplementation(async () => checkpointBriefing);
    const getCareHandoffSummary = vi.fn(async () => checkpointBriefing);
    const api = makeApi({ createCareHandoff, getCareHandoffSummary });
    renderApp(api);

    const button = await screen.findByRole('button', { name: '我来接手' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(createCareHandoff).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();

    const failFirst = rejectFirst as ((error: unknown) => void) | null;
    if (typeof failFirst === 'function') failFirst(new BabyCareApiError('request_failed', 'offline'));
    expect(await screen.findByText('交接记录失败，可重试')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '我来接手' }));
    await waitFor(() => expect(createCareHandoff).toHaveBeenCalledTimes(2));
    expect(createCareHandoff.mock.calls[1]![0].clientRequestId).toBe(createCareHandoff.mock.calls[0]![0].clientRequestId);
    expect(await screen.findByText('交接已记录')).toBeInTheDocument();
    expect(await screen.findByText('交接窗口 2026-08-13 06:00 → 2026-08-13 08:00')).toBeInTheDocument();
    expect(getCareHandoffSummary).toHaveBeenCalledTimes(0);
  });

  it('shows retry affordances for briefing and timeline read failures without disabling quick recording', async () => {
    const api = makeApi({
      getLatestCareHandoff: vi.fn(async () => {
        throw new Error('handoff read failed');
      }),
      getCareTimeline: vi.fn(async () => {
        throw new Error('timeline read failed');
      }),
    });
    renderApp(api);

    expect(await screen.findByRole('heading', { name: '护理状态' })).toBeInTheDocument();
    expect(await screen.findByText('交接摘要暂时无法加载')).toBeInTheDocument();
    expect(await screen.findByText('护理时间线暂时无法加载')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试交接摘要' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重试护理时间线' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '喂奶' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
    fireEvent.click(screen.getByRole('button', { name: '配方奶' }));
    expect(await screen.findByRole('button', { name: '保存瓶喂' })).toBeEnabled();
  });

  it('renders an empty-state handoff panel when no checkpoint exists yet', async () => {
    const api = makeApi({
      getLatestCareHandoff: vi.fn(async () => null),
      getCareTimeline: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    renderApp(api);

    expect(await screen.findByRole('heading', { name: '护理状态' })).toBeInTheDocument();
    expect(await screen.findByText('尚无交接记录')).toBeInTheDocument();
    expect(screen.queryByText('交接摘要暂时无法加载')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我来接手' })).toBeEnabled();
  });

  it('reloads the timeline with exactly one additional API call per click', async () => {
    const getCareTimeline = vi.fn(async () => ({ items: timelinePageOne, nextCursor: null }));
    const api = makeApi({ getCareTimeline });
    renderApp(api);

    await screen.findByRole('region', { name: '护理时间线' });
    await waitFor(() => expect(getCareTimeline).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '重试护理时间线' }));

    await waitFor(() => expect(getCareTimeline).toHaveBeenCalledTimes(2));
  });
});
