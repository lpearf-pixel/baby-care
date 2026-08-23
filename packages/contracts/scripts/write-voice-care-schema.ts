import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { VoiceCareIntentV1Schema } from '../src/voice-care.js';

const target = fileURLToPath(new URL('../schema/voice-care-intent.v1.schema.json', import.meta.url));
const serialized = `${JSON.stringify(z.toJSONSchema(VoiceCareIntentV1Schema, {
  target: 'draft-2020-12',
  reused: 'ref',
}), null, 2)}\n`;

if (process.argv.slice(2).includes('--check')) {
  const existing = await readFile(target, 'utf8').catch(() => '');
  if (existing !== serialized) {
    process.stderr.write('voice_care_schema_out_of_date\n');
    process.exitCode = 1;
  }
} else {
  await writeFile(target, serialized, { encoding: 'utf8', mode: 0o644 });
  process.stdout.write('voice_care_schema_written\n');
}
