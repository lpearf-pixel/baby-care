import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CareTimelineCategory, CareTimelineItemDto } from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';

interface TimelineWindow {
  from: string;
  to: string;
}

function canReadTimeline(api: BabyCareApi): api is BabyCareApi & {
  getCareTimeline: NonNullable<BabyCareApi['getCareTimeline']>;
} {
  return typeof api.getCareTimeline === 'function';
}

export function useCareTimeline(api: BabyCareApi) {
  const [items, setItems] = useState<CareTimelineItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategoryState] = useState<CareTimelineCategory>('all');
  const [window, setWindowState] = useState<TimelineWindow | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const baseQuery = useMemo(() => ({
    category,
    limit: 20,
    ...(window ? { from: window.from, to: window.to } : {}),
  }), [category, window]);

  useEffect(() => {
    let active = true;
    if (!canReadTimeline(api)) {
      setItems([]);
      setNextCursor(null);
      setMessage('护理时间线暂时无法加载');
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    void api.getCareTimeline(baseQuery)
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
        setNextCursor(null);
        setMessage('护理时间线暂时无法加载');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, baseQuery, reloadToken]);

  const setCategory = useCallback((value: CareTimelineCategory) => {
    setCategoryState(value);
  }, []);

  const setWindow = useCallback((from: string, to: string) => {
    setWindowState({ from, to });
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !canReadTimeline(api)) return;
    setLoadingMore(true);
    try {
      const response = await api.getCareTimeline({ ...baseQuery, cursor: nextCursor });
      setItems((current) => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
      setMessage(null);
    } catch {
      setMessage('护理时间线加载更多失败，可重试');
    } finally {
      setLoadingMore(false);
    }
  }, [api, baseQuery, loadingMore, nextCursor]);

  return {
    items,
    nextCursor,
    loading,
    loadingMore,
    message,
    category,
    window,
    setCategory,
    setWindow,
    loadMore,
    reload: useCallback(async () => {
      if (!canReadTimeline(api)) {
        setItems([]);
        setNextCursor(null);
        setMessage('护理时间线暂时无法加载');
        return;
      }
      setReloadToken((value) => value + 1);
    }, [api]),
  };
}
