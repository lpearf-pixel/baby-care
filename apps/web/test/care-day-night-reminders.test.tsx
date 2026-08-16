import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareHandoffBriefingDto } from '@baby-care/contracts';
import { BabyCareApiError, type BabyCareApi, type HandoffReminderState } from '../src/api-client.js';
import appCss from '../src/app.css?inline';
import { CareWorkspace } from '../src/care/CareWorkspace.js';

const DISPLAY_MODE_KEY = 'baby-care.display-mode.v1';

const summary = {
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

const checkpointBriefing: CareHandoffBriefingDto = {
  checkpoint: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    occurredAt: '2026-08-13T08:00:00.000Z',
    createdAt: '2026-08-13T08:00:00.000Z',
    actorUserId: '11111111-1111-4111-8111-111111111111',
    actorDisplayName: 'Dad',
    source: 'manual' as const,
  },
  previousCheckpoint: null,
  window: {
    mode: 'rolling_24h' as const,
    from: '2026-08-12T08:00:00.000Z',
    to: '2026-08-13T08:00:00.000Z',
  },
  careState: summary,
  feeding: {
    bottleTotalMl: 0,
    expressedBreastMilkMl: 0,
    formulaMl: 0,
    directBreastfeedingSessions: 0,
    directBreastfeedingMinutes: 0,
  },
  diapers: { urine: 0, stool: 0, urineStool: 0 },
  sleep: { intervals: 0, completedMinutes: 0 },
  notableEvents: [],
  notableEventCount: 0,
  actorActivity: [],
  corrections: [],
  correctionCount: 0,
};

type MediaListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialDark = false) {
  let dark = initialDark;
  const listeners = new Set<MediaListener>();
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' && dark,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: MediaListener) => listeners.delete(listener),
    addListener: (listener: MediaListener) => listeners.add(listener),
    removeListener: (listener: MediaListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  }));
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
  return {
    setDark(next: boolean) {
      dark = next;
      const event = { matches: dark, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
  };
}

function makeApi(overrides: Partial<BabyCareApi> = {}): BabyCareApi {
  return {
    getCareSummary: vi.fn(async () => summary),
    getLatestCareHandoff: vi.fn(async () => null),
    getCareHandoffSummary: vi.fn(async () => checkpointBriefing),
    createCareHandoff: vi.fn(async () => checkpointBriefing),
    getHandoffReminders: vi.fn(async () => ({ rules: [], shouldPrompt: false })),
    replaceHandoffReminders: vi.fn(async (input) => ({ ...input, shouldPrompt: false })),
    getCareTimeline: vi.fn(async () => ({ items: [], nextCursor: null })),
    getFeedingQuickValues: vi.fn(async (liquidType) => ({ liquidType, values: [60] })),
    ...overrides,
  } as BabyCareApi;
}

function renderWorkspace(api = makeApi()) {
  return render(<CareWorkspace api={api} />);
}

beforeEach(() => {
  const style = document.createElement('style');
  style.dataset.careTestStyles = 'true';
  style.textContent = appCss;
  document.head.append(style);
  localStorage.clear();
  document.documentElement.removeAttribute('data-care-theme');
  installMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.querySelectorAll('style[data-care-test-styles]').forEach((style) => style.remove());
  document.documentElement.removeAttribute('data-care-theme');
  vi.restoreAllMocks();
});

describe('M3 low-disturbance care display mode', () => {
  it('falls back from invalid storage to auto and follows color-scheme changes', async () => {
    localStorage.setItem(DISPLAY_MODE_KEY, 'sepia');
    const media = installMatchMedia(false);
    renderWorkspace();

    const auto = await screen.findByRole('button', { name: '自动' });
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(DISPLAY_MODE_KEY)).toBe('auto');
    expect(document.documentElement).toHaveAttribute('data-care-theme', 'day');

    media.setDark(true);
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-care-theme', 'night'));
    media.setDark(false);
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-care-theme', 'day'));
  });

  it('persists manual day and night overrides in the exact local-only key', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: '夜间' }));

    expect(localStorage.getItem(DISPLAY_MODE_KEY)).toBe('night');
    expect(document.documentElement).toHaveAttribute('data-care-theme', 'night');

    cleanup();
    installMatchMedia(false);
    renderWorkspace();
    expect(await screen.findByRole('button', { name: '夜间' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement).toHaveAttribute('data-care-theme', 'night');

    fireEvent.click(screen.getByRole('button', { name: '日间' }));
    expect(localStorage.getItem(DISPLAY_MODE_KEY)).toBe('day');
    expect(document.documentElement).toHaveAttribute('data-care-theme', 'day');
  });

  it('keeps warning dialog content visible in night mode without playing sound', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const createFeedingSession = vi.fn(async () => {
      throw new BabyCareApiError('care_confirmation_required', 'Confirmation required', {
        warnings: [{ code: 'unusual_value', summary: '这个奶量与近期记录差异较大' }],
      });
    });
    renderWorkspace(makeApi({ createFeedingSession }));
    fireEvent.click(await screen.findByRole('button', { name: '夜间' }));
    fireEvent.click(screen.getByRole('button', { name: '喂奶' }));
    fireEvent.click(screen.getByRole('button', { name: '配方奶' }));
    fireEvent.change(await screen.findByLabelText('实际喝了（ml）'), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: '保存瓶喂' }));

    const dialog = await screen.findByRole('dialog', { name: '确认这条护理记录' });
    expect(within(dialog).getByText('这个奶量与近期记录差异较大')).toBeVisible();
    expect(document.documentElement).toHaveAttribute('data-care-theme', 'night');
    expect(document.querySelector('audio')).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});

