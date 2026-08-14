import { useRef, useState } from 'react';
import type {
  CreateCareActionInput,
  CreateMeasurementInput,
} from '@baby-care/contracts';

export type OtherCareKind =
  | 'burping'
  | 'spit_up'
  | 'crying'
  | 'bathing'
  | 'temperature'
  | 'weight'
  | 'medication';

const labels: Array<{ kind: OtherCareKind; label: string }> = [
  { kind: 'burping', label: '拍嗝' },
  { kind: 'spit_up', label: '吐奶' },
  { kind: 'crying', label: '哭闹' },
  { kind: 'bathing', label: '洗澡' },
  { kind: 'temperature', label: '体温' },
  { kind: 'weight', label: '体重' },
  { kind: 'medication', label: '喂药' },
];

export function OtherCareForm({
  busy,
  onSaveAction,
  onSaveMeasurement,
}: {
  busy: boolean;
  onSaveAction: (input: CreateCareActionInput) => Promise<boolean>;
  onSaveMeasurement: (input: CreateMeasurementInput) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<OtherCareKind | null>(null);
  const [spitAmount, setSpitAmount] = useState<'small' | 'medium' | 'large'>('small');
  const [cryMinutes, setCryMinutes] = useState('');
  const [temperature, setTemperature] = useState('');
  const [temperatureMethod, setTemperatureMethod] = useState('');
  const [weight, setWeight] = useState('');
  const [medicationName, setMedicationName] = useState('');
  const [dose, setDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('');
  const requestId = useRef(crypto.randomUUID());

  function reset() {
    requestId.current = crypto.randomUUID();
    setKind(null);
    setSpitAmount('small');
    setCryMinutes('');
    setTemperature('');
    setTemperatureMethod('');
    setWeight('');
    setMedicationName('');
    setDose('');
    setDoseUnit('');
  }

  async function submit() {
    if (!kind) return;
    const base = { occurredAt: new Date().toISOString(), clientRequestId: requestId.current };
    let saved: boolean;
    if (kind === 'temperature') {
      const valueCelsius = Number(temperature);
      if (!Number.isFinite(valueCelsius) || valueCelsius <= 0) return;
      saved = await onSaveMeasurement({
        ...base,
        measurement: {
          kind: 'temperature',
          valueCelsius,
          ...(temperatureMethod.trim() ? { method: temperatureMethod.trim() } : {}),
        },
      });
    } else if (kind === 'weight') {
      const valueKg = Number(weight);
      if (!Number.isFinite(valueKg) || valueKg <= 0) return;
      saved = await onSaveMeasurement({ ...base, measurement: { kind: 'weight', valueKg } });
    } else if (kind === 'medication') {
      const actualDose = Number(dose);
      if (!medicationName.trim() || !doseUnit.trim() || !Number.isFinite(actualDose) || actualDose <= 0) return;
      saved = await onSaveAction({
        ...base,
        action: {
          kind: 'medication',
          medicationName: medicationName.trim(),
          dose: actualDose,
          doseUnit: doseUnit.trim(),
        },
      });
    } else if (kind === 'spit_up') {
      saved = await onSaveAction({ ...base, action: { kind: 'spit_up', amount: spitAmount } });
    } else if (kind === 'crying') {
      const minutes = cryMinutes.trim() ? Number(cryMinutes) : undefined;
      if (minutes !== undefined && (!Number.isInteger(minutes) || minutes <= 0)) return;
      saved = await onSaveAction({
        ...base,
        action: { kind: 'crying', ...(minutes ? { durationMinutes: minutes } : {}) },
      });
    } else {
      saved = await onSaveAction({ ...base, action: { kind } });
    }
    if (saved) reset();
  }

  return (
    <section className="panel care-form" aria-label="更多护理记录">
      <h3>更多护理</h3>
      <div className="choice-row other-care-grid">
        {labels.map((item) => (
          <button
            key={item.kind}
            type="button"
            className={kind === item.kind ? 'primary' : 'secondary'}
            onClick={() => setKind(item.kind)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {kind === 'spit_up' ? (
        <div className="choice-row">
          {([['small', '少量'], ['medium', '中等'], ['large', '较多']] as const).map(([value, label]) => (
            <button key={value} type="button" className={spitAmount === value ? 'primary' : 'secondary'} onClick={() => setSpitAmount(value)}>{label}</button>
          ))}
        </div>
      ) : null}
      {kind === 'crying' ? (
        <label>哭闹时长（分钟，可选）<input type="number" min="1" value={cryMinutes} onChange={(event) => setCryMinutes(event.target.value)} /></label>
      ) : null}
      {kind === 'temperature' ? (
        <div className="form-grid">
          <label>体温（°C）<input type="number" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></label>
          <label>测量方式（可选）<input value={temperatureMethod} onChange={(event) => setTemperatureMethod(event.target.value)} /></label>
        </div>
      ) : null}
      {kind === 'weight' ? (
        <label>体重（kg）<input type="number" step="0.01" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
      ) : null}
      {kind === 'medication' ? (
        <div className="form-grid">
          <label className="full-width">药物名称<input value={medicationName} onChange={(event) => setMedicationName(event.target.value)} /></label>
          <label>实际剂量<input type="number" step="any" value={dose} onChange={(event) => setDose(event.target.value)} /></label>
          <label>剂量单位<input value={doseUnit} onChange={(event) => setDoseUnit(event.target.value)} /></label>
        </div>
      ) : null}
      {kind ? <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>保存护理记录</button> : null}
    </section>
  );
}
