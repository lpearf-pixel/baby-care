export interface HealthDependencies {
  checkDatabase: () => Promise<void>;
}

export interface HealthResult {
  statusCode: 200 | 503;
  body: {
    status: 'ok' | 'error';
    service: 'baby-care-api';
    checks?: { database: 'ok' | 'error' };
    error_code?: 'DATABASE_UNAVAILABLE';
  };
}

export function createHealthService(deps: HealthDependencies) {
  return {
    live(): HealthResult {
      return { statusCode: 200, body: { status: 'ok', service: 'baby-care-api' } };
    },
    async ready(): Promise<HealthResult> {
      try {
        await deps.checkDatabase();
        return { statusCode: 200, body: { status: 'ok', service: 'baby-care-api', checks: { database: 'ok' } } };
      } catch {
        return { statusCode: 503, body: { status: 'error', service: 'baby-care-api', checks: { database: 'error' }, error_code: 'DATABASE_UNAVAILABLE' } };
      }
    },
  };
}
