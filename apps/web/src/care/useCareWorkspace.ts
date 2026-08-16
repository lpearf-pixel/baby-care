import { useCallback, useEffect, useState } from 'react';
import type { CareHomeSummaryDto, CareWarning, CareWarningCode } from '@baby-care/contracts';
import { BabyCareApiError, type BabyCareApi } from '../api-client.js';

interface PendingCareWarning {
  warnings: readonly CareWarning[];
  retry: (confirmedWarnings: CareWarningCode[]) => Promise<unknown>;
  onSuccess: ((result: unknown) => void) | undefined;
}

function warningsFromError(error: unknown): CareWarning[] | null {
  if (!(error instanceof BabyCareApiError) || error.code !== 'care_confirmation_required') return null;
  if (!error.details || typeof error.details !== 'object' || !('warnings' in error.details)) return null;
  const warnings = (error.details as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return null;
  const valid = warnings.filter((value): value is CareWarning => (
    typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'summary' in value
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { summary?: unknown }).summary === 'string'
  ));
  return valid.length > 0 ? valid : null;
}

export function useCareWorkspace(api: BabyCareApi) {
  const [summary, setSummary] = useState<CareHomeSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingWarning, setPendingWarning] = useState<PendingCareWarning | null>(null);

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

  const save = useCallback(async <T,>(
    action: (confirmedWarnings?: CareWarningCode[]) => Promise<T>,
    onSuccess?: (result: T) => void,
  ): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      await reload();
      onSuccess?.(result);
      setMessage('记录已保存');
      return true;
    } catch (error) {
      const warnings = warningsFromError(error);
      if (warnings) {
        setPendingWarning({
          warnings,
          retry: (confirmedWarnings) => action(confirmedWarnings),
          onSuccess: onSuccess as ((result: unknown) => void) | undefined,
        });
        return false;
      }
      setMessage('保存失败，已保留当前填写内容，可重试');
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const confirmWarning = useCallback(async () => {
    const pending = pendingWarning;
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      const codes = pending.warnings.map((warning) => warning.code);
      const result = await pending.retry(codes);
      await reload();
      pending.onSuccess?.(result);
      setPendingWarning(null);
      setMessage('记录已保存');
    } catch (error) {
      const warnings = warningsFromError(error);
      if (warnings) {
        setPendingWarning({ ...pending, warnings });
      } else {
        setMessage('保存失败，已保留当前填写内容，可重试');
      }
    } finally {
      setBusy(false);
    }
  }, [pendingWarning, reload]);

  const cancelWarning = useCallback(() => {
    setPendingWarning(null);
  }, []);

  return {
    summary,
    loading,
    busy,
    message,
    pendingWarning,
    reload,
    save,
    confirmWarning,
    cancelWarning,
  };
}
