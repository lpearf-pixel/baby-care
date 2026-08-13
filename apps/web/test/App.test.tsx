import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '@baby-care/contracts';
import { App } from '../src/App.js';

const healthy: HealthResponse = {
  status: 'ok',
  service: 'baby-care-api',
  database: 'ok',
  timestamp: '2026-08-13T06:30:00.000Z',
};

const degraded: HealthResponse = {
  status: 'degraded',
  service: 'baby-care-api',
  database: 'unavailable',
  timestamp: '2026-08-13T06:30:00.000Z',
};

describe('Baby Care shell', () => {
  it('shows the product identity and xiangxiang', async () => {
    render(<App loadHealth={async () => healthy} />);

    expect(screen.getByRole('heading', { name: 'Baby Care' })).toBeInTheDocument();
    expect(screen.getByText('xiangxiang')).toBeInTheDocument();
    expect(await screen.findByText('系统在线')).toBeInTheDocument();
  });

  it('shows a family-friendly degraded status without internal details', async () => {
    render(<App loadHealth={async () => degraded} />);

    expect(await screen.findByText('服务暂不可用')).toBeInTheDocument();
    expect(screen.queryByText(/postgres/i)).not.toBeInTheDocument();
  });
});
