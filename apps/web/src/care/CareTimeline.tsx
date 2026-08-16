import type { CareTimelineCategory, CareTimelineItemDto } from '@baby-care/contracts';
import { CareTimelineCard, localDateKey } from './CareTimelineCard.js';

const categories: Array<{ value: CareTimelineCategory; label: string }> = [
  { value: 'all', label: '全部记录' },
  { value: 'feeding', label: '只看喂养' },
  { value: 'diaper', label: '只看尿布' },
  { value: 'sleep', label: '只看睡眠' },
  { value: 'other', label: '只看其他护理' },
];

export function CareTimeline({
  items,
  category,
  loading,
  loadingMore,
  nextCursor,
  message,
  onCategoryChange,
  onLoadMore,
  onReload,
  onOpenDetail,
  familyTimeZone,
}: {
  items: CareTimelineItemDto[];
  category: CareTimelineCategory;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  message: string | null;
  onCategoryChange: (value: CareTimelineCategory) => void;
  onLoadMore: () => Promise<void>;
  onReload: () => Promise<void>;
  onOpenDetail: (eventId: string) => void;
  familyTimeZone: string;
}) {
  const groups = items.reduce<Array<{ localDate: string; items: CareTimelineItemDto[] }>>((current, item) => {
    const localDate = localDateKey(item.occurredAt, familyTimeZone);
    const last = current.at(-1);
    if (last?.localDate === localDate) last.items.push(item);
    else current.push({ localDate, items: [item] });
    return current;
  }, []);

  return (
    <section className="panel care-timeline" aria-label="护理时间线">
      <div className="care-panel-header">
        <h2>护理时间线</h2>
        <button type="button" className="text-button" onClick={() => void onReload()}>重试护理时间线</button>
      </div>

      <div className="choice-row" aria-label="护理时间线筛选">
        {categories.map((option) => (
          <button
            key={option.value}
            type="button"
            className={category === option.value ? 'primary' : 'secondary'}
            onClick={() => onCategoryChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="inline-message care-message" role="status" aria-live="polite">
        {message ?? (loading ? '正在加载护理时间线…' : '护理时间线已更新')}
      </p>

      {!loading && !items.length ? <p className="muted">暂无护理记录</p> : null}

      <div id="care-timeline-list" className="care-timeline-list">
        {groups.map((group) => {
          const headingId = `care-timeline-date-${group.localDate}`;
          return (
            <section key={group.localDate} className="care-timeline-date-group" aria-labelledby={headingId}>
              <h3 id={headingId}>{group.localDate}</h3>
              {group.items.map((item) => (
                <CareTimelineCard
                  key={item.id}
                  item={item}
                  familyTimeZone={familyTimeZone}
                  onOpenDetail={onOpenDetail}
                />
              ))}
            </section>
          );
        })}
      </div>

      {nextCursor ? (
        <button type="button" className="secondary" disabled={loadingMore} onClick={() => void onLoadMore()}>
          加载更多护理记录
        </button>
      ) : null}
    </section>
  );
}
