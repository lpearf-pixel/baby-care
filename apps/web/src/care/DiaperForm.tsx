import { useRef, useState } from 'react';
import type { CreateDiaperInput, DiaperKind } from '@baby-care/contracts';

export function DiaperForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (input: CreateDiaperInput) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<DiaperKind | null>(null);
  const [stoolColor, setStoolColor] = useState('');
  const [stoolConsistency, setStoolConsistency] = useState('');
  const [stoolAmount, setStoolAmount] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const hasStool = kind === 'stool' || kind === 'urine_stool';

  async function submit() {
    if (!kind) return;
    const input: CreateDiaperInput = {
      occurredAt: new Date().toISOString(),
      clientRequestId: requestId.current,
      kind,
      ...(hasStool && stoolColor.trim() ? { stoolColor: stoolColor.trim() } : {}),
      ...(hasStool && stoolConsistency.trim() ? { stoolConsistency: stoolConsistency.trim() } : {}),
      ...(hasStool && stoolAmount.trim() ? { stoolAmount: stoolAmount.trim() } : {}),
    };
    if (await onSave(input)) {
      requestId.current = crypto.randomUUID();
      setKind(null);
      setStoolColor('');
      setStoolConsistency('');
      setStoolAmount('');
    }
  }

  return (
    <section className="panel care-form" aria-label="尿布记录">
      <h3>记录尿布</h3>
      <div className="choice-row">
        <button type="button" className={kind === 'urine' ? 'primary' : 'secondary'} onClick={() => setKind('urine')}>尿</button>
        <button type="button" className={kind === 'stool' ? 'primary' : 'secondary'} onClick={() => setKind('stool')}>便</button>
        <button type="button" className={kind === 'urine_stool' ? 'primary' : 'secondary'} onClick={() => setKind('urine_stool')}>尿+便</button>
      </div>
      {hasStool ? (
        <div className="form-grid stool-details">
          <label>
            便便颜色
            <input value={stoolColor} onChange={(event) => setStoolColor(event.target.value)} />
          </label>
          <label>
            便便性状
            <input value={stoolConsistency} onChange={(event) => setStoolConsistency(event.target.value)} />
          </label>
          <label className="full-width">
            便便量
            <input value={stoolAmount} onChange={(event) => setStoolAmount(event.target.value)} />
          </label>
        </div>
      ) : null}
      {kind ? <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>保存尿布</button> : null}
    </section>
  );
}
