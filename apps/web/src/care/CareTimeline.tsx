import type { CareTimelineCategory, CareTimelineItemDto } from '@baby-care/contracts';
import { CareTimelineCard, formatDateTime, localDateKey } from './CareTimelineCard.js';

const categories: Array<{ value: CareTimelineCategory; label: string }> = [
  { value: 'all', label: '全部记录' },
  { value: 'feeding', label: '只看喂养' },
  { value: 'diaper', label: '只看尿布' },
  { value: 'sleep', label: '只看睡眠' },
  { value: 'other', label: '只看其他护理' },
];

const categoryStatus: Record<CareTimelineCategory, string> = {
  all: '当前显示全部护理记录',
  feeding: '当前仅显示喂养记录',
  diaper: '当前仅显示尿布记录',
  sleep: '当前仅显示睡眠记录',
  other: '当前仅显示其他护理记录',
};

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
  window,
  onShowAll,
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
  window: { from: string; to: string } | null;
  onShowAll: () => void;
}) {
  const groups = items.reduce<Array<{ localDate: string; items: CareTimelineItemDto[] }>>((current, item) => {
    const localDate = localDateKey(item.occurredAt, familyTimeZone);
    const last = current.at(-1);
    if (last?.localDate === localDate) last.items.push(item);
    else current.push({ localDate, items: [item] });
    return current;
  }, []);

  return (
    <section id="care-timeline" className="panel care-timeline" aria-label="护理时间线" tabIndex={-1}>
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
            onClick={() => option.value === 'all' ? onShowAll() : onCategoryChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {window ? (
        <div className="care-timeline-window" role="status">
          <p>当前固定窗口 {`${formatDateTime(window.from, familyTimeZone)} → ${formatDateTime(window.to, familyTimeZone)}`}</p>
          <button type="button" className="text-button" onClick={onShowAll}>退出固定窗口，查看全部记录</button>
        </div>
      ) : <p className="muted">{categoryStatus[category]}</p>}

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
