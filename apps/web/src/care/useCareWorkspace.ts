import { useCallback, useEffect, useState } from 'react';
import type { CareHomeSummaryDto } from '@baby-care/contracts';
import type { BabyCareApi } from '../api-client.js';

export function useCareWorkspace(api: BabyCareApi) {
  const [summary, setSummary] = useState<CareHomeSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await api.getCareSummary(new Date().toISOString());
    setSummary(next);
  }, [api]);

  useEffect(() => {
    let active = true;
    void reload()
      .catch(() => {
        if (active) setMessage('护理状态暂时无法加载，请稍后重试');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const save = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage('记录已保存');
      return true;
    } catch {
      setMessage('保存失败，已保留当前填写内容，可重试');
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return { summary, loading, busy, message, reload, save };
}
