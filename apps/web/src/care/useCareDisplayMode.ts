import { useEffect, useLayoutEffect, useState } from 'react';

export type CareDisplayMode = 'auto' | 'day' | 'night';

export const CARE_DISPLAY_MODE_KEY = 'baby-care.display-mode.v1';

function storedMode(): CareDisplayMode {
  try {
    const value = window.localStorage.getItem(CARE_DISPLAY_MODE_KEY);
    return value === 'day' || value === 'night' || value === 'auto' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function systemMode(): Exclude<CareDisplayMode, 'auto'> {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}

export function useCareDisplayMode() {
  const [mode, setMode] = useState<CareDisplayMode>(storedMode);
  const [automaticMode, setAutomaticMode] = useState<Exclude<CareDisplayMode, 'auto'>>(systemMode);
  const resolvedMode = mode === 'auto' ? automaticMode : mode;

  useEffect(() => {
    try {
      window.localStorage.setItem(CARE_DISPLAY_MODE_KEY, mode);
    } catch {
      // Display mode remains usable for this page when browser storage is unavailable.
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'auto' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent | MediaQueryList) => {
      setAutomaticMode(event.matches ? 'night' : 'day');
    };
    update(media);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [mode]);

  useLayoutEffect(() => {
    document.documentElement.dataset.careTheme = resolvedMode;
    return () => {
      delete document.documentElement.dataset.careTheme;
    };
  }, [resolvedMode]);

  return { mode, resolvedMode, setMode };
}
