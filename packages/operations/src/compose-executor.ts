import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

import { BackupError } from './contracts.js';
import type {
  ComposeExecRequest,
  ComposeExecutor,
  ComposeLifecycleRequest,
} from './compose-postgres.js';

const MAX_CAPTURE_BYTES = 1_048_576;
const MAX_STDERR_BYTES = 65_536;
const KILL_SETTLEMENT_MS = 1_000;
const PROCESS_TIMEOUT_MS = 30_000;

interface SpawnedChild {
  stdin: Writable;
  stdout: AsyncIterable<Uint8Array | string>;
  stderr: AsyncIterable<Uint8Array | string>;
  kill(signal: NodeJS.Signals): boolean;
  once(event: 'error' | 'close', listener: (...args: unknown[]) => void): unknown;
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: { cwd: string; shell: false; stdio: readonly ['pipe', 'pipe', 'pipe'] },
) => SpawnedChild;

function defaultSpawnProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; shell: false; stdio: readonly ['pipe', 'pipe', 'pipe'] },
): SpawnedChild {
  return spawn(command, [...args], {
    ...options,
    stdio: [...options.stdio],
  }) as ChildProcessWithoutNullStreams;
}

async function writeChunk(destination: Writable, chunk: Buffer): Promise<void> {
  if (destination.write(chunk)) return;
  await once(destination, 'drain');
}

function composePrefix(project: string): string[] {
  return [
    'compose',
    '--profile',
    'operations',
    '--project-name',
    project,
    '--file',
    'compose.yaml',
    '--file',
    'infra/backup/compose.operations.yaml',
  ];
}

function lifecycleArgs(request: ComposeLifecycleRequest): readonly string[] {
  if (!/^baby-care-restore(?:-[a-f0-9]{24})?$/.test(request.project)) throw closed();
  switch (request.action) {
    case 'project-object-status':
      throw closed();
    case 'project-status':
      return ['ps', '--all', '--quiet'];
    case 'create-restore-target':
      return ['up', '--detach', '--no-deps', 'postgres_restore', 'operations_verifier'];
    case 'start-restored-probe':
      return ['up', '--detach', '--no-deps', 'restored_api_probe'];
    case 'remove-owned-project':
      return ['down', '--volumes', '--remove-orphans', '--timeout', '10'];
    case 'running-service':
      return ['ps', '--status', 'running', '--quiet', request.service];
  }
}

function projectObjectArgs(
  request: Extract<ComposeLifecycleRequest, { action: 'project-object-status' }>,
): readonly string[] {
  if (!/^baby-care-restore(?:-[a-f0-9]{24})?$/.test(request.project)) throw closed();
  const prefix = request.objectType === 'container'
    ? ['ps', '--all', '--quiet']
    : request.objectType === 'volume'
      ? ['volume', 'ls', '--quiet']
      : ['network', 'ls', '--quiet'];
  return [
    ...prefix,
    '--filter',
    'label=com.docker.compose.project=' + request.project,
  ];
}

function closed(): BackupError {
  return new BackupError('operator_process_failed');
}

