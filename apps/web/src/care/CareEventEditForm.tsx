import { useState } from 'react';
import { EditCareEventInputSchema, type EditCareEventInput } from '@baby-care/contracts';

function isoToLocalInput(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function CareEventEditForm({
  input,
  busy,
  ariaLabel = '修改护理记录',
  onSave,
  onCancel,
}: {
  input: EditCareEventInput;
  busy: boolean;
  ariaLabel?: string;
  onSave: (input: EditCareEventInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(input);
  const [time, setTime] = useState(() => isoToLocalInput(input.eventType === 'sleep' ? input.startedAt : input.occurredAt));
  const [endTime, setEndTime] = useState(() => input.eventType === 'sleep' && input.endedAt ? isoToLocalInput(input.endedAt) : '');
  const [note, setNote] = useState(input.note ?? '');
  const [error, setError] = useState<string | null>(null);

  function buildEvent(): EditCareEventInput | null {
    const occurredAt = localInputToIso(time);
    if (!occurredAt) return null;
    const candidate = draft.eventType === 'sleep'
      ? {
          ...draft,
          startedAt: occurredAt,
          endedAt: endTime ? localInputToIso(endTime) : null,
        }
      : { ...draft, occurredAt };
    delete candidate.note;
    if (candidate.eventType === 'diaper' && candidate.kind === 'urine') {
      delete candidate.stoolColor;
      delete candidate.stoolConsistency;
      delete candidate.stoolAmount;
    }
    if (note.trim()) candidate.note = note.trim();
    const parsed = EditCareEventInputSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  return (
    <section className="panel care-form care-event-editor" aria-label={ariaLabel}>
      <h3>修改护理记录</h3>

      {draft.eventType === 'feeding' ? (
        <div className="care-edit-fields">
          {draft.components.map((component, index) => component.kind === 'bottle' ? (
            <div className="form-grid care-edit-group" key={`bottle-${index}`}>
              <label>
                瓶喂奶种
                <select
                  value={component.liquidType}
                  onChange={(event) => setDraft((current) => current.eventType === 'feeding' ? {
                    ...current,
                    components: current.components.map((value, componentIndex) => componentIndex === index && value.kind === 'bottle'
                      ? { ...value, liquidType: event.target.value as 'formula' | 'expressed_breast_milk' }
                      : value),
                  } : current)}
                >
                  <option value="expressed_breast_milk">母乳瓶喂</option>
                  <option value="formula">配方奶</option>
                </select>
              </label>
              <label>
                实际喝了（ml）
                <input
                  type="number"
                  min="1"
                  value={component.amountMl}
                  onChange={(event) => setDraft((current) => current.eventType === 'feeding' ? {
                    ...current,
                    components: current.components.map((value, componentIndex) => componentIndex === index && value.kind === 'bottle'
                      ? { ...value, amountMl: Number(event.target.value) }
                      : value),
                  } : current)}
                />
              </label>
              <label>
                奶瓶容量（ml，可选，非摄入量）
                <input
                  type="number"
                  min="1"
                  value={component.bottleCapacityMl ?? ''}
                  onChange={(event) => setDraft((current) => current.eventType === 'feeding' ? {
                    ...current,
                    components: current.components.map((value, componentIndex) => componentIndex === index && value.kind === 'bottle'
                      ? { ...value, ...(event.target.value ? { bottleCapacityMl: Number(event.target.value) } : { bottleCapacityMl: undefined }) }
                      : value),
                  } : current)}
                />
              </label>
              <button
                type="button"
                className="text-button"
                disabled={draft.components.length === 1}
                onClick={() => setDraft((current) => current.eventType === 'feeding' ? {
                  ...current,
                  components: current.components.filter((_, componentIndex) => componentIndex !== index),
                } : current)}
              >删除瓶喂组成</button>
            </div>
          ) : (
            <div className="care-edit-group" key={`direct-${index}`}>
              <label>
                亲喂总时长（分钟）
                <input
                  type="number"
                  min="1"
                  value={component.durationMinutes}
                  onChange={(event) => setDraft((current) => current.eventType === 'feeding' ? {
                    ...current,
                    components: current.components.map((value, componentIndex) => componentIndex === index && value.kind === 'direct_breastfeeding'
                      ? { ...value, durationMinutes: Number(event.target.value) }
                      : value),
                  } : current)}
                />
              </label>
              <button
                type="button"
                className="text-button"
                disabled={draft.components.length === 1}
                onClick={() => setDraft((current) => current.eventType === 'feeding' ? {
                  ...current,
                  components: current.components.filter((_, componentIndex) => componentIndex !== index),
                } : current)}
              >删除亲喂组成</button>
            </div>
          ))}
          <div className="choice-row">
            <button type="button" className="secondary" onClick={() => setDraft((current) => current.eventType === 'feeding' ? {
              ...current,
              components: [...current.components, { kind: 'bottle', liquidType: 'formula', amountMl: 1 }],
            } : current)}>添加瓶喂</button>
            <button type="button" className="secondary" onClick={() => setDraft((current) => current.eventType === 'feeding' ? {
              ...current,
              components: [...current.components, { kind: 'direct_breastfeeding', durationMinutes: 1 }],
            } : current)}>添加亲喂</button>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={(draft.relatedActions ?? []).some((action) => action.kind === 'burping')}
              onChange={(event) => setDraft((current) => {
                if (current.eventType !== 'feeding') return current;
                const withoutBurping = (current.relatedActions ?? []).filter((action) => action.kind !== 'burping');
                return { ...current, relatedActions: event.target.checked ? [...withoutBurping, { kind: 'burping' }] : withoutBurping };
              })}
            />
            记录拍嗝
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={(draft.relatedActions ?? []).some((action) => action.kind === 'spit_up')}
              onChange={(event) => setDraft((current) => {
                if (current.eventType !== 'feeding') return current;
                const withoutSpitUp = (current.relatedActions ?? []).filter((action) => action.kind !== 'spit_up');
                return { ...current, relatedActions: event.target.checked ? [...withoutSpitUp, { kind: 'spit_up', amount: 'small' }] : withoutSpitUp };
              })}
            />
            记录吐奶
          </label>
          {(draft.relatedActions ?? []).some((action) => action.kind === 'spit_up') ? (
            <label>
              吐奶量
              <select
                value={(draft.relatedActions ?? []).find((action) => action.kind === 'spit_up')?.amount ?? 'small'}
                onChange={(event) => setDraft((current) => current.eventType === 'feeding' ? {
                  ...current,
                  relatedActions: (current.relatedActions ?? []).map((action) => action.kind === 'spit_up'
                    ? { ...action, amount: event.target.value as 'small' | 'medium' | 'large' }
                    : action),
                } : current)}
              >
                <option value="small">少量</option><option value="medium">中量</option><option value="large">大量</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {draft.eventType === 'diaper' ? (
        <div className="care-edit-fields">
          <div className="choice-row" aria-label="尿布类型">
            {([['urine', '尿'], ['stool', '便'], ['urine_stool', '尿+便']] as const).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={draft.kind === kind ? 'primary' : 'secondary'}
                onClick={() => setDraft((current) => current.eventType === 'diaper' ? { ...current, kind } : current)}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.kind !== 'urine' ? (
            <div className="form-grid">
              <label>便便颜色<input value={draft.stoolColor ?? ''} onChange={(event) => setDraft((current) => current.eventType === 'diaper' ? { ...current, stoolColor: event.target.value || undefined } : current)} /></label>
              <label>便便性状<input value={draft.stoolConsistency ?? ''} onChange={(event) => setDraft((current) => current.eventType === 'diaper' ? { ...current, stoolConsistency: event.target.value || undefined } : current)} /></label>
              <label>便便量<input value={draft.stoolAmount ?? ''} onChange={(event) => setDraft((current) => current.eventType === 'diaper' ? { ...current, stoolAmount: event.target.value || undefined } : current)} /></label>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.eventType === 'spit_up' && draft.action.kind === 'spit_up' ? (
        <label>
          吐奶量
          <select value={draft.action.amount} onChange={(event) => setDraft((current) => current.eventType === 'spit_up' && current.action.kind === 'spit_up' ? { ...current, action: { kind: 'spit_up', amount: event.target.value as 'small' | 'medium' | 'large' } } : current)}>
            <option value="small">少量</option><option value="medium">中量</option><option value="large">大量</option>
          </select>
        </label>
      ) : null}

      {draft.eventType === 'crying' && draft.action.kind === 'crying' ? (
        <label>哭闹时长（分钟）<input type="number" min="1" value={draft.action.durationMinutes ?? ''} onChange={(event) => setDraft((current) => current.eventType === 'crying' && current.action.kind === 'crying' ? { ...current, action: { kind: 'crying', ...(event.target.value ? { durationMinutes: Number(event.target.value) } : {}) } } : current)} /></label>
      ) : null}

      {draft.eventType === 'medication' && draft.action.kind === 'medication' ? (
        <div className="form-grid care-edit-fields">
          <label>药物名称<input value={draft.action.medicationName} onChange={(event) => setDraft((current) => current.eventType === 'medication' && current.action.kind === 'medication' ? { ...current, action: { ...current.action, medicationName: event.target.value } } : current)} /></label>
          <label>实际剂量<input type="number" min="0" step="any" value={draft.action.dose} onChange={(event) => setDraft((current) => current.eventType === 'medication' && current.action.kind === 'medication' ? { ...current, action: { ...current.action, dose: Number(event.target.value) } } : current)} /></label>
          <label>剂量单位<input value={draft.action.doseUnit} onChange={(event) => setDraft((current) => current.eventType === 'medication' && current.action.kind === 'medication' ? { ...current, action: { ...current.action, doseUnit: event.target.value } } : current)} /></label>
        </div>
      ) : null}

      {draft.eventType === 'temperature' && draft.measurement.kind === 'temperature' ? (
        <div className="form-grid care-edit-fields">
          <label>体温（°C）<input type="number" min="1" step="any" value={draft.measurement.valueCelsius} onChange={(event) => setDraft((current) => current.eventType === 'temperature' && current.measurement.kind === 'temperature' ? { ...current, measurement: { ...current.measurement, valueCelsius: Number(event.target.value) } } : current)} /></label>
          <label>测量方式<input value={draft.measurement.method ?? ''} onChange={(event) => setDraft((current) => current.eventType === 'temperature' && current.measurement.kind === 'temperature' ? { ...current, measurement: { ...current.measurement, ...(event.target.value ? { method: event.target.value } : { method: undefined }) } } : current)} /></label>
        </div>
      ) : null}

      {draft.eventType === 'weight' && draft.measurement.kind === 'weight' ? (
        <label>体重（kg）<input type="number" min="1" step="any" value={draft.measurement.valueKg} onChange={(event) => setDraft((current) => current.eventType === 'weight' && current.measurement.kind === 'weight' ? { ...current, measurement: { kind: 'weight', valueKg: Number(event.target.value) } } : current)} /></label>
      ) : null}

      <label>
        {draft.eventType === 'sleep' ? '睡眠开始时间' : '实际发生时间'}
        <input type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      {draft.eventType === 'sleep' ? (
        <label>睡眠结束时间<input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
      ) : null}
      <label>备注<input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="choice-row">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            const next = buildEvent();
            if (!next) {
              setError('请检查时间和护理事实后再保存');
              return;
            }
            setError(null);
            void onSave(next);
          }}
        >
          保存修改
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </section>
  );
}
