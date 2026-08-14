import { useRef, useState } from 'react';
import type { BottleLiquidType, CreateFeedingSessionInput } from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';

type FeedingMode = 'direct' | BottleLiquidType | null;

export function FeedingForm({
  api,
  busy,
  onSave,
}: {
  api: BabyCareApi;
  busy: boolean;
  onSave: (input: CreateFeedingSessionInput) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<FeedingMode>(null);
  const [quickValues, setQuickValues] = useState<number[]>([]);
  const [amount, setAmount] = useState('');
  const [duration, setDuration] = useState('');
  const requestId = useRef(crypto.randomUUID());

  async function chooseBottle(next: BottleLiquidType) {
    setMode(next);
    setAmount('');
    try {
      const result = await api.getFeedingQuickValues(next);
      setQuickValues(result.values);
    } catch {
      setQuickValues([]);
    }
  }

  async function submit() {
    const occurredAt = new Date().toISOString();
    let input: CreateFeedingSessionInput;
    if (mode === 'direct') {
      const minutes = Number(duration);
      if (!Number.isInteger(minutes) || minutes <= 0) return;
      input = {
        occurredAt,
        clientRequestId: requestId.current,
        components: [{ kind: 'direct_breastfeeding', durationMinutes: minutes }],
      };
    } else if (mode) {
      const amountMl = Number(amount);
      if (!Number.isInteger(amountMl) || amountMl <= 0) return;
      input = {
        occurredAt,
        clientRequestId: requestId.current,
        components: [{ kind: 'bottle', liquidType: mode, amountMl }],
      };
    } else {
      return;
    }
    if (await onSave(input)) {
      requestId.current = crypto.randomUUID();
      setMode(null);
      setAmount('');
      setDuration('');
      setQuickValues([]);
    }
  }

  if (mode === null) {
    return (
      <section className="panel care-form" aria-label="喂奶记录">
        <h3>记录喂奶</h3>
        <div className="choice-row">
          <button type="button" className="secondary" onClick={() => void chooseBottle('expressed_breast_milk')}>母乳瓶喂</button>
          <button type="button" className="secondary" onClick={() => void chooseBottle('formula')}>配方奶</button>
          <button type="button" className="secondary" onClick={() => setMode('direct')}>亲喂</button>
        </div>
      </section>
    );
  }

  if (mode === 'direct') {
    return (
      <section className="panel care-form" aria-label="亲喂记录">
        <h3>亲喂</h3>
        <label>
          本次亲喂总时长（分钟）
          <input
            inputMode="numeric"
            min="1"
            type="number"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </label>
        <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>保存亲喂</button>
      </section>
    );
  }

  return (
    <section className="panel care-form" aria-label="瓶喂记录">
      <h3>{mode === 'formula' ? '配方奶' : '母乳瓶喂'}</h3>
      <p className="label">最近常用实际奶量</p>
      <div className="choice-row" aria-label="最近常用奶量">
        {quickValues.map((value) => (
          <button key={value} type="button" className="secondary" onClick={() => setAmount(String(value))}>{value}ml</button>
        ))}
        <button type="button" className="secondary" onClick={() => setAmount('')}>其他</button>
      </div>
      <label>
        实际喝了（ml）
        <input
          inputMode="numeric"
          min="1"
          type="number"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>保存瓶喂</button>
    </section>
  );
}
