import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const stateWrites = vi.hoisted(() => ({ afterUnmount: 0, mounted: true }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const [value, setValue] = actual.useState(initial);
      const trackedSetValue = actual.useCallback<typeof setValue>((next) => {
        if (!stateWrites.mounted) stateWrites.afterUnmount += 1;
        setValue(next);
      }, []);
      return [value, trackedSetValue] as const;
    },
  };
});

import type { BabyCareApi } from '../src/api-client.js';
import { useCareTimeline } from '../src/care/useCareTimeline.js';

afterEach(() => {
  stateWrites.afterUnmount = 0;
  stateWrites.mounted = true;
});

describe('useCareTimeline lifecycle', () => {
  it('does not write timeline state when load-more settles after unmount', async () => {
    let resolveLoadMore!: (value: { items: never[]; nextCursor: null }) => void;
    const loadMoreResponse = new Promise<{ items: never[]; nextCursor: null }>((resolve) => {
      resolveLoadMore = resolve;
    });
    const getCareTimeline = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'next-page' })
      .mockReturnValueOnce(loadMoreResponse);
    const api = { getCareTimeline } as unknown as BabyCareApi;
    const { result, unmount } = renderHook(() => useCareTimeline(api));

    await waitFor(() => expect(result.current.nextCursor).toBe('next-page'));
    act(() => {
      void result.current.loadMore();
    });
    await waitFor(() => expect(getCareTimeline).toHaveBeenCalledTimes(2));

    stateWrites.mounted = false;
    unmount();
    await act(async () => resolveLoadMore({ items: [], nextCursor: null }));

    expect(stateWrites.afterUnmount).toBe(0);
  });
});
