import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const queryGenerationRef = useRef(0);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const requestGeneration = ++queryGenerationRef.current;
    let active = true;
    const isCurrentRequest = () => active
      && queryGenerationRef.current === requestGeneration
      && apiRef.current === api;
    const invalidateRequest = () => {
      active = false;
      if (queryGenerationRef.current === requestGeneration) queryGenerationRef.current += 1;
    };
    if (!canReadTimeline(api)) {
      setItems([]);
      setNextCursor(null);
      setMessage('护理时间线暂时无法加载');
      setLoading(false);
      return invalidateRequest;
    }
    setLoading(true);
    setLoadingMore(false);
    setMessage(null);
    void api.getCareTimeline(baseQuery)
      .then((response) => {
        if (!isCurrentRequest()) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        setItems([]);
        setNextCursor(null);
        setMessage('护理时间线暂时无法加载');
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });
    return invalidateRequest;
  }, [api, baseQuery, reloadToken]);

  const setCategory = useCallback((value: CareTimelineCategory) => {
    setCategoryState(value);
  }, []);

  const setWindow = useCallback((from: string, to: string) => {
    setWindowState({ from, to });
  }, []);

  const clearFilters = useCallback(() => {
    setCategoryState('all');
    setWindowState(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || !canReadTimeline(api)) return;
    const requestGeneration = queryGenerationRef.current;
    const requestApi = api;
    const isCurrentRequest = () => queryGenerationRef.current === requestGeneration && apiRef.current === requestApi;
    setLoadingMore(true);
    try {
      const response = await api.getCareTimeline({ ...baseQuery, cursor: nextCursor });
      if (!isCurrentRequest()) return;
      setItems((current) => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
      setMessage(null);
    } catch {
      if (!isCurrentRequest()) return;
      setMessage('护理时间线加载更多失败，可重试');
    } finally {
      if (isCurrentRequest()) setLoadingMore(false);
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
    clearFilters,
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
