import { HealthResponseSchema, type HealthResponse } from '@baby-care/contracts';

export async function loadApiHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    headers: { accept: 'application/json' },
  });
  const payload: unknown = await response.json();
  return HealthResponseSchema.parse(payload);
}
