import { useCallback, useEffect, useState } from 'react';
import type { CareTimelineItemDto, EditCareEventInput } from '@baby-care/contracts';
import { BabyCareApiError, type BabyCareApi, type CareRevisionHistoryItemDto } from '../api-client.js';
import { CareEventEditForm } from './CareEventEditForm.js';
import { CareRevisionHistory } from './CareRevisionHistory.js';
import { formatDateTime } from './CareTimelineCard.js';

function sourceLabel(source: CareTimelineItemDto['source']): string {
  if (source === 'manual') return '手动记录';
  if (source === 'device') return '设备记录';
  if (source === 'guardian') return 'Guardian 记录';
  if (source === 'import') return '导入记录';
  return 'AI 记录';
}

function amountLabel(value: 'small' | 'medium' | 'large'): string {
  return value === 'small' ? '少量' : value === 'medium' ? '中量' : '大量';
}

function detailFacts(item: CareTimelineItemDto): string[] {
  switch (item.eventType) {
    case 'feeding':
      return [
        ...item.payload.components.flatMap((component) => component.kind === 'bottle'
          ? [
              `奶种 ${component.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'}`,
              `实际喝了 ${component.amountMl}ml`,
              ...(component.bottleCapacityMl ? [`奶瓶容量 ${component.bottleCapacityMl}ml（不计入摄入量）`] : []),
            ]
          : [`亲喂 ${component.durationMinutes}min`]),
        ...item.payload.relatedActions.map((action) => action.kind === 'burping' ? '拍嗝' : `${amountLabel(action.amount)}吐奶`),
      ];
    case 'diaper':
      return [
        item.payload.kind === 'urine' ? '尿' : item.payload.kind === 'stool' ? '便' : '尿+便',
        ...(item.payload.stoolColor ? [`便便颜色 ${item.payload.stoolColor}`] : []),
        ...(item.payload.stoolConsistency ? [`便便性状 ${item.payload.stoolConsistency}`] : []),
        ...(item.payload.stoolAmount ? [`便便量 ${item.payload.stoolAmount}`] : []),
      ];
    case 'sleep':
      return [
        `睡眠开始 ${formatDateTime(item.payload.startedAt)}`,
        item.payload.endedAt ? `睡眠结束 ${formatDateTime(item.payload.endedAt)}` : '睡眠结束 进行中',
      ];
    case 'burping':
      return ['拍嗝'];
    case 'spit_up':
      return [`吐奶量 ${amountLabel(item.payload.action.amount)}`];
    case 'crying':
      return item.payload.action.durationMinutes ? [`哭闹时长 ${item.payload.action.durationMinutes}min`] : ['哭闹'];
    case 'bathing':
      return ['洗澡'];
    case 'medication':
      return [
        `实际用药 ${item.payload.action.medicationName}`,
        `实际剂量 ${item.payload.action.dose} ${item.payload.action.doseUnit}`,
      ];
    case 'temperature':
      return [
        `体温 ${item.payload.measurement.valueCelsius}°C`,
        ...(item.payload.measurement.method ? [`测量方式 ${item.payload.measurement.method}`] : []),
      ];
    case 'weight':
      return [`体重 ${item.payload.measurement.valueKg}kg`];
  }
}

function editInputFromDetail(item: CareTimelineItemDto): EditCareEventInput {
  const note = item.note ? { note: item.note } : {};
  switch (item.eventType) {
    case 'feeding':
      return { eventType: 'feeding', occurredAt: item.occurredAt, ...note, components: item.payload.components, relatedActions: item.payload.relatedActions };
    case 'diaper':
      return {
        eventType: 'diaper', occurredAt: item.occurredAt, ...note, kind: item.payload.kind,
        ...(item.payload.stoolColor ? { stoolColor: item.payload.stoolColor } : {}),
        ...(item.payload.stoolConsistency ? { stoolConsistency: item.payload.stoolConsistency } : {}),
        ...(item.payload.stoolAmount ? { stoolAmount: item.payload.stoolAmount } : {}),
      };
    case 'sleep':
      return { eventType: 'sleep', startedAt: item.payload.startedAt, endedAt: item.payload.endedAt, ...note };
    case 'burping':
    case 'spit_up':
    case 'crying':
    case 'bathing':
    case 'medication':
      return { eventType: item.eventType, occurredAt: item.occurredAt, ...note, action: item.payload.action };
    case 'temperature':
    case 'weight':
      return { eventType: item.eventType, occurredAt: item.occurredAt, ...note, measurement: item.payload.measurement };
  }
}

