import { describe, expect, test, vi } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createProductionOperatorDependencies as sourceCreateProductionOperatorDependencies,
  parseOperatorConfig as sourceParseOperatorConfig,
  runDisposableRestore as sourceRunDisposableRestore,
  runExistingTargetRestore as sourceRunExistingTargetRestore,
  runOperatorCli as sourceRunOperatorCli,
} from '../src/cli.js';
import { createComposePostgresRunners as sourceCreateComposePostgresRunners } from '../src/compose-postgres.js';
import {
  createDisposableComposeLifecycle as sourceCreateDisposableComposeLifecycle,
  createDockerComposeExecutor as sourceCreateDockerComposeExecutor,
} from '../src/compose-executor.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
}

interface CliDependencies {
  create(): Promise<{ code: 'backup_created' }>;
  verify(): Promise<{ code: 'backup_verified' }>;
  restore(): Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;
  restoreVerify(): Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;
}

type RunOperatorCli = (options: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  dependencies: CliDependencies;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}) => Promise<number>;

const runOperatorCli: RunOperatorCli = sourceRunOperatorCli;

const validEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/fixture/home',
  BABY_CARE_APP_ORIGIN: 'http://127.0.0.1:8080',
  BABY_CARE_BACKUP_PARENT: '/fixture/private-parent',
  BABY_CARE_BACKUP_BUNDLE: 'baby-care-backup-20260817T123456Z',
  BABY_CARE_COMPOSE_PROJECT: 'baby-care',
  BABY_CARE_RESTORE_PROJECT: 'baby-care-restore',
  BABY_CARE_SOURCE_SERVICE: 'postgres',
  BABY_CARE_RESTORE_SERVICE: 'postgres_restore',
  BABY_CARE_RESTORE_PROBE_SERVICE: 'restored_api_probe',
};

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    create: vi.fn(async () => ({ code: 'backup_created' as const })),
    verify: vi.fn(async () => ({ code: 'backup_verified' as const })),
    restore: vi.fn(async () => ({ code: 'restore_verified' as const, revokedSessionCount: 1 })),
    restoreVerify: vi.fn(async () => ({ code: 'restore_verified' as const, revokedSessionCount: 1 })),
    ...overrides,
  };
}

async function run(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = validEnv,
  deps: CliDependencies = dependencies(),
): Promise<{ exitCode: number; io: CapturedIo; deps: CliDependencies }> {
  expect(runOperatorCli).toBeTypeOf('function');
  const io: CapturedIo = { stdout: [], stderr: [] };
  const exitCode = await runOperatorCli!({
    argv,
    env,
    dependencies: deps,
    writeStdout: (value) => io.stdout.push(value),
    writeStderr: (value) => io.stderr.push(value),
  });
  return { exitCode, io, deps };
}

