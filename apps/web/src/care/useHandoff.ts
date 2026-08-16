import { useCallback, useEffect, useRef, useState } from 'react';
import type { CareHandoffBriefingDto } from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';

function canReadHandoff(api: BabyCareApi): api is BabyCareApi & {
  getLatestCareHandoff: NonNullable<BabyCareApi['getLatestCareHandoff']>;
  getCareHandoffSummary: NonNullable<BabyCareApi['getCareHandoffSummary']>;
} {
  return typeof api.getLatestCareHandoff === 'function' && typeof api.getCareHandoffSummary === 'function';
}

function canWriteHandoff(api: BabyCareApi): api is BabyCareApi & {
  createCareHandoff: NonNullable<BabyCareApi['createCareHandoff']>;
} {
  return typeof api.createCareHandoff === 'function';
}

export function useHandoff(api: BabyCareApi) {
  const [briefing, setBriefing] = useState<CareHandoffBriefingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pinnedCheckpointIdRef = useRef<string | null>(null);
  const takeOverRequestIdRef = useRef<string | null>(null);
  const takeOverInFlightRef = useRef(false);

  const applyBriefing = useCallback((next: CareHandoffBriefingDto | null) => {
    setBriefing(next);
    pinnedCheckpointIdRef.current = next?.checkpoint.id ?? null;
  }, []);

  const reload = useCallback(async () => {
    if (!canReadHandoff(api)) {
      setMessage('交接摘要暂时无法加载');
      return;
    }
    try {
      const next = pinnedCheckpointIdRef.current
        ? await api.getCareHandoffSummary(pinnedCheckpointIdRef.current)
        : await api.getLatestCareHandoff();
      applyBriefing(next);
      setMessage(null);
    } catch {
      setMessage('交接摘要暂时无法加载');
    }
  }, [api, applyBriefing]);

  useEffect(() => {
    let active = true;
    if (!canReadHandoff(api)) {
      setMessage('交接摘要暂时无法加载');
      setLoading(false);
      return;
    }
    void api.getLatestCareHandoff()
      .then((next) => {
        if (!active) return;
        applyBriefing(next);
        setMessage(null);
      })
      .catch(() => {
        if (active) setMessage('交接摘要暂时无法加载');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, applyBriefing]);

  const takeOver = useCallback(async () => {
    if (takeOverInFlightRef.current || !canReadHandoff(api) || !canWriteHandoff(api)) return;
    takeOverInFlightRef.current = true;
    setBusy(true);
    setMessage(null);
    const clientRequestId = takeOverRequestIdRef.current ?? crypto.randomUUID();
    takeOverRequestIdRef.current = clientRequestId;
    try {
      const next = await api.createCareHandoff({
        occurredAt: new Date().toISOString(),
        clientRequestId,
      });
      applyBriefing(next);
      takeOverRequestIdRef.current = null;
      setMessage('交接已记录');
    } catch {
      setMessage('交接记录失败，可重试');
    } finally {
      takeOverInFlightRef.current = false;
      setBusy(false);
    }
  }, [api, applyBriefing]);

  return {
    briefing,
    loading,
    busy,
    message,
    takeOver,
    reload,
  };
}
