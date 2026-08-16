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
import { BabyCareApiError } from '../api-client.js';
import { CareSummary } from './CareSummary.js';
import { CareEventDetail } from './CareEventDetail.js';
import { CareDisplayMode } from './CareDisplayMode.js';
import { CareTimeline } from './CareTimeline.js';
import { CareWarningDialog } from './CareWarningDialog.js';
import { DiaperForm } from './DiaperForm.js';
import { FeedingForm } from './FeedingForm.js';
import { HandoffPanel } from './HandoffPanel.js';
import { OtherCareForm } from './OtherCareForm.js';
import { QuickRecordBar, type CareQuickAction } from './QuickRecordBar.js';
import { RecentEditPanel } from './RecentEditPanel.js';
import { RecentRecordCard, type RecentCareRecord } from './RecentRecordCard.js';
import { SleepControls } from './SleepControls.js';
import { useCareTimeline } from './useCareTimeline.js';
import { useCareWorkspace } from './useCareWorkspace.js';
import { useHandoff } from './useHandoff.js';

interface RecentState extends RecentCareRecord {
  editInput: EditCareEventInput;
}

function mergeConfirmed<T>(input: T, confirmedWarnings?: CareWarningCode[]): T {
  if (!confirmedWarnings?.length) return input;
  const current = (input as { confirmedWarnings?: CareWarningCode[] }).confirmedWarnings ?? [];
  return {
    ...(input as object),
    confirmedWarnings: [...new Set([...current, ...confirmedWarnings])],
  } as T;
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

export function CareWorkspace({ api, familyTimeZone = 'UTC' }: { api: BabyCareApi; familyTimeZone?: string }) {
  const [active, setActive] = useState<CareQuickAction | null>(null);
  const [recent, setRecent] = useState<RecentState | null>(null);
  const [editing, setEditing] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [recentEditingVersion, setRecentEditingVersion] = useState<number | null>(null);
  const [recentLatestVersion, setRecentLatestVersion] = useState<number | null>(null);
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
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
  const {
    briefing,
    loading: handoffLoading,
    busy: handoffBusy,
    message: handoffMessage,
    takeOver,
    reload: reloadHandoff,
  } = useHandoff(api);
  const {
    items: timelineItems,
    nextCursor,
    loading: timelineLoading,
    loadingMore: timelineLoadingMore,
    message: timelineMessage,
    category,
    setCategory,
    setWindow,
    loadMore,
    reload: reloadTimeline,
  } = useCareTimeline(api);

  async function saveFeeding(input: CreateFeedingSessionInput) {
    return save(
      (warnings) => api.createFeedingSession(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: feedingLabel(input), version: 1, editInput: feedingEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function saveDiaper(input: CreateDiaperInput) {
    return save(
      (warnings) => api.createDiaper(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: diaperLabel(input), version: 1, editInput: diaperEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function saveAction(input: CreateCareActionInput) {
    return save(
      (warnings) => api.createCareAction(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: actionLabel(input), version: 1, editInput: actionEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function saveMeasurement(input: CreateMeasurementInput) {
    return save(
      (warnings) => api.createMeasurement(mergeConfirmed(input, warnings)),
      (result) => {
        setRecent({ id: result.id, label: measurementLabel(input), version: 1, editInput: measurementEdit(input) });
        setEditing(false);
        setActive(null);
      },
    );
  }

  async function editRecent(input: EditCareEventInput) {
    if (!recent) return;
    setRevisionConflict(false);
    setRecentLatestVersion(null);
    const saved = await save(
      () => api.editCareEvent(recent.id, { expectedVersion: recentEditingVersion ?? recent.version, event: input })
        .catch(async (error: unknown) => {
          if (error instanceof BabyCareApiError && error.code === 'care_state_conflict') {
            setRevisionConflict(true);
            const latest = await api.getCareEventDetail(recent.id).catch(() => null);
            if (latest) setRecentLatestVersion(latest.version);
          }
          throw error;
        }),
      (receipt) => {
        setRecent({ ...recent, version: receipt.version, editInput: input });
        setEditing(false);
        setRecentEditingVersion(null);
        setRecentLatestVersion(null);
      },
    );
    if (saved) await Promise.all([reloadTimeline(), reloadHandoff()]);
  }

  async function undoRecent() {
    if (!recent) return;
    setRevisionConflict(false);
    const saved = await save(
      () => api.undoCareEvent(recent.id, { expectedVersion: recent.version })
        .catch((error: unknown) => {
          if (error instanceof BabyCareApiError && error.code === 'care_state_conflict') {
            setRevisionConflict(true);
          }
          throw error;
        }),
      () => {
        setRecent(null);
        setEditing(false);
      },
    );
    if (saved) await Promise.all([reloadTimeline(), reloadHandoff()]);
  }

  return (
    <section className="care-workspace" aria-label="Baby Care 护理工作台">
      <CareDisplayMode />
      {loading ? <section className="panel"><p>正在加载护理状态…</p></section> : null}
      {!loading && summary ? <CareSummary summary={summary} /> : null}
      {!loading && !summary ? (
        <section className="panel">
          <h2>护理状态</h2>
          <p className="muted">护理状态暂时无法加载，仍可稍后重试。</p>
        </section>
      ) : null}

      <HandoffPanel
        api={api}
        briefing={briefing}
        loading={handoffLoading}
        busy={handoffBusy}
        message={handoffMessage}
        onTakeOver={takeOver}
        onReload={reloadHandoff}
        familyTimeZone={familyTimeZone}
        onJumpToWindow={(from, to, nextCategory) => {
          setCategory(nextCategory);
          setWindow(from, to);
        }}
      />

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
                version: result.version,
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
                version: result.version,
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
          onEdit={() => {
            setRecentEditingVersion(recent.version);
            setRecentLatestVersion(null);
            setEditing(true);
          }}
          onUndo={() => void undoRecent()}
        />
      ) : null}
      {recent && editing ? (
        <RecentEditPanel
          input={recent.editInput}
          busy={busy}
          onSave={editRecent}
          onCancel={() => {
            setEditing(false);
            setRecentEditingVersion(null);
            setRecentLatestVersion(null);
          }}
        />
      ) : null}

      {revisionConflict ? (
        <div className="inline-message care-message" aria-live="polite">
          <p>记录已被其他照护者修改，请刷新后确认</p>
          {recentLatestVersion !== null && recentEditingVersion !== null ? (
            <>
              <p>最新版本 {recentLatestVersion}，当前草稿基于版本 {recentEditingVersion}</p>
              {recentLatestVersion !== recentEditingVersion ? (
                <button type="button" className="text-button" onClick={() => {
                  setRecentEditingVersion(recentLatestVersion);
                }}>确认以最新版本为基础</button>
              ) : <p>已确认以最新版本为基础，请再次保存。</p>}
            </>
          ) : null}
        </div>
      ) : message ? <p className="inline-message care-message" aria-live="polite">{message}</p> : null}

      <CareTimeline
        items={timelineItems}
        category={category}
        loading={timelineLoading}
        loadingMore={timelineLoadingMore}
        nextCursor={nextCursor}
        message={timelineMessage}
        onCategoryChange={setCategory}
        onLoadMore={loadMore}
        onReload={reloadTimeline}
        onOpenDetail={setDetailEventId}
        familyTimeZone={familyTimeZone}
      />
      {detailEventId ? (
        <CareEventDetail
          key={detailEventId}
          api={api}
          eventId={detailEventId}
          familyTimeZone={familyTimeZone}
          onClose={() => setDetailEventId(null)}
          onChanged={async () => {
            await Promise.all([reload(), reloadTimeline(), reloadHandoff()]);
          }}
        />
      ) : null}
      <button type="button" className="text-button care-refresh" onClick={() => void reload()}>刷新护理状态</button>
    </section>
  );
}