describe('guarded operator CLI', () => {
  test.each([
    ['backup:create', 'create', 'backup_created'],
    ['backup:verify', 'verify', 'backup_verified'],
    ['backup:restore', 'restore', 'restore_verified'],
    ['backup:restore-verify', 'restoreVerify', 'restore_verified'],
  ] as const)('maps %s to one operation and prints only its generic code', async (command, method, code) => {
    const result = await run([command]);
    expect(result.exitCode).toBe(0);
    expect(result.io).toEqual({ stdout: [`${code}\n`], stderr: [] });
    expect(result.deps[method]).toHaveBeenCalledTimes(1);
    for (const other of ['create', 'verify', 'restore', 'restoreVerify'] as const) {
      if (other !== method) expect(result.deps[other]).not.toHaveBeenCalled();
    }
  });

  test.each([
    [[], 'operator_command_invalid'],
    [['backup:unknown'], 'operator_command_invalid'],
    [['backup:restore', '--clean'], 'operator_command_invalid'],
    [['backup:create', '/tmp/override'], 'operator_command_invalid'],
  ] as const)('rejects unknown or extra positional input', async (argv, code) => {
    const result = await run(argv);
    expect(result.exitCode).toBe(2);
    expect(result.io).toEqual({ stdout: [], stderr: [`${code}\n`] });
    expect(result.deps.create).not.toHaveBeenCalled();
    expect(result.deps.verify).not.toHaveBeenCalled();
    expect(result.deps.restore).not.toHaveBeenCalled();
    expect(result.deps.restoreVerify).not.toHaveBeenCalled();
  });

  test.each([
    ['BABY_CARE_BACKUP_PARENT', undefined],
    ['BABY_CARE_BACKUP_PARENT', 'relative/private-parent'],
    ['BABY_CARE_BACKUP_BUNDLE', 'baby-care-backup-20261317T123456Z'],
    ['BABY_CARE_COMPOSE_PROJECT', 'other-project'],
    ['BABY_CARE_SOURCE_SERVICE', 'other-postgres'],
    ['BABY_CARE_RESTORE_SERVICE', 'postgres'],
    ['BABY_CARE_RESTORE_PROBE_SERVICE', 'api'],
  ] as const)('fails closed for invalid fixed configuration %s', async (key, value) => {
    const env = { ...validEnv, [key]: value };
    const result = await run(['backup:verify'], env);
    expect(result.exitCode).toBe(2);
    expect(result.io).toEqual({ stdout: [], stderr: ['operator_config_invalid\n'] });
    expect(JSON.stringify(result.io)).not.toMatch(/fixture|private-parent|baby-care-backup-/);
  });

  test.each([
    ['BABY_CARE_DATABASE_URL', 'postgres://forbidden'],
    ['BABY_CARE_BACKUP_SQL', 'select forbidden'],
    ['BABY_CARE_COMPOSE_FILE', '/fixture/forbidden'],
    ['BABY_CARE_RESTORE_FLAGS', '--clean'],
  ])('rejects unknown operator configuration key %s without echoing it', async (key, value) => {
    const result = await run(['backup:verify'], { ...validEnv, [key]: value });
    expect(result.exitCode).toBe(2);
    expect(result.io).toEqual({ stdout: [], stderr: ['operator_config_invalid\n'] });
    expect(JSON.stringify(result.io)).not.toContain(value);
  });

  test('accepts ordinary process and application environment keys outside operator namespaces', async () => {
    const result = await run(['backup:verify'], validEnv);
    expect(result.exitCode).toBe(0);
    expect(result.io.stdout).toEqual(['backup_verified\n']);
  });

  test('redacts caught exceptions and maps only allow-listed codes', async () => {
    const deps = dependencies({
      verify: vi.fn(async () => {
        throw Object.assign(new Error('postgres://secret@private absolute/path --clean select *'), {
          code: 'backup_integrity_failed',
        });
      }),
    });
    const result = await run(['backup:verify'], validEnv, deps);
    expect(result.exitCode).toBe(1);
    expect(result.io).toEqual({ stdout: [], stderr: ['backup_integrity_failed\n'] });
    expect(JSON.stringify(result.io)).not.toMatch(/secret|private|--clean|select/i);
  });

  test('reports an existing final bundle without invoking another operator action', async () => {
    const deps = dependencies({
      create: vi.fn(async () => {
        throw Object.assign(new Error('hidden final bundle path'), { code: 'backup_exists' });
      }),
    });
    const result = await run(['backup:create'], validEnv, deps);
    expect(result.exitCode).toBe(1);
    expect(result.io).toEqual({ stdout: [], stderr: ['backup_exists\n'] });
    expect(result.deps.verify).not.toHaveBeenCalled();
    expect(result.deps.restore).not.toHaveBeenCalled();
    expect(result.deps.restoreVerify).not.toHaveBeenCalled();
  });

  test('help lists only generic keys and commands without parsing effective values', async () => {
    const result = await run(['backup:verify', '--help'], {
      BABY_CARE_BACKUP_PARENT: '/fixture/must-not-print',
    });
    expect(result.exitCode).toBe(0);
    expect(result.io.stderr).toEqual([]);
    expect(result.io.stdout.join('')).toContain('backup:restore-verify');
    expect(result.io.stdout.join('')).toContain('BABY_CARE_BACKUP_PARENT');
    expect(result.io.stdout.join('')).not.toContain('/fixture/must-not-print');
  });

  test('rejects a malformed dependency success result instead of printing it', async () => {
    const deps = dependencies({
      verify: vi.fn(async () => ({ code: 'restore_verified' }) as never),
    });
    const result = await run(['backup:verify'], validEnv, deps);
    expect(result.exitCode).toBe(1);
    expect(result.io).toEqual({ stdout: [], stderr: ['operator_failed\n'] });
  });
});

