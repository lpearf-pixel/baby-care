import type { HealthResponse } from '@baby-care/contracts';

export interface AppProps {
  loadHealth?: () => Promise<HealthResponse>;
}

export function App(_props: AppProps) {
  return <main />;
}
