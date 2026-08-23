import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { VoiceCareIntentV1Schema, parseCanonicalVoiceCareIntentV1 } from '../src/index.js';

const schemaPath = fileURLToPath(new URL('../schema/voice-care-intent.v1.schema.json', import.meta.url));
const corpusPath = fileURLToPath(new URL('../fixtures/voice-care-v1.json', import.meta.url));

describe('M5 Voice Care published artifacts', () => {
  it('publishes the versioned JSON Schema and golden corpus', () => {
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(corpusPath)).toBe(true);
  });

  it('keeps the published JSON Schema byte-stable with the strict Zod contract', () => {
    const published: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'));
    expect(published).toEqual(z.toJSONSchema(VoiceCareIntentV1Schema, {
      target: 'draft-2020-12',
      reused: 'ref',
    }));
  });

  it('accepts every valid golden raw request and rejects every invalid one', () => {
    const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as {
      schemaVersion: number;
      schemaId: string;
      valid: Array<{ name: string; raw: string }>;
      invalid: Array<{ name: string; raw: string }>;
    };

    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.schemaId).toBe('voice-care-intent.v1');
    expect(corpus.valid.length).toBeGreaterThanOrEqual(5);
    expect(corpus.invalid.length).toBeGreaterThanOrEqual(8);
    for (const fixture of corpus.valid) {
      expect(() => parseCanonicalVoiceCareIntentV1(new TextEncoder().encode(fixture.raw)), fixture.name).not.toThrow();
    }
    for (const fixture of corpus.invalid) {
      expect(() => parseCanonicalVoiceCareIntentV1(new TextEncoder().encode(fixture.raw)), fixture.name).toThrow('voice_care_contract_invalid');
    }
  });
});