type RunDisposableRestore = (options: {
  createTarget(): Promise<void>;
  waitForTarget(): Promise<void>;
  restore(): Promise<{
    code: 'restore_verified'; revokedSessionCount: number;
  }>;
  startProbe(): Promise<void>;
  executeProbe(): Promise<{ summaryExecutable: true; timelineExecutable: true }>;
  teardown(): Promise<void>;
}) => Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;

const runDisposableRestore: RunDisposableRestore = sourceRunDisposableRestore;

describe('disposable restore lifecycle', () => {
  test.each(['success', 'failure'] as const)('tears down only after the %s path settles', async (mode) => {
    expect(runDisposableRestore).toBeTypeOf('function');
    const order: string[] = [];
    const result = runDisposableRestore!({
      createTarget: async () => { order.push('create-target'); },
      waitForTarget: async () => { order.push('target-healthy'); },
      restore: async () => {
        order.push('restore');
        if (mode === 'failure') throw new Error('synthetic failure');
        order.push('restore-verified');
        return { code: 'restore_verified', revokedSessionCount: 1 };
      },
      startProbe: async () => { order.push('start-probe'); },
      executeProbe: async () => {
        order.push('execute-probe');
        return { summaryExecutable: true, timelineExecutable: true };
      },
      teardown: async () => { order.push('teardown'); },
    });

    if (mode === 'success') {
      await expect(result).resolves.toEqual({ code: 'restore_verified', revokedSessionCount: 1 });
      expect(order).toEqual([
        'create-target', 'target-healthy', 'restore', 'restore-verified',
        'start-probe', 'execute-probe', 'teardown',
      ]);
    } else {
      await expect(result).rejects.toThrow('synthetic failure');
      expect(order).toEqual(['create-target', 'target-healthy', 'restore', 'teardown']);
    }
  });

  test('tears down partial resources when target creation itself fails', async () => {
    expect(runDisposableRestore).toBeTypeOf('function');
    const order: string[] = [];
    await expect(runDisposableRestore!({
      createTarget: async () => {
        order.push('create-target');
        throw new Error('partial create');
      },
      waitForTarget: async () => { order.push('target-healthy'); },
      restore: async () => ({ code: 'restore_verified', revokedSessionCount: 0 }),
      startProbe: async () => { order.push('start-probe'); },
      executeProbe: async () => ({ summaryExecutable: true, timelineExecutable: true }),
      teardown: async () => { order.push('teardown'); },
    })).rejects.toThrow('partial create');
    expect(order).toEqual(['create-target', 'teardown']);
  });

  test('fails closed when the post-restore operational probe is malformed', async () => {
    expect(runDisposableRestore).toBeTypeOf('function');
    await expect(runDisposableRestore!({
      createTarget: async () => undefined,
      waitForTarget: async () => undefined,
      restore: async () => ({ code: 'restore_verified', revokedSessionCount: 0 }),
      startProbe: async () => undefined,
      executeProbe: async () => ({ summaryExecutable: false, timelineExecutable: true }) as never,
      teardown: async () => undefined,
    })).rejects.toMatchObject({ code: 'restore_read_model_failed' });
  });
});

type RunExistingTargetRestore = (options: {
  assertTargetRunning(): Promise<void>;
  restore(): Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;
}) => Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;

