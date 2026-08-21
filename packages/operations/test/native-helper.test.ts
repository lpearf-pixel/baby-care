import { constants, closeSync, openSync } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';

import { openPrivateDirectory } from '../src/private-files.js';
import { publishPrivateBundle } from '../src/native-helper.js';

const helperPath = fileURLToPath(new URL('../.native/safe-bundle', import.meta.url));
const testHelperPath = fileURLToPath(new URL('../.native/safe-bundle-test', import.meta.url));
const buildScriptPath = fileURLToPath(
  new URL('../scripts/build-native-helper.mjs', import.meta.url),
);
const installerSourcePath = fileURLToPath(
  new URL('../native/install-helper.c', import.meta.url),
);
const installerPreservationHarnessPath = fileURLToPath(
  new URL('./install-helper-preservation-harness.c', import.meta.url),
);
const nativeSourceDirectory = fileURLToPath(new URL('../native/', import.meta.url));
const roots: string[] = [];
const finalName = 'baby-care-backup-20260817T123456Z';

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-native-helper-')));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function privateTemporary(root: string): Promise<string> {
  const temporary = await mkdtemp(join(root, '.baby-care-backup-tmp-'));
  await chmod(temporary, 0o700);
  return temporary;
}

async function writeContractFiles(temporary: string): Promise<void> {
  await writeFile(join(temporary, 'database.dump'), 'generated', { mode: 0o600 });
  await writeFile(join(temporary, 'manifest.json'), '{}', { mode: 0o600 });
}

async function copyNativeBuildPackage(packageRoot: string): Promise<void> {
  const scripts = join(packageRoot, 'scripts');
  const native = join(packageRoot, 'native');
  await mkdir(scripts, { recursive: true });
  await mkdir(native, { recursive: true });
  await copyFile(buildScriptPath, join(scripts, 'build-native-helper.mjs'));
  for (const name of await readdir(nativeSourceDirectory)) {
    await copyFile(join(nativeSourceDirectory, name), join(native, name));
  }
}

