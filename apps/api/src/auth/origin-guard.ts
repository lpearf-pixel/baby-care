export class OriginNotAllowedError extends Error {
  readonly code = 'origin_not_allowed' as const;

  constructor(message = 'Origin is not allowed') {
    super(message);
    this.name = 'OriginNotAllowedError';
  }
}

export function assertAllowedOrigin(origin: string | undefined, expectedOrigin: string): void {
  if (!origin) throw new OriginNotAllowedError('Origin header is required');

  try {
    const actual = new URL(origin).origin;
    const expected = new URL(expectedOrigin).origin;
    if (actual !== expected) throw new OriginNotAllowedError();
  } catch (error) {
    if (error instanceof OriginNotAllowedError) throw error;
    throw new OriginNotAllowedError();
  }
}
