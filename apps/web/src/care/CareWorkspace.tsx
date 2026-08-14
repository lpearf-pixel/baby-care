import { useState } from 'react';
import type {
  CareWarningCode,
  CreateCareActionInput,
  CreateDiaperInput,
  CreateFeedingSessionInput,
  CreateMeasurementInput,
  EditCareEventInput,
} from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';
import { CareSummary } from './CareSummary.js';
import { CareWarningDialog } from './CareWarningDialog.js';
import { DiaperForm } from './DiaperForm.js';
import { FeedingForm } from './FeedingForm.js';
import { OtherCareForm } from './OtherCareForm.js';
import { QuickRecordBar, type CareQuickAction } from './QuickRecordBar.js';
import { RecentEditPanel } from './RecentEditPanel.js';
import { RecentRecordCard, type RecentCareRecord } from './RecentRecordCard.js';
import { SleepControls } from './SleepControls.js';
import { useCareWorkspace } from './useCareWorkspace.js';

interface RecentState extends RecentCareRecord {
  editInput: EditCareEventInput;
}

function mergeConfirmed<T extends { confirmedWarnings?: CareWarningCode[] }>(
  input: T,
  confirmedWarnings?: CareWarningCode[],
): T {
  if (!confirmedWarnings?.length) return input;
  return {
    ...input,
    confirmedWarnings: [...new Set([...(input.confirmedWarnings ?? []), ...confirmedWarnings])],
  };
}

function feedingLabel(input: CreateFeedingSessionInput): string {
  return input.components.map((component) => {
    if (component.kind === 'direct_breastfeeding') return `亲喂 ${component.durationMinutes}min`;
    return `${component.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'} ${component.amountMl}ml`;
  }).join(' · ');
}

function diaperLabel(input: CreateDiaperInput): string {
  if (input.kind === 'urine') return '尿布 · 尿';
  if (input.kind === 'stool') return '尿布 · 便';
  return '尿布 · 尿+便';
}

function actionLabel(input: CreateCareActionInput): string {
  const action = input.action;
  if (action.kind === 'burping') return '拍嗝';
  if (action.kind === 'spit_up') return '吐奶';
  if (action.kind === 'crying') return '哭闹';
  if (action.kind === 'bathing') return '洗澡';
  return `喂药 · ${action.medicationName}`;
}

function measurementLabel(input: CreateMeasurementInput): string {
  return input.measurement.kind === 'temperature'
    ? `体温 ${input.measurement.valueCelsius}°C`
    : `体重 ${input.measurement.valueKg}kg`;
}

function feedingEdit(input: CreateFeedingSessionInput): EditCareEventInput {
  return {
    eventType: 'feeding',
    occurredAt: input.occurredAt,
    ...(input.note ? { note: input.note } : {}),
    components: input.components,
    ...(input.relatedActions ? { relatedActions: input.relatedActions } : {}),
  };
}

function diaperEdit(input: CreateDiaperInput): EditCareEventInput {
  return {
    eventType: 'diaper',
    occurredAt: input.occurredAt,
    ...(input.note ? { note: input.note } : {}),
    kind: input.kind,
    ...(input.stoolColor ? { stoolColor: input.stoolColor } : {}),
    ...(input.stoolConsistency ? { stoolConsistency: input.stoolConsistency } : {}),
    ...(input.stoolAmount ? { stoolAmount: input.stoolAmount } : {}),
  };
}

function actionEdit(input: CreateCareActionInput): EditCareEventInput {
  return {
    eventType: input.action.kind,
    occurredAt: input.occurredAt,
    ...(input.note ? { note: input.note } : {}),
    action: input.action,
  } as EditCareEventInput;
}

function measurementEdit(input: CreateMeasurementInput): EditCareEventInput {
  return {
    eventType: input.measurement.kind,
    occurredAt: input.occurredAt,
    ...(input.note ? { note: input.note } : {}),
    measurement: input.measurement,
  } as EditCareEventInput;
}

