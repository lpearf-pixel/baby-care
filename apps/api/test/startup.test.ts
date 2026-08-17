import { describe, expect, it } from 'vitest';
import { startServer as startProductionServer } from '../src/startup.js';

interface StartupModule {
  startServer?: (options: {
    environment: NodeJS.ProcessEnv;
    createDatabase: (url: string) => {
      migrate: () => Promise<void>;
      checkDatabase: () => Promise<boolean>;
      close: () => Promise<void>;
    };
    buildApp: (dependencies: Record<string, unknown>) => {
      addHook: (name: string, hook: () => Promise<void>) => void;
      listen: (options: { host: string; port: number }) => Promise<void>;
    };
  }) => Promise<void>;
}

const startServer = startProductionServer as unknown as NonNullable<StartupModule['startServer']>;

const environment = {
  DATABASE_URL: 'postgres://example/test',
  API_HOST: '127.0.0.1',
  API_PORT: '8787',
  BABY_CARE_APP_ORIGIN: 'http://127.0.0.1:8080',
  BABY_CARE_SETUP_TOKEN: 'local-development-setup-token-change-me',
  SESSION_SECURE: 'false',
};

describe('production API startup', () => {
  it('migrates before building/listening and injects M1 runtime configuration', async () => {
    const events: string[] = [];
    let capturedDependencies: Record<string, unknown> | undefined;
    let closeHook: (() => Promise<void>) | undefined;

    await startServer({
      environment,
      createDatabase: () => ({
        migrate: async () => { events.push('migrate'); },
        checkDatabase: async () => true,
        close: async () => { events.push('close'); },
      }),
      buildApp: (dependencies) => {
        events.push('build');
        capturedDependencies = dependencies;
        return {
          addHook: (_name, hook) => { closeHook = hook; },
          listen: async ({ host, port }) => { events.push(`listen:${host}:${port}`); },
        };
      },
    });

    expect(events).toEqual(['migrate', 'build', 'listen:127.0.0.1:8787']);
    expect(capturedDependencies).toMatchObject({
      appOrigin: 'http://127.0.0.1:8080',
      setupToken: 'local-development-setup-token-change-me',
      sessionSecure: false,
      familyExportMaxBytes: 33_554_432,
    });

    await closeHook!();
    expect(events.at(-1)).toBe('close');
  });

  it('injects the validated export bound into the application without registering an export route', async () => {
    let capturedDependencies: Record<string, unknown> | undefined;
    await startServer({
      environment: { ...environment, FAMILY_EXPORT_MAX_BYTES: '1048576' },
      createDatabase: () => ({
        migrate: async () => {},
        checkDatabase: async () => true,
        close: async () => {},
      }),
      buildApp: (dependencies) => {
        capturedDependencies = dependencies;
        return {
          addHook: () => {},
          listen: async () => {},
        };
      },
    });

    expect(capturedDependencies).toMatchObject({ familyExportMaxBytes: 1_048_576 });
  });

  it('does not build or listen when migration fails and closes the database', async () => {
    const events: string[] = [];
    await expect(
      startServer({
        environment,
        createDatabase: () => ({
          migrate: async () => {
            events.push('migrate');
            throw new Error('migration failed');
          },
          checkDatabase: async () => true,
          close: async () => { events.push('close'); },
        }),
        buildApp: () => {
          events.push('build');
          throw new Error('must not build');
        },
      }),
    ).rejects.toThrow('migration failed');

    expect(events).toEqual(['migrate', 'close']);
  });
});
