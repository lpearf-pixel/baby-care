import { describe, expect, it } from 'vitest';
import { feedingInputV2 } from '../src/voice-care/session-service-v2.js';

describe('Voice Care v2 synthetic feeding handoff', () => {
  it('counts expressed breast milk and formula only after confirm', () => {
    const proposal = {
      schemaVersion: 2 as const,
      startedAt: '2026-10-10T12:00:00.000Z',
      endedAt: '2026-10-10T12:08:00.000Z',
      components: [
        { kind: 'bottle' as const, liquidType: 'expressed_breast_milk' as const, amountMl: 60 },
        { kind: 'bottle' as const, liquidType: 'formula' as const, amountMl: 30 },
      ],
    };
    let committed = false;
    const input = feedingInputV2(proposal, 'synthetic-confirm-1');
    expect(committed).toBe(false);
    expect(input.components).toHaveLength(2);
    expect(input.components.reduce((total, component) => total + (component.kind === 'bottle' ? component.amountMl : 0), 0)).toBe(90);
    committed = true;
    expect(committed).toBe(true);
  });

  it('keeps direct breastfeeding as duration without inventing millilitres', () => {
    const input = feedingInputV2({
      schemaVersion: 2,
      startedAt: '2026-10-10T12:00:00.000Z',
      endedAt: '2026-10-10T12:10:00.000Z',
      components: [{ kind: 'direct_breastfeeding', durationMinutes: 10 }],
    }, 'synthetic-direct-1');
    expect(input.components).toEqual([{ kind: 'direct_breastfeeding', durationMinutes: 10 }]);
    expect(input.components.some((component) => component.kind === 'bottle')).toBe(false);
  });
});
