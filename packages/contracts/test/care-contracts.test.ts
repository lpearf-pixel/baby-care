import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as Contracts from '../src/index.js';

describe('M2 care contracts', () => {
  it('exports a strict care write metadata schema without client-owned identity fields', () => {
    const schema = (Contracts as unknown as Record<string, unknown>).CareWriteMetaInputSchema as
      | { parse: (input: unknown) => Record<string, unknown> }
      | undefined;
    const clientRequestId = randomUUID();

    expect(schema, 'CareWriteMetaInputSchema export is missing').toBeDefined();

    const parsed = schema!.parse({ occurredAt: '2026-08-13T08:00:00.000Z', clientRequestId });
    expect(parsed).toEqual({ occurredAt: '2026-08-13T08:00:00.000Z', clientRequestId });

    expect(() =>
      schema!.parse({
        occurredAt: '2026-08-13T08:00:00.000Z',
        clientRequestId,
        actorUserId: randomUUID(),
      }),
    ).toThrow();
  });
});
