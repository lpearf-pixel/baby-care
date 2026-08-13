import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './app.tsx';

describe('Baby Care PWA shell', () => {
  test('renders xiangxiang and a machine-readable API status label', () => {
    const html = renderToStaticMarkup(<App apiStatus="online" />);
    expect(html).toContain('xiangxiang');
    expect(html).toContain('Baby Care');
    expect(html).toContain('API 在线');
  });
  test('renders an offline-safe status message', () => {
    const html = renderToStaticMarkup(<App apiStatus="offline" />);
    expect(html).toContain('当前离线');
    expect(html).toContain('护理记录功能将在后续里程碑启用');
  });
});