export function createDockerComposeExecutor(options: {
  repositoryRoot: string;
  spawnProcess?: SpawnProcess;
  killSettlementMs?: number;
  processTimeoutMs?: number;
}): ComposeExecutor {
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const killSettlementMs = options.killSettlementMs ?? KILL_SETTLEMENT_MS;
  const processTimeoutMs = options.processTimeoutMs ?? PROCESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(killSettlementMs) || killSettlementMs <= 0) throw closed();
  if (!Number.isSafeInteger(processTimeoutMs) || processTimeoutMs <= 0) throw closed();

  async function execute(
    args: readonly string[],
    signal: AbortSignal,
    input?: NodeJS.ReadableStream,
    output?: Writable,
  ): Promise<Buffer> {
    let child: SpawnedChild;
    try {
      child = spawnProcess('docker', args, {
        cwd: options.repositoryRoot,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw closed();
    }

    let failed = false;
    let terminationStarted = false;
    let forcedKill: NodeJS.Timeout | undefined;
    let hardSettlement: NodeJS.Timeout | undefined;
    const kill = (killSignal: NodeJS.Signals) => {
      try {
        child.kill(killSignal);
      } catch {
        // Settlement remains bounded even if the child handle rejects a signal.
      }
    };
    let resolveClosed!: (result: { code: number | null; bounded: boolean }) => void;
    const closedPromise = new Promise<{ code: number | null; bounded: boolean }>((resolve) => {
      resolveClosed = resolve;
    });
    let closedSettled = false;
    const settleClosed = (result: { code: number | null; bounded: boolean }) => {
      if (closedSettled) return;
      closedSettled = true;
      if (forcedKill) clearTimeout(forcedKill);
      if (hardSettlement) clearTimeout(hardSettlement);
      resolveClosed(result);
    };
    const terminate = () => {
      failed = true;
      if (terminationStarted || closedSettled) return;
      terminationStarted = true;
      kill('SIGTERM');
      forcedKill = setTimeout(() => {
        if (closedSettled) return;
        kill('SIGKILL');
        hardSettlement = setTimeout(
          () => settleClosed({ code: null, bounded: true }),
          killSettlementMs,
        );
        hardSettlement.unref();
      }, killSettlementMs);
      forcedKill.unref();
    };
    const abort = () => terminate();
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => terminate());
    child.once('close', (...values) => settleClosed({
      code: typeof values[0] === 'number' ? values[0] : null,
      bounded: false,
    }));
    const processTimeout = setTimeout(terminate, processTimeoutMs);
    processTimeout.unref();
    if (signal.aborted) abort();

    const monitorPump = async (pump: Promise<void>): Promise<void> => {
      try {
        await pump;
      } catch {
        terminate();
      }
    };

    const inputPump = monitorPump((async () => {
      try {
        if (input) {
          for await (const chunk of input) await writeChunk(child.stdin, Buffer.from(chunk));
        }
        child.stdin.end();
      } catch {
        child.stdin.destroy();
        terminate();
      }
    })());

    const captured: Buffer[] = [];
    const outputPump = monitorPump((async () => {
      let bytes = 0;
      for await (const chunk of child.stdout) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (!output && bytes > MAX_CAPTURE_BYTES) {
          terminate();
          return;
        }
        try {
          if (output) await writeChunk(output, buffer);
          else captured.push(buffer);
        } catch {
          terminate();
          return;
        }
      }
      output?.end();
    })());

    const stderrPump = monitorPump((async () => {
      let bytes = 0;
      for await (const chunk of child.stderr) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_STDERR_BYTES) {
          terminate();
          return;
        }
      }
    })());

    try {
      const result = await closedPromise;
      const pumps = Promise.allSettled([inputPump, outputPump, stderrPump]);
      let pumpTimeout: NodeJS.Timeout | undefined;
      const pumpResult = await Promise.race([
        pumps.then(() => true),
        new Promise<false>((resolve) => {
          pumpTimeout = setTimeout(() => resolve(false), killSettlementMs);
          pumpTimeout.unref();
        }),
      ]);
      if (pumpTimeout) clearTimeout(pumpTimeout);
      if (failed || result.bounded || result.code !== 0 || !pumpResult) {
        throw closed();
      }
      return Buffer.concat(captured);
    } catch {
      throw closed();
    } finally {
      signal.removeEventListener('abort', abort);
      clearTimeout(processTimeout);
      if (forcedKill) clearTimeout(forcedKill);
    }
  }

  return {
    exec(request: ComposeExecRequest, signal: AbortSignal): Promise<Buffer> {
      return execute([
        ...composePrefix(request.project),
        'exec',
        '--no-TTY',
        request.service,
        request.executable,
        ...request.args,
      ], signal, request.input, request.output);
    },
    lifecycle(request, signal): Promise<Buffer> {
      const args = request.action === 'project-object-status'
        ? projectObjectArgs(request)
        : [...composePrefix(request.project), ...lifecycleArgs(request)];
      return execute(args, signal);
    },
  };
}

export function createDisposableComposeLifecycle(
  executor: ComposeExecutor,
  randomId: () => string = () => randomBytes(12).toString('hex'),
): {
  project: string;
  createTarget(): Promise<void>;
  waitForTarget(): Promise<void>;
  startProbe(): Promise<void>;
  executeProbe(): Promise<{ summaryExecutable: true; timelineExecutable: true }>;
  teardown(): Promise<void>;
} {
  const id = randomId();
  if (!/^[a-f0-9]{24}$/.test(id)) throw new BackupError('operator_config_invalid');
  const project = `baby-care-restore-${id}`;
  let owned = false;

  return {
    project,
    async createTarget() {
      const signal = new AbortController().signal;
      for (const objectType of ['container', 'volume', 'network'] as const) {
        const existing = await executor.lifecycle({
          action: 'project-object-status',
          project,
          objectType,
        }, signal);
        if (existing.toString('utf8').trim()) {
          throw new BackupError('restore_target_not_empty');
        }
      }
      owned = true;
      await executor.lifecycle({ action: 'create-restore-target', project }, signal);
    },
    async waitForTarget() {
      let consecutiveReady = 0;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await executor.exec({
            project,
            service: 'postgres_restore',
            executable: 'pg_isready',
            args: ['--username=babycare', '--dbname=babycare'],
          }, new AbortController().signal);
          consecutiveReady += 1;
          if (consecutiveReady === 3) return;
        } catch {
          consecutiveReady = 0;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new BackupError('restore_target_check_failed');
    },
    async startProbe() {
      await executor.lifecycle(
        { action: 'start-restored-probe', project },
        new AbortController().signal,
      );
    },
    async executeProbe() {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          const output = await executor.exec({
            project,
            service: 'restored_api_probe',
            executable: 'pnpm',
            args: [
              '--filter',
              '@baby-care/api',
              'exec',
              'tsx',
              '../../packages/operations/scripts/run-restored-verifier.mts',
            ],
          }, new AbortController().signal);
          if (output.toString('utf8').trim() !== 'restore_read_model_verified') {
            throw new BackupError('restore_read_model_failed');
          }
          return { summaryExecutable: true, timelineExecutable: true };
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      throw new BackupError('restore_read_model_failed');
    },
    async teardown() {
      if (!owned) return;
      try {
        await executor.lifecycle(
          { action: 'remove-owned-project', project },
          new AbortController().signal,
        );
      } finally {
        owned = false;
      }
    },
  };
}

export function createExistingRestoreLifecycle(executor: ComposeExecutor): {
  assertTargetRunning(): Promise<void>;
} {
  return {
    async assertTargetRunning() {
      for (const service of ['postgres_restore', 'operations_verifier']) {
        const output = await executor.lifecycle({
          action: 'running-service',
          project: 'baby-care-restore',
          service: service as 'postgres_restore' | 'operations_verifier',
        }, new AbortController().signal);
        if (!output.toString('utf8').trim()) throw new BackupError('restore_target_check_failed');
      }
    },
  };
}