const runExistingTargetRestore: RunExistingTargetRestore = sourceRunExistingTargetRestore;

test('ordinary restore only checks a separately running target and performs no lifecycle action', async () => {
  expect(runExistingTargetRestore).toBeTypeOf('function');
  const order: string[] = [];
  await expect(runExistingTargetRestore!({
    assertTargetRunning: async () => { order.push('target-running'); },
    restore: async () => {
      order.push('restore');
      return { code: 'restore_verified', revokedSessionCount: 1 };
    },
  })).resolves.toEqual({ code: 'restore_verified', revokedSessionCount: 1 });
  expect(order).toEqual(['target-running', 'restore']);
});

interface ComposeExecRequest {
  project: string;
  service: string;
  executable: string;
  args: readonly string[];
  input?: Readable;
  output?: NodeJS.WritableStream;
}

interface ComposeExecutor {
  exec(request: ComposeExecRequest, signal: AbortSignal): Promise<Buffer>;
  lifecycle(request: ComposeLifecycleRequest, signal: AbortSignal): Promise<Buffer>;
}

type ComposeLifecycleRequest =
  | { action: 'project-status'; project: string }
  | {
    action: 'project-object-status';
    project: string;
    objectType: 'container' | 'volume' | 'network';
  }
  | { action: 'create-restore-target'; project: string }
  | { action: 'start-restored-probe'; project: string }
  | { action: 'remove-owned-project'; project: string }
  | {
    action: 'running-service';
    project: string;
    service: 'postgres_restore' | 'operations_verifier';
  };

