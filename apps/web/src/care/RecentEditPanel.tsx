import { useState } from 'react';
import type { EditCareEventInput } from '@baby-care/contracts';

function isoToLocalInput(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function currentTime(input: EditCareEventInput): string {
  return input.eventType === 'sleep' ? input.startedAt : input.occurredAt;
}

export function RecentEditPanel({
  input,
  busy,
  onSave,
  onCancel,
}: {
  input: EditCareEventInput;
  busy: boolean;
  onSave: (input: EditCareEventInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [time, setTime] = useState(() => isoToLocalInput(currentTime(input)));

  function nextInput(): EditCareEventInput | null {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return null;
    const iso = date.toISOString();
    if (input.eventType === 'sleep') return { ...input, startedAt: iso };
    return { ...input, occurredAt: iso } as EditCareEventInput;
  }

  return (
    <section className="panel care-form" aria-label="修改最近护理记录">
      <h3>修改最近记录</h3>
      <label>
        实际发生时间
        <input type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      <div className="choice-row">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            const next = nextInput();
            if (next) void onSave(next);
          }}
        >
          保存修改
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </section>
  );
}