export function CareWorkspace({ api }: { api: BabyCareApi }) {
  const [active, setActive] = useState<CareQuickAction | null>(null);
  const [recent, setRecent] = useState<RecentState | null>(null);
  const [editing, setEditing] = useState(false);
  const {
    summary,
    loading,
    busy,
    message,
    pendingWarning,
    reload,
    save,
    confirmWarning,
    cancelWarning,
  } = useCareWorkspace(api);

  async function saveFeeding(input: CreateFeedingSessionInput) {
    return save(
      (warnings) => api.createFeedingSession(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: feedingLabel(input), editInput: feedingEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function saveDiaper(input: CreateDiaperInput) {
    return save(
      (warnings) => api.createDiaper(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: diaperLabel(input), editInput: diaperEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function saveAction(input: CreateCareActionInput) {
    return save(
      (warnings) => api.createCareAction(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: actionLabel(input), editInput: actionEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function saveMeasurement(input: CreateMeasurementInput) {
    return save(
      (warnings) => api.createMeasurement(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: measurementLabel(input), editInput: measurementEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function editRecent(input: EditCareEventInput) {
    if (!recent) return;
    await save(
      () => api.editCareEvent(recent.id, input),
      () => {
        setRecent({ ...recent, editInput: input });
        setEditing(false);
      },
    );
  }

  async function undoRecent() {
    if (!recent) return;
    await save(
      () => api.undoCareEvent(recent.id),
      () => {
        setRecent(null);
        setEditing(false);
      },
    );
  }

  return (
    <section className="care-workspace" aria-label="Baby Care 护理工作台">
      {loading ? <section className="panel"><p>正在加载护理状态…</p></section> : null}
      {!loading && summary ? <CareSummary summary={summary} /> : null}
      {!loading && !summary ? (
        <section className="panel">
          <h2>护理状态</h2>
          <p className="muted">护理状态暂时无法加载，仍可稍后重试。</p>
        </section>
      ) : null}

      <QuickRecordBar active={active} onSelect={(next) => {
        setEditing(false);
        setActive(active === next ? null : next);
      }} />

      {active === 'feeding' ? <FeedingForm api={api} busy={busy} onSave={saveFeeding} /> : null}
      {active === 'diaper' ? <DiaperForm busy={busy} onSave={saveDiaper} /> : null}
      {active === 'sleep' ? (
        <SleepControls
          sleeping={Boolean(summary?.currentSleep)}
          busy={busy}
          onStart={(input) => save(
            (warnings) => api.startSleep(mergeConfirmed(input, warnings)),
            (result) => {
              setRecent({
                id: result.id,
                label: '开始睡觉',
                editInput: {
                  eventType: 'sleep',
                  startedAt: result.startedAt,
                  endedAt: result.endedAt,
                  ...(result.note ? { note: result.note } : {}),
                },
              });
              setActive(null);
            },
          )}
          onWake={(input) => save(
            (warnings) => api.wakeSleep(mergeConfirmed(input, warnings)),
            (result) => {
              setRecent({
                id: result.id,
                label: '醒来',
                editInput: {
                  eventType: 'sleep',
                  startedAt: result.startedAt,
                  endedAt: result.endedAt,
                  ...(result.note ? { note: result.note } : {}),
                },
              });
              setActive(null);
            },
          )}
        />
      ) : null}
      {active === 'more' ? (
        <OtherCareForm busy={busy} onSaveAction={saveAction} onSaveMeasurement={saveMeasurement} />
      ) : null}

      {pendingWarning ? (
        <CareWarningDialog
          warnings={pendingWarning.warnings}
          busy={busy}
          onContinue={() => void confirmWarning()}
          onCancel={cancelWarning}
        />
      ) : null}

      {recent && !editing ? (
        <RecentRecordCard
          record={recent}
          busy={busy}
          onEdit={() => setEditing(true)}
          onUndo={() => void undoRecent()}
        />
      ) : null}
      {recent && editing ? (
        <RecentEditPanel
          input={recent.editInput}
          busy={busy}
          onSave={editRecent}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      {message ? <p className="inline-message care-message" aria-live="polite">{message}</p> : null}
      <button type="button" className="text-button care-refresh" onClick={() => void reload()}>刷新护理状态</button>
    </section>
  );
}
