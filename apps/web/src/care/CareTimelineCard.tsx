import type { CareTimelineItemDto } from '@baby-care/contracts';

function dateTimeParts(value: string, familyTimeZone: string) {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: familyTimeZone });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' });
  }
  return new Map(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
}

export function localDateKey(value: string, familyTimeZone: string): string {
  const parts = dateTimeParts(value, familyTimeZone);
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

export function formatDateTime(value: string, familyTimeZone = 'UTC'): string {
  const parts = dateTimeParts(value, familyTimeZone);
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`;
}

function formatActor(item: CareTimelineItemDto): string {
  const actor = item.actorDisplayName ?? '系统';
  const source = item.source === 'manual'
    ? '手动记录'
    : item.source === 'device'
      ? '设备记录'
      : item.source === 'guardian'
        ? 'Guardian 记录'
        : item.source === 'import'
          ? '导入记录'
          : 'AI 记录';
  return `${actor} · ${source}${item.isBackfilled ? ' · 补记' : ''}`;
}

function formatFeeding(item: Extract<CareTimelineItemDto, { eventType: 'feeding' }>): string {
  return item.payload.components.map((component) => {
    if (component.kind === 'direct_breastfeeding') return `亲喂 ${component.durationMinutes}min`;
    return `${component.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'} ${component.amountMl}ml`;
  }).join(' · ');
}

export function formatCareTimelineSummary(item: CareTimelineItemDto): string {
  switch (item.eventType) {
    case 'feeding':
      return formatFeeding(item);
    case 'diaper':
      return item.payload.kind === 'urine'
        ? '尿布 · 尿'
        : item.payload.kind === 'stool'
          ? '尿布 · 便'
          : '尿布 · 尿+便';
    case 'sleep': {
      if (!item.payload.endedAt) return '睡眠中';
      const minutes = Math.round(
        (new Date(item.payload.endedAt).getTime() - new Date(item.payload.startedAt).getTime()) / 60000,
      );
      return `睡眠 ${minutes}min`;
    }
    case 'burping':
      return '拍嗝';
    case 'spit_up':
      return `吐奶 · ${item.payload.action.amount}`;
    case 'crying':
      return item.payload.action.durationMinutes ? `哭闹 ${item.payload.action.durationMinutes}min` : '哭闹';
    case 'bathing':
      return '洗澡';
    case 'medication':
      return `喂药 · ${item.payload.action.medicationName} ${item.payload.action.dose}${item.payload.action.doseUnit}`;
    case 'temperature':
      return item.payload.measurement.method
        ? `体温 ${item.payload.measurement.valueCelsius}°C · ${item.payload.measurement.method}`
        : `体温 ${item.payload.measurement.valueCelsius}°C`;
    case 'weight':
      return `体重 ${item.payload.measurement.valueKg}kg`;
  }
}

export function CareTimelineCard({
  item,
  familyTimeZone,
  onOpenDetail,
}: {
  item: CareTimelineItemDto;
  familyTimeZone: string;
  onOpenDetail: (eventId: string) => void;
}) {
  return (
    <article className="panel care-timeline-card">
      <p className="care-timeline-time">
        <time dateTime={item.occurredAt}>{formatDateTime(item.occurredAt, familyTimeZone)}</time>
      </p>
      <strong>{formatCareTimelineSummary(item)}</strong>
      <p className="muted care-timeline-meta">{formatActor(item)}</p>
      <button type="button" className="text-button care-detail-button" onClick={() => onOpenDetail(item.id)}>查看详情</button>
    </article>
  );
}