function compileInstaller(sourcePath: string, outputPath: string): void {
  const result = spawnSync(
    '/usr/bin/cc',
    [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wpedantic',
      '-Wconversion',
      '-Wsign-conversion',
      '-Wformat=2',
      '-Wshadow',
      '-Wstrict-prototypes',
      '-fstack-protector-strong',
      sourcePath,
      '-o',
      outputPath,
    ],
    {
      env: {
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin',
        TMPDIR: tmpdir(),
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  expect(result.status, result.stderr).toBe(0);
}

function runInstaller(
  installerPath: string,
  operation: 'install-production' | 'install-testing',
  directoryFd: number,
  artifactFd: number,
) {
  return spawnSync(installerPath, [operation], {
    env: {},
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', directoryFd, artifactFd],
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('safe-bundle native protocol', () => {
  test.each([
    ['unknown operation', ['remove', '.baby-care-backup-tmp-ABC123']],
    ['absolute path', ['cleanup', '/forbidden/.baby-care-backup-tmp-ABC123']],
    ['separator', ['cleanup', 'nested/.baby-care-backup-tmp-ABC123']],
    ['arbitrary flag', ['publish', '.baby-care-backup-tmp-ABC123', finalName, 'RENAME_SWAP']],
    [
      'test-only source-swap operation in production',
      ['publish-source-swap-test', '.baby-care-backup-tmp-ABC123', finalName],
    ],
    [
      'test-only quarantine-fsync operation in production',
      [
        'publish-source-swap-quarantine-fsync-failure-test',
        '.baby-care-backup-tmp-ABC123',
        finalName,
      ],
    ],
  ])('rejects %s with one stable closed protocol result', async (_name, args) => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(helperPath, args, {
        env: {},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd],
      });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe('safe_bundle_v1:protocol_error\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });

  test('rejects an unexpected inherited descriptor', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(helperPath, ['publish', basename(temporary), finalName], {
        env: {},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd, parentFd],
      });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe('safe_bundle_v1:protocol_error\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });
});

describe('native helper build boundary', () => {
  test('rejects a package-local .native symlink before writing through it', async () => {
    const root = await privateRoot();
    const packageRoot = join(root, 'package');
    const outside = join(root, 'outside');
    await copyNativeBuildPackage(packageRoot);
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, join(packageRoot, '.native'), 'dir');

    const result = spawnSync(process.execPath, [join(packageRoot, 'scripts', 'build-native-helper.mjs')], {
      env: {},
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('native_helper_build_failed\n');
    expect(result.stderr).toBe('');
    expect(await readdir(outside)).toEqual([]);
  });

  test('rejects directory-swap mutation arguments without changing .native', async () => {
    const root = await privateRoot();
    const packageRoot = join(root, 'package');
    const outside = join(packageRoot, '.native-build-swap-external');
    const displaced = join(packageRoot, '.native-build-swap-original');
    await copyNativeBuildPackage(packageRoot);
    await mkdir(outside, { mode: 0o700 });
    await writeFile(join(outside, 'safe-bundle'), 'outside-original', { mode: 0o700 });

    const result = spawnSync(
      process.execPath,
      [join(packageRoot, 'scripts', 'build-native-helper.mjs'), '--test-directory-swap'],
      {
        env: {},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('native_helper_build_failed\n');
    expect(result.stderr).toBe('');
    expect(await readFile(join(outside, 'safe-bundle'), 'utf8')).toBe('outside-original');
    expect(await readdir(outside)).toEqual(['safe-bundle']);
    await expect(lstat(join(packageRoot, '.native'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(displaced)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('installer publishes through a held directory after its .native pathname is replaced', async () => {
    const root = await privateRoot();
    const native = join(root, '.native');
    const displaced = join(root, '.native-original');
    const outside = join(root, 'outside');
    const installer = join(root, 'native-installer');
    await mkdir(native, { mode: 0o700 });
    await mkdir(outside, { mode: 0o700 });
    await writeFile(join(outside, 'safe-bundle'), 'outside-original', { mode: 0o700 });
    compileInstaller(installerSourcePath, installer);
    const directoryFd = openSync(native, constants.O_RDONLY);
    const artifactFd = openSync(helperPath, constants.O_RDONLY);
    try {
      await rename(native, displaced);
      await symlink(outside, native, 'dir');
      const result = runInstaller(installer, 'install-production', directoryFd, artifactFd);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('native_installer_v1:installed\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(artifactFd);
      closeSync(directoryFd);
    }
    expect(await readFile(join(outside, 'safe-bundle'), 'utf8')).toBe('outside-original');
    expect(await readdir(outside)).toEqual(['safe-bundle']);
    await expect(readFile(join(displaced, 'safe-bundle'))).resolves.not.toHaveLength(0);
  });

  test('installer randomizes its private temporary basename', async () => {
    const root = await privateRoot();
    const native = join(root, '.native');
    const installer = join(root, 'native-installer');
    const fixedTemporary = join(native, '.safe-bundle-install-production');
    await mkdir(native, { mode: 0o700 });
    await writeFile(fixedTemporary, 'pre-existing', { mode: 0o700 });
    compileInstaller(installerSourcePath, installer);
    const directoryFd = openSync(native, constants.O_RDONLY);
    const artifactFd = openSync(helperPath, constants.O_RDONLY);
    try {
      const result = runInstaller(installer, 'install-production', directoryFd, artifactFd);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('native_installer_v1:installed\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(artifactFd);
      closeSync(directoryFd);
    }
    expect(await readFile(fixedTemporary, 'utf8')).toBe('pre-existing');
    await expect(readFile(join(native, 'safe-bundle'))).resolves.not.toHaveLength(0);
  });

  test('installer preserves a replacement at its private temp basename after failure', async () => {
    const root = await privateRoot();
    const native = join(root, '.native');
    const installer = join(root, 'native-installer-preservation-test');
    await mkdir(native, { mode: 0o700 });
    compileInstaller(installerPreservationHarnessPath, installer);
    const directoryFd = openSync(native, constants.O_RDONLY);
    const artifactFd = openSync(helperPath, constants.O_RDONLY);
    try {
      const result = runInstaller(installer, 'install-production', directoryFd, artifactFd);
      expect(result.status).toBe(70);
      expect(result.stdout).toBe('native_installer_v1:operation_failed\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(artifactFd);
      closeSync(directoryFd);
    }
    const entries = (await readdir(native)).sort();
    expect(entries).toContain('.safe-bundle-installer-test-original');
    const retainedReplacement = entries.filter((entry) =>
      /^\.safe-bundle-install-[a-f0-9]{32}$/.test(entry),
    );
    expect(retainedReplacement).toHaveLength(1);
    expect(await readFile(join(native, retainedReplacement[0]!), 'utf8')).toBe('replacement');
  });
});

describe('native no-replace publication', () => {
  test('preserves a concurrently-created empty final directory', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const final = join(root, finalName);
    await mkdir(final, { mode: 0o700 });
    const concurrentIdentity = await lstat(final);
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    try {
      await expect(
        publishPrivateBundle(
          parentHandle,
          temporaryHandle,
          basename(temporary),
          finalName,
        ),
      ).rejects.toThrowError('backup_exists');
      const preservedIdentity = await lstat(final);
      expect([preservedIdentity.dev, preservedIdentity.ino]).toEqual([
        concurrentIdentity.dev,
        concurrentIdentity.ino,
      ]);
      expect((await readdir(temporary)).sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      await temporaryHandle.close();
      await parentHandle.close();
    }
  });

  test('quarantines a source swapped after validation and leaves no final entry', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(
        testHelperPath,
        ['publish-source-swap-test', basename(temporary), finalName],
        {
          env: {},
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd],
        },
      );
      expect(result.status).toBe(71);
      expect(result.stdout).toBe('safe_bundle_v1:quarantined\n');
      expect(result.stderr).toBe('');
      await expect(lstat(join(root, finalName))).rejects.toMatchObject({ code: 'ENOENT' });
      const entries = (await readdir(root)).sort();
      expect(entries).toContain('.baby-care-helper-test-original');
      expect(entries.filter((entry) => /^\.baby-care-backup-quarantine-[a-f0-9]{32}$/.test(entry)))
        .toHaveLength(1);
      expect((await readdir(join(root, '.baby-care-helper-test-original'))).sort()).toEqual([
        'database.dump',
        'manifest.json',
      ]);
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });

  test('reports quarantine failure when the required parent fsync fails', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(
        testHelperPath,
        [
          'publish-source-swap-quarantine-fsync-failure-test',
          basename(temporary),
          finalName,
        ],
        {
          env: {},
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd],
        },
      );
      expect(result.status).toBe(72);
      expect(result.stdout).toBe('safe_bundle_v1:quarantine_failed\n');
      expect(result.stderr).toBe('');
      await expect(lstat(join(root, finalName))).rejects.toMatchObject({ code: 'ENOENT' });
      const entries = (await readdir(root)).sort();
      expect(entries).toContain('.baby-care-helper-test-original');
      expect(entries.filter((entry) => /^\.baby-care-backup-quarantine-[a-f0-9]{32}$/.test(entry)))
        .toHaveLength(1);
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });

  test('retains the original temporary bundle after no-replace publication is refused', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    await mkdir(join(root, finalName), { mode: 0o700 });
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    try {
      await expect(
        publishPrivateBundle(
          parentHandle,
          temporaryHandle,
          basename(temporary),
          finalName,
        ),
      ).rejects.toThrowError('backup_exists');
      expect((await readdir(temporary)).sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      await temporaryHandle.close();
      await parentHandle.close();
    }
  });
});

describe('preservation-first failure state', () => {
  test('does not expose automatic cleanup and preserves the complete temporary bundle', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(helperPath, ['cleanup', basename(temporary)], {
        env: {},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd],
      });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe('safe_bundle_v1:protocol_error\n');
      expect(result.stderr).toBe('');
      expect((await readdir(temporary)).sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });

  test('preserves a replacement and non-contract entry without invoking deletion', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const displaced = join(root, 'displaced-owned-temp');
    await rename(temporary, displaced);
    await mkdir(temporary, { mode: 0o700 });
    await writeFile(join(temporary, 'unexpected'), 'preserve replacement', { mode: 0o600 });
    expect(await readFile(join(temporary, 'unexpected'), 'utf8')).toBe('preserve replacement');
    expect((await readdir(displaced)).sort()).toEqual(['database.dump', 'manifest.json']);
  });
});
