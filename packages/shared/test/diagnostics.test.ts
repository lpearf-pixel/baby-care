import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticEvent } from '../src/diagnostics.ts';

test('creates a compact structured diagnostic event', () => {
  const event = createDiagnosticEvent({
    level: 'error',
    eventCode: 'CONFIG_INVALID',
    component: 'api-config',
    message: 'invalid configuration',
    traceId: 'trace-1',
    expected: 'valid port',
    actual: 'invalid port',
  });
  assert.equal(event.level, 'error');
  assert.equal(event.event_code, 'CONFIG_INVALID');
  assert.equal(event.component, 'api-config');
  assert.equal(event.trace_id, 'trace-1');
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('redacts secret-bearing text from optional diagnostic evidence', () => {
  const event = createDiagnosticEvent({
    level: 'error',
    eventCode: 'DATABASE_UNAVAILABLE',
    component: 'database',
    message: 'connection failed',
    actual: 'postgres://user:secret-password@db:5432/babycare',
    evidencePointer: 'Authorization: Bearer top-secret-token',
  });
  assert.equal(event.actual, '[REDACTED]');
  assert.equal(event.evidence_pointer, '[REDACTED]');
});
