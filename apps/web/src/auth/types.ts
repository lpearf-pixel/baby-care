import type { SessionDto } from '@baby-care/contracts';

export type AppState =
  | { kind: 'checking' }
  | { kind: 'setup-required' }
  | { kind: 'login' }
  | { kind: 'authenticated'; session: SessionDto }
  | { kind: 'degraded' };
