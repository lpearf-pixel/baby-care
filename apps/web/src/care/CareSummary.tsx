import type { CareHomeSummaryDto } from '@baby-care/contracts';

function elapsedLabel(from: string, asOf: string): string {
  const minutes = Math.max(0, Math.floor((new Date(asOf).getTime() - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}小时前` : `${hours}小时${remainder}分钟前`;
}

function feedLabel(feed: NonNullable<CareHomeSummaryDto['lastFeeding']>): string {
  const parts: string[] = [];
  if (feed.bottle) {
    parts.push(`${feed.bottle.liquidType === 'formula' ? '配方奶' : '母乳瓶喂'} ${feed.bottle.amountMl}ml`);
  }
  if (feed.directBreastfeedingMinutes) parts.push(`亲喂 ${feed.directBreastfeedingMinutes}min`);
  return parts.join(' · ');
}

function diaperLabel(kind: NonNullable<CareHomeSummaryDto['lastDiaper']>['kind']): string {
  if (kind === 'urine') return '尿';
  if (kind === 'stool') return '便';
  return '尿+便';
}

export function CareSummary({ summary }: { summary: CareHomeSummaryDto }) {
  const sleepMinutes = summary.currentSleep
    ? Math.max(0, Math.floor((new Date(summary.asOf).getTime() - new Date(summary.currentSleep.startedAt).getTime()) / 60000))
    : null;

  return (
    <section className="panel care-summary" aria-labelledby="care-summary-title">
      <h2 id="care-summary-title">护理状态</h2>
      <div className="care-summary-grid">
        <div className="care-metric">
          <span>上次喂奶</span>
          <strong>{summary.lastFeeding ? elapsedLabel(summary.lastFeeding.occurredAt, summary.asOf) : '暂无记录'}</strong>
          <small>{summary.lastFeeding ? feedLabel(summary.lastFeeding) : '—'}</small>
        </div>
        <div className="care-metric">
          <span>上次尿布</span>
          <strong>{summary.lastDiaper ? elapsedLabel(summary.lastDiaper.occurredAt, summary.asOf) : '暂无记录'}</strong>
          <small>{summary.lastDiaper ? diaperLabel(summary.lastDiaper.kind) : '—'}</small>
        </div>
        <div className="care-metric">
          <span>滚动24小时</span>
          <strong>过去24小时瓶喂 {summary.rolling24h.bottleTotalMl}ml</strong>
          <small>亲喂 {summary.rolling24h.directBreastfeedingSessions}次 · {summary.rolling24h.directBreastfeedingMinutes}min</small>
        </div>
        <div className="care-metric">
          <span>当前状态</span>
          <strong>{sleepMinutes === null ? '清醒 / 未记录睡眠' : `睡眠中 · ${sleepMinutes}min`}</strong>
          <small>{summary.currentSleep ? `开始 ${new Date(summary.currentSleep.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}</small>
        </div>
      </div>
    </section>
  );
}