test('preflights repository-contained storage before restore lifecycle or executor work', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'baby-care-repository-'));
  const nestedParent = join(repositoryRoot, 'private-backups');
  await mkdir(nestedParent, { mode: 0o700 });
  try {
    for (const outputParent of [repositoryRoot, nestedParent]) {
      const executor: ComposeExecutor = {
        exec: vi.fn(async () => Buffer.alloc(0)),
        lifecycle: vi.fn(async () => Buffer.alloc(0)),
      };
      const config = sourceParseOperatorConfig({
        ...validEnv,
        BABY_CARE_BACKUP_PARENT: outputParent,
      });
      const dependencies = sourceCreateProductionOperatorDependencies(config, {
        repositoryRoot,
        executor,
      } as never);

      await expect(dependencies.restore()).rejects.toMatchObject({
        code: 'backup_unsafe_storage',
      });
      await expect(dependencies.restoreVerify()).rejects.toMatchObject({
        code: 'backup_unsafe_storage',
      });
      expect(executor.exec).not.toHaveBeenCalled();
      expect(executor.lifecycle).not.toHaveBeenCalled();
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

type CreateComposePostgresRunners = (
  config: {
    sourceProject: string;
    targetProject: string;
    sourceService: string;
    targetService: string;
    verifierService: string;
  },
  executor: ComposeExecutor,
) => {
  backupRunner: {
    toolMajor(request: unknown, signal: AbortSignal): Promise<number>;
    sourceMajor(request: unknown, signal: AbortSignal): Promise<number>;
    migrationHistory(request: unknown, signal: AbortSignal): Promise<unknown>;
    dump(request: unknown, output: NodeJS.WritableStream, signal: AbortSignal): Promise<void>;
    list(request: unknown, input: Readable, signal: AbortSignal): Promise<AsyncIterable<Uint8Array | string>>;
  };
  restoreRunner: {
    restore(
      request: { executable: 'pg_restore'; args: readonly string[] },
      input: Readable,
      signal: AbortSignal,
    ): Promise<void>;
  };
  probeReadModels(signal: AbortSignal): Promise<unknown>;
};

const createComposePostgresRunners: CreateComposePostgresRunners = sourceCreateComposePostgresRunners;

describe('fixed Compose PG16 adapter', () => {
  test('keeps project/service identities fixed and streams dump bytes over stdio', async () => {
    expect(createComposePostgresRunners).toBeTypeOf('function');
    const requests: ComposeExecRequest[] = [];
    const executor: ComposeExecutor = {
      exec: async (request) => {
        requests.push(request);
        if (request.output) request.output.write(Buffer.from('PGDMP synthetic'));
        if (request.executable === 'pg_restore' && request.args.includes('--version')) {
          return Buffer.from('pg_restore (PostgreSQL) 16.10\n');
        }
        if (request.executable === 'psql') return Buffer.from('16\n');
        if (request.executable === 'pnpm') return Buffer.from('restore_read_model_verified\n');
        return Buffer.alloc(0);
      },
      lifecycle: async () => Buffer.alloc(0),
    };
    const runners = createComposePostgresRunners!({
      sourceProject: 'baby-care',
      targetProject: 'baby-care-restore',
      sourceService: 'postgres',
      targetService: 'postgres_restore',
    verifierService: 'operations_verifier',
    }, executor);
    const request = { executable: 'pg_restore', args: ['--version'] };
    expect(await runners.backupRunner.toolMajor(request, new AbortController().signal)).toBe(16);
    expect(await runners.backupRunner.sourceMajor({}, new AbortController().signal)).toBe(16);
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    await runners.backupRunner.dump(
      { executable: 'pg_dump', args: ['--format=custom', '--no-owner', '--no-privileges', '--file=-'] },
      output,
      new AbortController().signal,
    );
    output.end();
    expect(Buffer.concat(chunks).toString('utf8')).toBe('PGDMP synthetic');
    await runners.restoreRunner.restore({
      executable: 'pg_restore',
      args: ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname=babycare'],
    }, Readable.from(['PGDMP synthetic']), new AbortController().signal);
    await expect(runners.probeReadModels(new AbortController().signal)).resolves.toEqual({
      summaryExecutable: true,
      timelineExecutable: true,
    });

    expect(requests.map(({ project, service }) => [project, service])).toEqual([
      ['baby-care', 'postgres'],
      ['baby-care', 'postgres'],
      ['baby-care', 'postgres'],
      ['baby-care-restore', 'postgres_restore'],
      ['baby-care-restore', 'operations_verifier'],
    ]);
    expect(requests[1]?.args).toEqual([
      '--no-psqlrc', '--username=babycare', '--dbname=babycare',
      '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--field-separator=\t',
    ]);
    expect(requests[2]?.args).toEqual([
      '--format=custom', '--no-owner', '--no-privileges',
      '--username=babycare', '--dbname=babycare',
    ]);
    expect(requests[3]?.args).toEqual([
      '--exit-on-error', '--no-owner', '--no-privileges', '--dbname=babycare',
      '--username=babycare',
    ]);
    const serialized = JSON.stringify(requests.map(({ executable, args }) => ({ executable, args })));
    expect(serialized).not.toMatch(/postgres:\/\/|password|secret|select |--clean|--create|--role|--schema/i);
  });

  test.each([
    ['other-project', 'baby-care-restore', 'postgres', 'postgres_restore', 'operations_verifier'],
    ['baby-care', 'wrong-target', 'postgres', 'postgres_restore', 'operations_verifier'],
    ['baby-care', 'baby-care-restore', 'db', 'postgres_restore', 'operations_verifier'],
    ['baby-care', 'baby-care-restore', 'postgres', 'postgres', 'operations_verifier'],
    ['baby-care', 'baby-care-restore', 'postgres', 'postgres_restore', 'api'],
  ])('rejects non-fixed Compose identity', (sourceProject, targetProject, sourceService, targetService, verifierService) => {
    expect(createComposePostgresRunners).toBeTypeOf('function');
    const executor: ComposeExecutor = {
      exec: vi.fn(),
      lifecycle: vi.fn(),
    };
    expect(() => createComposePostgresRunners!({
      sourceProject,
      targetProject,
      sourceService,
      targetService,
      verifierService,
    }, executor)).toThrowError('operator_config_invalid');
  });
});

type CreateDockerComposeExecutor = (options: {
  repositoryRoot: string;
  killSettlementMs?: number;
  processTimeoutMs?: number;
  spawnProcess?: (command: string, args: readonly string[], options: { cwd: string; shell: false; stdio: readonly string[] }) => {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill(signal: NodeJS.Signals): boolean;
    once(event: 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
  };
}) => ComposeExecutor;

const createDockerComposeExecutor: CreateDockerComposeExecutor = sourceCreateDockerComposeExecutor;

function fakeChild() {
  const events = new EventEmitter();
  const child = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn((_signal: NodeJS.Signals) => true),
    once: events.once.bind(events),
  };
  return { child, events };
}

describe('bounded Docker Compose child execution', () => {
  test('uses fixed relative Compose files, no shell, capped hidden stderr and streamed stdin/stdout', async () => {
    expect(createDockerComposeExecutor).toBeTypeOf('function');
    const { child, events } = fakeChild();
    const spawned: Array<{ command: string; args: readonly string[]; options: unknown }> = [];
    const executor = createDockerComposeExecutor!({
      repositoryRoot: '/fixture/repository',
      spawnProcess: (command, args, options) => {
        spawned.push({ command, args, options });
        queueMicrotask(() => {
          child.stderr.end('postgres://secret@private raw failure');
          child.stdout.end('16\n');
          events.emit('close', 0, null);
        });
        return child;
      },
    });
    const output = await executor.exec({
      project: 'baby-care',
      service: 'postgres',
      executable: 'psql',
      args: ['--no-psqlrc'],
      input: Readable.from(['select fixed']),
    }, new AbortController().signal);
    expect(output.toString('utf8')).toBe('16\n');
    expect(spawned).toEqual([{
      command: 'docker',
      args: [
        'compose', '--profile', 'operations', '--project-name', 'baby-care', '--file', 'compose.yaml',
        '--file', 'infra/backup/compose.operations.yaml', 'exec', '--no-TTY',
        'postgres', 'psql', '--no-psqlrc',
      ],
      options: { cwd: '/fixture/repository', shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    }]);
    expect(JSON.stringify(spawned)).not.toMatch(/secret|select fixed/);
  });

  test.each([
    ['container', ['ps', '--all', '--quiet']],
    ['volume', ['volume', 'ls', '--quiet']],
    ['network', ['network', 'ls', '--quiet']],
  ] as const)('queries project-labelled %s objects without Compose scoping', async (objectType, prefix) => {
    const { child, events } = fakeChild();
    const spawned: Array<{ command: string; args: readonly string[] }> = [];
    const executor = createDockerComposeExecutor!({
      repositoryRoot: '/fixture/repository',
      spawnProcess: (command, args) => {
        spawned.push({ command, args });
        queueMicrotask(() => {
          child.stdout.end('object-id');
          child.stderr.end();
          events.emit('close', 0, null);
        });
        return child;
      },
    });
    const project = 'baby-care-restore-0123456789abcdef01234567';

    await expect(executor.lifecycle({
      action: 'project-object-status',
      project,
      objectType,
    }, new AbortController().signal)).resolves.toEqual(Buffer.from('object-id'));

    expect(spawned).toEqual([{
      command: 'docker',
      args: [...prefix, '--filter', 'label=com.docker.compose.project=' + project],
    }]);
  });

  test('aborts then waits for child close before returning a closed failure', async () => {
    expect(createDockerComposeExecutor).toBeTypeOf('function');
    const { child, events } = fakeChild();
    const order: string[] = [];
    child.kill.mockImplementation((signal) => {
      order.push(`kill-${signal}`);
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        order.push('close');
        events.emit('close', null, signal);
      });
      return true;
    });
    const executor = createDockerComposeExecutor!({
      repositoryRoot: '/fixture/repository',
      spawnProcess: () => child,
    });
    const controller = new AbortController();
    const result = executor.lifecycle({
      action: 'project-status',
      project: 'baby-care-restore-0123456789abcdef01234567',
    }, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'operator_process_failed' });
    order.push('returned');
    expect(order).toEqual(['kill-SIGTERM', 'close', 'returned']);
  });

  test('waits for child close and all stdio pumps after a child error', async () => {
    expect(createDockerComposeExecutor).toBeTypeOf('function');
    const { child, events } = fakeChild();
    const order: string[] = [];
    const executor = createDockerComposeExecutor!({
      repositoryRoot: '/fixture/repository',
      killSettlementMs: 5,
      spawnProcess: () => {
        queueMicrotask(() => {
          events.emit('error', new Error('hidden spawn failure'));
          setTimeout(() => {
            child.stdout.end();
            child.stderr.end();
            order.push('streams-settled');
            events.emit('close', null, null);
          }, 2);
        });
        return child;
      },
    });

    await expect(executor.lifecycle(
      {
        action: 'project-status',
        project: 'baby-care-restore-0123456789abcdef01234567',
      },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'operator_process_failed' });
    order.push('returned');
    expect(order).toEqual(['streams-settled', 'returned']);
  });

  test('escalates a stderr-cap failure to SIGKILL and settles before returning', async () => {
    expect(createDockerComposeExecutor).toBeTypeOf('function');
    const { child, events } = fakeChild();
    const order: string[] = [];
    let delayedClose: NodeJS.Timeout | undefined;
    child.kill.mockImplementation((signal) => {
      order.push(`kill-${signal}`);
      if (signal === 'SIGTERM') {
        delayedClose = setTimeout(() => {
          child.stdout.end();
          child.stderr.end();
          events.emit('close', null, signal);
        }, 30);
      } else {
        if (delayedClose) clearTimeout(delayedClose);
        child.stdout.end();
        child.stderr.end();
        order.push('close');
        events.emit('close', null, signal);
      }
      return true;
    });
    const executor = createDockerComposeExecutor!({
      repositoryRoot: '/fixture/repository',
      killSettlementMs: 2,
      spawnProcess: () => {
        queueMicrotask(() => child.stderr.write(Buffer.alloc(65_537)));
        return child;
      },
    });

    await expect(executor.lifecycle(
      {
        action: 'project-status',
        project: 'baby-care-restore-0123456789abcdef01234567',
      },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'operator_process_failed' });
    order.push('returned');
    expect(order).toEqual(['kill-SIGTERM', 'kill-SIGKILL', 'close', 'returned']);
  });

  test('bounds a hung lifecycle command and settles its child before failing', async () => {
    expect(createDockerComposeExecutor).toBeTypeOf('function');
    const { child, events } = fakeChild();
    const order: string[] = [];
    child.kill.mockImplementation((signal) => {
      order.push(`kill-${signal}`);
      child.stdout.end();
      child.stderr.end();
      order.push('close');
      events.emit('close', null, signal);
      return true;
    });
    const executor = createDockerComposeExecutor!({
      repositoryRoot: '/fixture/repository',
      processTimeoutMs: 2,
      spawnProcess: () => child,
    });

    await expect(executor.lifecycle({
      action: 'project-status',
      project: 'baby-care-restore-0123456789abcdef01234567',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'operator_process_failed' });
    order.push('returned');
    expect(order).toEqual(['kill-SIGTERM', 'close', 'returned']);
  }, 100);
});

type CreateDisposableComposeLifecycle = (
  executor: ComposeExecutor,
  randomId?: () => string,
) => {
  project: string;
  createTarget(): Promise<void>;
  teardown(): Promise<void>;
};

const createDisposableComposeLifecycle: CreateDisposableComposeLifecycle = sourceCreateDisposableComposeLifecycle;

describe('owned disposable Compose identity', () => {
  test('uses an internal random project and tears down only resources it began creating', async () => {
    expect(createDisposableComposeLifecycle).toBeTypeOf('function');
    const calls: ComposeLifecycleRequest[] = [];
    const executor: ComposeExecutor = {
      exec: async () => Buffer.alloc(0),
      lifecycle: async (request) => {
        calls.push(request);
        if (request.action === 'create-restore-target') throw new Error('partial create');
        return Buffer.alloc(0);
      },
    };
    const lifecycle = createDisposableComposeLifecycle!(
      executor,
      () => '0123456789abcdef01234567',
    );
    expect(lifecycle.project).toBe('baby-care-restore-0123456789abcdef01234567');
    await expect(runDisposableRestore!({
      createTarget: lifecycle.createTarget,
      waitForTarget: async () => undefined,
      restore: async () => ({ code: 'restore_verified', revokedSessionCount: 0 }),
      startProbe: async () => undefined,
      executeProbe: async () => ({ summaryExecutable: true, timelineExecutable: true }),
      teardown: lifecycle.teardown,
    })).rejects.toThrow('partial create');
    expect(calls).toEqual([
      { action: 'project-object-status', project: lifecycle.project, objectType: 'container' },
      { action: 'project-object-status', project: lifecycle.project, objectType: 'volume' },
      { action: 'project-object-status', project: lifecycle.project, objectType: 'network' },
      { action: 'create-restore-target', project: lifecycle.project },
      { action: 'remove-owned-project', project: lifecycle.project },
    ]);
    expect(calls.map((call) => call.action)).not.toContain('start-restored-probe');
    expect(calls.some((call) => call.project === 'baby-care-restore')).toBe(false);
  });

  test.each(['container', 'volume', 'network'] as const)(
    'does not arm teardown when a project-labelled %s pre-exists',
    async (objectType) => {
      expect(createDisposableComposeLifecycle).toBeTypeOf('function');
      const calls: ComposeLifecycleRequest[] = [];
      const executor: ComposeExecutor = {
        exec: async () => Buffer.alloc(0),
        lifecycle: async (request) => {
          calls.push(request);
          if (request.action === 'project-object-status' && request.objectType === objectType) {
            return Buffer.from('preexisting-object-id\n');
          }
          return Buffer.alloc(0);
        },
      };
      const lifecycle = createDisposableComposeLifecycle!(executor, () => 'abcdefabcdefabcdefabcdef');
      await expect(runDisposableRestore!({
        createTarget: lifecycle.createTarget,
        waitForTarget: async () => undefined,
        restore: async () => ({ code: 'restore_verified', revokedSessionCount: 0 }),
        startProbe: async () => undefined,
        executeProbe: async () => ({ summaryExecutable: true, timelineExecutable: true }),
        teardown: lifecycle.teardown,
      })).rejects.toMatchObject({ code: 'restore_target_not_empty' });
      const objectTypes = ['container', 'volume', 'network'] as const;
      expect(calls).toEqual(objectTypes
        .slice(0, objectTypes.indexOf(objectType) + 1)
        .map((type) => ({
          action: 'project-object-status',
          project: lifecycle.project,
          objectType: type,
        })));
      expect(calls.map((call) => call.action)).not.toContain('remove-owned-project');
    },
  );
});

test('restore overlay is profile-isolated and never starts a migrating API process', async () => {
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const overlay = await readFile(`${repositoryRoot}/infra/backup/compose.operations.yaml`, 'utf8');
  const dockerIgnore = await readFile(`${repositoryRoot}/.dockerignore`, 'utf8');
  expect(overlay.match(/profiles: \["operations"\]/g)).toHaveLength(3);
  const postRestoreService = overlay.split('  restored_api_probe:')[1]?.split('\nvolumes:')[0] ?? '';
  expect(postRestoreService).toContain('command: ["sleep", "infinity"]');
  expect(postRestoreService).not.toMatch(/API_HOST|API_PORT|SETUP_TOKEN|migrate|start/);
  expect(dockerIgnore.split('\n')).toContain('**/.native');
});