describe('M3 non-authoritative handoff reminders', () => {
  it('dismisses a visible reminder without creating a checkpoint', async () => {
    const createCareHandoff = vi.fn(async () => checkpointBriefing);
    renderWorkspace(makeApi({
      createCareHandoff,
      getHandoffReminders: vi.fn(async () => ({
        rules: [{ localTime: '08:00', weekdays: [1, 2, 3, 4, 5], enabled: true }],
        shouldPrompt: true,
      })),
    }));

    const prompt = await screen.findByRole('region', { name: '交接提醒提示' });
    expect(within(prompt).getByText('提醒仅用于查看工作台，不代表已经完成交接。')).toBeInTheDocument();
    expect(within(prompt).getByRole('button', { name: '我来接手' })).toBeInTheDocument();
    fireEvent.click(within(prompt).getByRole('button', { name: '暂时忽略' }));

    expect(screen.queryByRole('region', { name: '交接提醒提示' })).not.toBeInTheDocument();
    expect(createCareHandoff).not.toHaveBeenCalled();
  });

  it('creates a checkpoint only when takeover is explicitly selected from the prompt', async () => {
    const createCareHandoff = vi.fn(async () => checkpointBriefing);
    renderWorkspace(makeApi({
      createCareHandoff,
      getHandoffReminders: vi.fn(async () => ({
        rules: [{ localTime: '08:00', weekdays: [1], enabled: true }],
        shouldPrompt: true,
      })),
    }));

    const prompt = await screen.findByRole('region', { name: '交接提醒提示' });
    fireEvent.click(within(prompt).getByRole('button', { name: '我来接手' }));
    await waitFor(() => expect(createCareHandoff).toHaveBeenCalledTimes(1));
  });

  it('keeps the prompt visible when takeover fails and clears it after either explicit entry succeeds', async () => {
    const createCareHandoff = vi.fn()
      .mockRejectedValueOnce(new BabyCareApiError('request_failed', 'offline'))
      .mockResolvedValueOnce(checkpointBriefing);
    renderWorkspace(makeApi({
      createCareHandoff,
      getHandoffReminders: vi.fn(async () => ({
        rules: [{ localTime: '08:00', weekdays: [1], enabled: true }],
        shouldPrompt: true,
      })),
    }));

    const prompt = await screen.findByRole('region', { name: '交接提醒提示' });
    fireEvent.click(within(prompt).getByRole('button', { name: '我来接手' }));
    expect(await screen.findByText('交接记录失败，可重试')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '交接提醒提示' })).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: '交接摘要' });
    fireEvent.click(within(panel).getAllByRole('button', { name: '我来接手' })[0]!);
    await waitFor(() => expect(createCareHandoff).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('region', { name: '交接提醒提示' })).not.toBeInTheDocument());
  });

  it('does not revive the current prompt when a pre-takeover reminder read resolves late', async () => {
    let resolveRead!: (state: HandoffReminderState) => void;
    const getHandoffReminders = vi.fn(() => new Promise<HandoffReminderState>((resolve) => {
      resolveRead = resolve;
    }));
    const createCareHandoff = vi.fn(async () => checkpointBriefing);
    renderWorkspace(makeApi({ getHandoffReminders, createCareHandoff }));

    const panel = await screen.findByRole('region', { name: '交接摘要' });
    fireEvent.click(within(panel).getByRole('button', { name: '我来接手' }));
    expect(await screen.findByText('交接已记录')).toBeInTheDocument();

    resolveRead({
      rules: [{ localTime: '08:00', weekdays: [1], enabled: true }],
      shouldPrompt: true,
    });
    await act(async () => Promise.resolve());

    expect(createCareHandoff).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: '交接提醒提示' })).not.toBeInTheDocument();
  });

  it('does not enable replace-all after the initial reminder read fails', async () => {
    const replaceHandoffReminders = vi.fn();
    renderWorkspace(makeApi({
      getHandoffReminders: vi.fn(async () => {
        throw new BabyCareApiError('request_failed', 'offline');
      }),
      replaceHandoffReminders,
    }));

    expect(await screen.findByText('提醒功能暂时无法加载')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: '保存提醒设置' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(replaceHandoffReminders).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重试加载提醒' })).toBeInTheDocument();
  });

  it('blocks destructive replacement if a legacy response contains more than eight rules', async () => {
    const rules = Array.from({ length: 9 }, (_, index) => ({
      localTime: `${String(index + 8).padStart(2, '0')}:00`,
      weekdays: [1],
      enabled: true,
    }));
    const replaceHandoffReminders = vi.fn();
    renderWorkspace(makeApi({
      getHandoffReminders: vi.fn(async () => ({ rules, shouldPrompt: false })),
      replaceHandoffReminders,
    }));

    expect(await screen.findByText('服务器返回了超过 8 条提醒，已禁止覆盖保存')).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/提醒 \d+ 时间/)).toHaveLength(0);
    const save = screen.getByRole('button', { name: '保存提醒设置' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(replaceHandoffReminders).not.toHaveBeenCalled();
  });

  it('refreshes reminder visibility on minute boundaries and stops after unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T08:00:30.000Z'));
    const getHandoffReminders = vi.fn()
      .mockResolvedValueOnce({ rules: [], shouldPrompt: false })
      .mockResolvedValueOnce({ rules: [], shouldPrompt: true })
      .mockResolvedValueOnce({ rules: [], shouldPrompt: false });
    const view = renderWorkspace(makeApi({ getHandoffReminders }));
    await act(async () => Promise.resolve());
    expect(getHandoffReminders).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(30_050));
    expect(getHandoffReminders).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: '交接提醒提示' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(getHandoffReminders).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('region', { name: '交接提醒提示' })).not.toBeInTheDocument();

    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(getHandoffReminders).toHaveBeenCalledTimes(3);
  });

  it('does not overwrite an unsaved reminder draft during a minute refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T08:00:30.000Z'));
    const getHandoffReminders = vi.fn()
      .mockResolvedValueOnce({
        rules: [{ localTime: '08:00', weekdays: [1], enabled: true }],
        shouldPrompt: false,
      })
      .mockResolvedValueOnce({
        rules: [{ localTime: '09:00', weekdays: [1], enabled: true }],
        shouldPrompt: true,
      });
    renderWorkspace(makeApi({ getHandoffReminders }));
    await act(async () => Promise.resolve());

    const time = screen.getByLabelText('提醒 1 时间');
    fireEvent.change(time, { target: { value: '07:30' } });
    await act(async () => vi.advanceTimersByTimeAsync(30_050));

    expect(getHandoffReminders).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('提醒 1 时间')).toHaveValue('07:30');
    expect(screen.getByRole('region', { name: '交接提醒提示' })).toBeInTheDocument();
  });

  it('loads and replaces no more than eight rules for the current caregiver', async () => {
    const rules = Array.from({ length: 8 }, (_, index) => ({
      localTime: `${String(index + 8).padStart(2, '0')}:00`,
      weekdays: [1, 2, 3, 4, 5],
      enabled: true,
    }));
    const replaceHandoffReminders = vi.fn(async (input) => ({ ...input, shouldPrompt: false }));
    renderWorkspace(makeApi({
      getHandoffReminders: vi.fn(async () => ({ rules, shouldPrompt: false })),
      replaceHandoffReminders,
    }));

    expect(await screen.findAllByLabelText(/提醒 \d+ 时间/)).toHaveLength(8);
    expect(screen.getByRole('button', { name: '新增提醒' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('提醒 1 时间'), { target: { value: '07:30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存提醒设置' }));

    await waitFor(() => expect(replaceHandoffReminders).toHaveBeenCalledTimes(1));
    const input = vi.mocked(replaceHandoffReminders).mock.calls[0]![0];
    expect(input.rules).toHaveLength(8);
    expect(input.rules[0]).toEqual({ localTime: '07:30', weekdays: [1, 2, 3, 4, 5], enabled: true });
    expect(screen.getByText('提醒设置已保存')).toHaveAttribute('aria-live', 'polite');
  });

  it('locks reminder controls while replace-all is in flight', async () => {
    let resolveSave!: (state: { rules: { localTime: string; weekdays: number[]; enabled: boolean }[]; shouldPrompt: boolean }) => void;
    const replaceHandoffReminders = vi.fn(() => new Promise<HandoffReminderState>((resolve) => {
      resolveSave = resolve;
    }));
    renderWorkspace(makeApi({
      getHandoffReminders: vi.fn(async () => ({
        rules: [{ localTime: '08:00', weekdays: [1], enabled: true }],
        shouldPrompt: false,
      })),
      replaceHandoffReminders,
    }));

    const time = await screen.findByLabelText('提醒 1 时间');
    fireEvent.click(screen.getByRole('button', { name: '保存提醒设置' }));
    expect(time.closest('fieldset')).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除提醒 1' })).toBeDisabled();

    resolveSave({ rules: [{ localTime: '08:00', weekdays: [1], enabled: true }], shouldPrompt: false });
    await waitFor(() => expect(screen.getByText('提醒设置已保存')).toBeInTheDocument());
  });

  it('uses quiet live feedback, 44px controls, and a reduced-motion stylesheet', async () => {
    renderWorkspace();
    const save = await screen.findByRole('button', { name: '保存提醒设置' });
    expect(getComputedStyle(save).minHeight).toBe('44px');
    const refresh = screen.getByRole('button', { name: '刷新护理状态' });
    expect(getComputedStyle(refresh).minHeight).toBe('44px');
    expect(document.querySelector('audio')).toBeNull();

    const cssRules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    });
    expect(cssRules.some((rule) => rule.cssText.includes('prefers-reduced-motion: reduce'))).toBe(true);
  });
});
