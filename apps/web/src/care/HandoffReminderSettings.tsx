import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandoffReminderRuleInput, ReplaceHandoffReminderRulesInput } from '@baby-care/contracts';
import type { BabyCareApi, HandoffReminderState } from '../api-client.js';

const MAX_REMINDER_RULES = 8;
const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
] as const;

function canUseReminders(api: BabyCareApi): api is BabyCareApi & {
  getHandoffReminders: () => Promise<HandoffReminderState>;
  replaceHandoffReminders: (input: ReplaceHandoffReminderRulesInput) => Promise<HandoffReminderState>;
} {
  return typeof api.getHandoffReminders === 'function' && typeof api.replaceHandoffReminders === 'function';
}

export function HandoffReminderSettings({
  api,
  onTakeOver,
  takeoverVersion,
}: {
  api: BabyCareApi;
  onTakeOver: () => Promise<boolean>;
  takeoverVersion: number;
}) {
  const [rules, setRules] = useState<HandoffReminderRuleInput[]>([]);
  const [shouldPrompt, setShouldPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [oversized, setOversized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const busyRef = useRef(false);
  const takeoverSuppressedRef = useRef(false);

  const applyState = useCallback((state: HandoffReminderState, replaceDraft = true) => {
    setShouldPrompt((previous) => {
      if (!state.shouldPrompt) {
        takeoverSuppressedRef.current = false;
        setDismissed(false);
      } else if (!previous && !takeoverSuppressedRef.current) {
        setDismissed(false);
      }
      return state.shouldPrompt;
    });
    if (state.rules.length > MAX_REMINDER_RULES) {
      setRules([]);
      setOversized(true);
      draftDirtyRef.current = false;
      setMessage('服务器返回了超过 8 条提醒，已禁止覆盖保存');
    } else {
      if (replaceDraft) setRules(state.rules);
      setOversized(false);
      setMessage(null);
    }
    hasLoadedRef.current = true;
    setLoadState('ready');
  }, []);

  const loadReminders = useCallback(async () => {
    if (busyRef.current) return;
    const requestId = ++requestGenerationRef.current;
    if (!canUseReminders(api)) {
      if (!hasLoadedRef.current) setLoadState('error');
      setMessage('提醒功能暂时无法加载');
      return;
    }
    if (!hasLoadedRef.current) setLoadState('loading');
    try {
      const state = await api.getHandoffReminders();
      if (requestId !== requestGenerationRef.current) return;
      applyState(state, !hasLoadedRef.current || !draftDirtyRef.current);
    } catch {
      if (requestId !== requestGenerationRef.current) return;
      if (!hasLoadedRef.current) setLoadState('error');
      setMessage(hasLoadedRef.current ? '提醒状态刷新失败，已保留当前设置' : '提醒功能暂时无法加载');
    }
  }, [api, applyState]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const scheduleNextMinute = () => {
      if (!active) return;
      const delay = 60_000 - (Date.now() % 60_000) + 25;
      timer = window.setTimeout(() => {
        void loadReminders().finally(scheduleNextMinute);
      }, delay);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadReminders();
    };

    void loadReminders();
    scheduleNextMinute();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      active = false;
      requestGenerationRef.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, [loadReminders]);

  useEffect(() => {
    if (takeoverVersion > 0) {
      takeoverSuppressedRef.current = true;
      setDismissed(true);
    }
  }, [takeoverVersion]);

  function updateRule(index: number, next: HandoffReminderRuleInput) {
    draftDirtyRef.current = true;
    setRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? next : rule));
    setMessage(null);
  }

  function toggleWeekday(index: number, weekday: number) {
    const rule = rules[index];
    if (!rule) return;
    const selected = rule.weekdays.includes(weekday);
    if (selected && rule.weekdays.length === 1) return;
    const weekdays = selected
      ? rule.weekdays.filter((value) => value !== weekday)
      : [...rule.weekdays, weekday].sort((left, right) => left - right);
    updateRule(index, { ...rule, weekdays });
  }

  async function save() {
    if (!canUseReminders(api) || loadState !== 'ready' || oversized || rules.length > MAX_REMINDER_RULES) return;
    setBusy(true);
    busyRef.current = true;
    requestGenerationRef.current += 1;
    setMessage(null);
    try {
      const state = await api.replaceHandoffReminders({ rules });
      draftDirtyRef.current = false;
      applyState(state, true);
      if (state.rules.length <= MAX_REMINDER_RULES) setMessage('提醒设置已保存');
    } catch {
      setMessage('提醒设置保存失败，可重试');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function takeOver() {
    setBusy(true);
    try {
      const succeeded = await onTakeOver();
      if (succeeded) {
        takeoverSuppressedRef.current = true;
        setDismissed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="handoff-reminders" aria-labelledby="handoff-reminders-title">
      <div className="care-panel-header">
        <div>
          <h3 id="handoff-reminders-title">交接提醒</h3>
          <p className="muted">可选的屏幕提示，不会生成护理事实或交接点。</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={busy || loadState !== 'ready' || oversized || rules.length >= MAX_REMINDER_RULES}
          onClick={() => {
            draftDirtyRef.current = true;
            setRules((current) => [
              ...current,
              { localTime: '08:00', weekdays: [1, 2, 3, 4, 5, 6, 7], enabled: true },
            ]);
            setMessage(null);
          }}
        >
          新增提醒
        </button>
      </div>

      {shouldPrompt && !dismissed ? (
        <aside className="reminder-prompt" role="region" aria-label="交接提醒提示">
          <strong>现在可以查看交接摘要</strong>
          <p>提醒仅用于查看工作台，不代表已经完成交接。</p>
          <div className="choice-row">
            <button type="button" className="primary" disabled={busy} onClick={() => void takeOver()}>我来接手</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setDismissed(true)}>暂时忽略</button>
          </div>
        </aside>
      ) : null}

      {loadState === 'error' ? (
        <button type="button" className="secondary reminder-retry" onClick={() => void loadReminders()}>
          重试加载提醒
        </button>
      ) : null}
      {rules.length === 0 && loadState === 'ready' && !oversized ? <p className="muted">尚未设置提醒</p> : null}
      <div className="reminder-rule-list">
        {rules.map((rule, index) => (
          <fieldset className="reminder-rule" key={index} disabled={busy}>
            <legend>提醒 {index + 1}</legend>
            <label>
              时间
              <input
                type="time"
                aria-label={`提醒 ${index + 1} 时间`}
                value={rule.localTime}
                onChange={(event) => updateRule(index, { ...rule, localTime: event.target.value })}
              />
            </label>
            <div className="weekday-options" aria-label={`提醒 ${index + 1} 星期`}>
              {WEEKDAYS.map((weekday) => (
                <label className="weekday-option" key={weekday.value}>
                  <input
                    type="checkbox"
                    checked={rule.weekdays.includes(weekday.value)}
                    onChange={() => toggleWeekday(index, weekday.value)}
                  />
                  <span>{weekday.label}</span>
                </label>
              ))}
            </div>
            <div className="reminder-rule-actions">
              <label className="toggle-option">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => updateRule(index, { ...rule, enabled: event.target.checked })}
                />
                启用
              </label>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  draftDirtyRef.current = true;
                  setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
                  setMessage(null);
                }}
              >
                删除提醒 {index + 1}
              </button>
            </div>
          </fieldset>
        ))}
      </div>

      <div className="reminder-save-row">
        <button
          type="button"
          className="primary"
          disabled={busy || loadState !== 'ready' || oversized}
          onClick={() => void save()}
        >
          保存提醒设置
        </button>
        <p className="inline-message care-message" role="status" aria-live="polite">
          {message ?? (loadState === 'loading' ? '正在加载提醒设置…' : `最多可设置 ${MAX_REMINDER_RULES} 条`)}
        </p>
      </div>
    </div>
  );
}
