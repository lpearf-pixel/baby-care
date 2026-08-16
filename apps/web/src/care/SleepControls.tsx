import { useRef, useState } from 'react';
import type { StartSleepInput, WakeSleepInput } from '@baby-care/contracts';

function isoMinutesAgo(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function SleepControls({
  sleeping,
  busy,
  onStart,
  onWake,
}: {
  sleeping: boolean;
  busy: boolean;
  onStart: (input: StartSleepInput) => Promise<boolean>;
  onWake: (input: WakeSleepInput) => Promise<boolean>;
}) {
  const [custom, setCustom] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const requestId = useRef(crypto.randomUUID());

  async function submit(occurredAt: string) {
    const input = { occurredAt, clientRequestId: requestId.current };
    const saved = sleeping ? await onWake(input) : await onStart(input);
    if (saved) {
      requestId.current = crypto.randomUUID();
      setCustom(false);
      setCustomTime('');
    }
  }

  const choices = [
    { label: '现在', minutes: 0 },
    { label: '10分钟前', minutes: 10 },
    { label: '20分钟前', minutes: 20 },
    { label: '30分钟前', minutes: 30 },
  ] as const;

  return (
    <section className="panel care-form" aria-label="睡眠记录">
      <h3>{sleeping ? '记录醒来' : '开始睡觉'}</h3>
      <p className="muted">选择实际发生时间</p>
      <div className="choice-row sleep-choices">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void submit(isoMinutesAgo(choice.minutes))}
          >
            {choice.label}
          </button>
        ))}
        <button type="button" className="secondary" onClick={() => setCustom(true)}>自定义</button>
      </div>
      {custom ? (
        <div className="custom-time-row">
          <label>
            实际时间
            <input type="datetime-local" value={customTime} onChange={(event) => setCustomTime(event.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy || !customTime}
            onClick={() => {
              const occurredAt = localInputToIso(customTime);
              if (occurredAt) void submit(occurredAt);
            }}
          >
            保存时间
          </button>
        </div>
      ) : null}
    </section>
  );
}