export function CareEventDetail({
  api,
  eventId,
  onClose,
  onChanged,
}: {
  api: BabyCareApi;
  eventId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<CareTimelineItemDto | null>(null);
  const [revisions, setRevisions] = useState<CareRevisionHistoryItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [nextDetail, nextRevisions] = await Promise.all([
      api.getCareEventDetail(eventId),
      api.getCareEventRevisions(eventId),
    ]);
    setDetail(nextDetail);
    setRevisions(nextRevisions);
  }, [api, eventId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void reload()
      .catch(() => {
        if (active) setMessage('护理记录详情暂时无法加载');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [reload]);

  async function edit(input: EditCareEventInput) {
    if (!detail || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const receipt = await api.editCareEvent(eventId, {
        expectedVersion: editingVersion ?? detail.version,
        event: input,
      });
      setDetail((current) => current ? { ...current, version: receipt.version } : current);
      setEditing(false);
      setEditingVersion(null);
      const refreshes = await Promise.allSettled([reload(), onChanged()]);
      setMessage(refreshes.some((result) => result.status === 'rejected')
        ? '记录已保存，详情刷新失败，请关闭后重试'
        : '修改已保存');
    } catch (error) {
      if (error instanceof BabyCareApiError && error.code === 'care_state_conflict') {
        await reload().catch(() => undefined);
        setMessage('记录已被其他照护者修改，请刷新后确认');
      } else {
        setMessage('修改失败，已保留当前填写内容，可重试');
      }
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!detail || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.undoCareEvent(eventId, { expectedVersion: detail.version });
      setDetail((current) => current ? { ...current, status: 'voided' } : current);
      setConfirmingUndo(false);
      try {
        await onChanged();
        onClose();
      } catch {
        setMessage('记录已撤销，护理视图刷新失败，请手动刷新');
      }
    } catch (error) {
      if (error instanceof BabyCareApiError && error.code === 'care_state_conflict') {
        await reload().catch(() => undefined);
        setMessage('记录已被其他照护者修改，请刷新后确认');
      } else {
        setMessage('撤销失败，请重试');
      }
      setConfirmingUndo(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel care-event-detail" aria-label="护理记录详情">
      <div className="care-panel-header">
        <h2>护理记录详情</h2>
        <button type="button" className="text-button" onClick={onClose}>关闭详情</button>
      </div>
      {loading ? <p>正在加载护理记录详情…</p> : null}
      {!loading && !detail ? <p className="muted">护理记录详情暂时无法加载</p> : null}
      {detail ? (
        <>
          <ul className="care-detail-facts">
            {detailFacts(detail).map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
          <p>实际发生时间 {formatDateTime(detail.occurredAt)}</p>
          <p className="muted care-timeline-meta">
            {detail.actorDisplayName ?? '系统'} · {sourceLabel(detail.source)}{detail.isBackfilled ? ' · 补记' : ''}
          </p>
          <p>版本 {detail.version}</p>
          {detail.note ? <p>备注 {detail.note}</p> : <p className="muted">无备注</p>}

          {detail.status === 'voided' ? (
            <p className="inline-message care-message">此记录已撤销，修订历史仍保留。</p>
          ) : editing ? (
            <CareEventEditForm
              input={editInputFromDetail(detail)}
              busy={busy}
              onSave={edit}
              onCancel={() => {
                setEditing(false);
                setEditingVersion(null);
                setMessage(null);
              }}
            />
          ) : (
            <div className="choice-row">
              <button type="button" className="secondary" disabled={busy} onClick={() => {
                setEditingVersion(detail.version);
                setEditing(true);
                setMessage(null);
              }}>修改此记录</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmingUndo(true)}>撤销此记录</button>
            </div>
          )}

          {message ? <p className="inline-message care-message" aria-live="polite">{message}</p> : null}
          {editing && editingVersion !== null && detail.version !== editingVersion ? (
            <p className="muted">最新版本 {detail.version}，当前草稿基于版本 {editingVersion}</p>
          ) : null}
          <CareRevisionHistory revisions={revisions} />
        </>
      ) : null}

      {confirmingUndo ? (
        <section className="panel warning-dialog" role="alertdialog" aria-label="确认撤销历史记录">
          <h3>确认撤销历史记录</h3>
          <p>撤销会保留原记录和修订历史，不会删除事实。</p>
          <div className="choice-row">
            <button type="button" className="primary" disabled={busy} onClick={() => void undo()}>确认撤销</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmingUndo(false)}>取消</button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
