import { describe, expect, it } from 'vitest';
import appCss from '../src/app.css?inline';

describe('M5 Voice Care responsive and night-mode contract', () => {
  it('keeps typed cards bounded and one-handed controls at iPhone width', () => {
    expect(appCss).toMatch(/\.voice-care-grid\s*\{[^}]*minmax\(0,\s*1fr\)/s);
    expect(appCss).toMatch(/\.voice-care-session\s*\{[^}]*min-width:\s*0/s);
    expect(appCss).toMatch(/\.voice-care-code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(appCss).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*\.voice-care-actions[^{]*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(appCss).toMatch(/button, input, select, textarea\s*\{\s*min-height:\s*44px/);
  });

  it('uses the existing surface and warning variables so night mode remains readable', () => {
    expect(appCss).toMatch(/\.voice-care-panel[^{]*\{[^}]*background:\s*var\(--care-surface\)/s);
    expect(appCss).toMatch(/\.voice-care-warning[^{]*\{[^}]*background:\s*var\(--care-warning-surface\)/s);
    expect(appCss).not.toMatch(/\.voice-care[^}]*#[0-9a-f]{3,8}/i);
  });
});
