import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminFamilyPanel } from '../src/family/AdminFamilyPanel.js';

const family = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Xiangxiang Family',
  timezone: 'Asia/Shanghai',
  status: 'active',
} as const;

const baby = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'xiangxiang',
  birthDate: null,
  status: 'active',
} as const;

function panel(nextFamily = family) {
  return (
    <AdminFamilyPanel
      family={nextFamily}
      baby={baby}
      members={[]}
      busy={false}
      message={null}
      onUpdateFamily={vi.fn(async () => undefined)}
      onUpdateBaby={vi.fn(async () => undefined)}
      onCreateNanny={vi.fn(async () => undefined)}
      onSetNannyStatus={vi.fn(async () => undefined)}
      onResetNannyPassword={vi.fn(async () => undefined)}
    />
  );
}

afterEach(() => cleanup());

describe('family administration form state', () => {
  it('preserves an unsaved timezone when an unrelated reload returns the same family values', () => {
    const { rerender } = render(panel());
    const timezone = screen.getByLabelText('时区');

    fireEvent.change(timezone, { target: { value: 'Pacific/Kiritimati' } });
    rerender(panel({ ...family }));

    expect(timezone).toHaveValue('Pacific/Kiritimati');
  });
});
