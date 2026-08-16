import type { EditCareEventInput } from '@baby-care/contracts';
import type { CareRevisionHistoryItemDto } from '../api-client.js';
import { formatDateTime } from './CareTimelineCard.js';

function amountLabel(value: 'small' | 'medium' | 'large'): string {
  return value === 'small' ? '少量' : value === 'medium' ? '中量' : '大量';
}

function editSnapshotLabel(snapshot: EditCareEventInput, familyTimeZone: string): string {
  let facts: string[];
  switch (snapshot.eventType) {
    case 'feeding': {
      facts = [
        ...snapshot.components.map((component) => component.kind === 'bottle'
          ? `${component.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'}实际喝了 ${component.amountMl}ml${component.bottleCapacityMl ? `（奶瓶容量 ${component.bottleCapacityMl}ml，不计入摄入量）` : ''}`
          : `亲喂 ${component.durationMinutes}min`),
        ...(snapshot.relatedActions ?? []).map((action) => action.kind === 'burping' ? '拍嗝' : `${amountLabel(action.amount)}吐奶`),
      ];
      break;
    }
    case 'diaper':
      facts = [`尿布${snapshot.kind === 'urine' ? '尿' : snapshot.kind === 'stool' ? '便' : '尿+便'}${snapshot.stoolColor ? ` · ${snapshot.stoolColor}` : ''}${snapshot.stoolConsistency ? ` · ${snapshot.stoolConsistency}` : ''}${snapshot.stoolAmount ? ` · ${snapshot.stoolAmount}` : ''}`];
      break;
    case 'sleep':
      return [`睡眠 ${formatDateTime(snapshot.startedAt, familyTimeZone)}${snapshot.endedAt ? ` → ${formatDateTime(snapshot.endedAt, familyTimeZone)}` : ' → 进行中'}`, ...(snapshot.note ? [`备注 ${snapshot.note}`] : [])].join(' · ');
    case 'burping':
      facts = ['拍嗝'];
      break;
    case 'spit_up':
      facts = [snapshot.action.kind === 'spit_up' ? `吐奶 ${amountLabel(snapshot.action.amount)}` : '吐奶'];
      break;
    case 'crying':
      facts = [snapshot.action.kind === 'crying' && snapshot.action.durationMinutes ? `哭闹 ${snapshot.action.durationMinutes}min` : '哭闹'];
      break;
    case 'bathing':
      facts = ['洗澡'];
      break;
    case 'medication':
      facts = [snapshot.action.kind === 'medication'
        ? `实际用药 ${snapshot.action.medicationName} ${snapshot.action.dose}${snapshot.action.doseUnit}`
        : '实际用药'];
      break;
    case 'temperature':
      facts = [snapshot.measurement.kind === 'temperature'
        ? `体温 ${snapshot.measurement.valueCelsius}°C${snapshot.measurement.method ? ` · ${snapshot.measurement.method}` : ''}`
        : '体温'];
      break;
    case 'weight':
      facts = [snapshot.measurement.kind === 'weight' ? `体重 ${snapshot.measurement.valueKg}kg` : '体重'];
      break;
  }
  return [...facts, `时间 ${formatDateTime(snapshot.occurredAt, familyTimeZone)}`, ...(snapshot.note ? [`备注 ${snapshot.note}`] : [])].join(' · ');
}

function snapshotLabel(snapshot: CareRevisionHistoryItemDto['before'] | CareRevisionHistoryItemDto['after'], familyTimeZone: string): string {
  if ('status' in snapshot) return snapshot.status === 'active' ? '有效记录' : '已撤销';
  return editSnapshotLabel(snapshot, familyTimeZone);
}

export function CareRevisionHistory({
  revisions,
  error = false,
  onRetry,
  familyTimeZone = 'UTC',
}: {
  revisions: CareRevisionHistoryItemDto[];
  error?: boolean;
  onRetry?: () => void;
  familyTimeZone?: string;
}) {
  return (
    <section className="care-revision-history" aria-label="修订历史">
      <h3>修订历史</h3>
      {error ? (
        <div>
          <p className="muted">修订历史暂时无法加载</p>
          <button type="button" className="text-button" onClick={onRetry}>重试修订历史</button>
        </div>
      ) : !revisions.length ? <p className="muted">暂无修订</p> : (
        <ol className="care-revision-list">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <strong>
                {revision.actorDisplayName} · {revision.action === 'edit' ? '修改' : '撤销'} · 版本 {revision.fromVersion} → {revision.toVersion} · {formatDateTime(revision.createdAt, familyTimeZone)}
              </strong>
              <p>修改前：{snapshotLabel(revision.before, familyTimeZone)}</p>
              <p>修改后：{snapshotLabel(revision.after, familyTimeZone)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
