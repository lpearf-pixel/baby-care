import { CareValidationError } from './care-errors.js';

export type TimelineCursor = {
  occurredAt: string;
  createdAt: string;
  id: string;
};

interface SerializedTimelineCursor extends TimelineCursor {
  version: 1;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidCursor(): CareValidationError {
  return new CareValidationError('Invalid timeline cursor.');
}

function isOffsetDateTime(value: unknown): value is string {
  return typeof value === 'string'
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function encodeTimelineCursor(value: TimelineCursor): string {
  if (!isOffsetDateTime(value.occurredAt)
    || !isOffsetDateTime(value.createdAt)
    || !UUID_PATTERN.test(value.id)) {
    throw invalidCursor();
  }
  const serialized: SerializedTimelineCursor = { version: 1, ...value };
  return Buffer.from(JSON.stringify(serialized), 'utf8').toString('base64url');
}

export function decodeTimelineCursor(value: string): TimelineCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw invalidCursor();
    const parsed = JSON.parse(decoded.toString('utf8')) as Record<string, unknown>;
    if (Object.keys(parsed).length !== 4
      || parsed.version !== 1
      || !isOffsetDateTime(parsed.occurredAt)
      || !isOffsetDateTime(parsed.createdAt)
      || typeof parsed.id !== 'string'
      || !UUID_PATTERN.test(parsed.id)) {
      throw invalidCursor();
    }
    return {
      occurredAt: parsed.occurredAt,
      createdAt: parsed.createdAt,
      id: parsed.id,
    };
  } catch (error) {
    if (error instanceof CareValidationError) throw error;
    throw invalidCursor();
  }
}
