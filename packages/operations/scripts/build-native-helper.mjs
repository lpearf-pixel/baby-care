import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(packageRoot, 'native', 'safe-bundle.c');
const installerSourcePath = resolve(packageRoot, 'native', 'install-helper.c');
const outputDirectory = resolve(packageRoot, '.native');
const compiler = '/usr/bin/cc';
const buildTests = process.argv.length === 3 && process.argv[2] === '--test';
const validArguments = process.argv.length === 2 || buildTests;
let failureStage = 'arguments';

function ownedByCurrentUser(uid) {
  return typeof process.getuid !== 'function' || uid === process.getuid();
}

async function rejectSymlinkAncestors(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe');
  }
}

async function openBuildDirectory() {
  await rejectSymlinkAncestors(packageRoot);
  if ((await realpath(packageRoot)) !== packageRoot) throw new Error('unsafe');
  const packageStat = await lstat(packageRoot);
  if (!ownedByCurrentUser(packageStat.uid)) throw new Error('unsafe');

  let missing = false;
  try {
    const stat = await lstat(outputDirectory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !ownedByCurrentUser(stat.uid) ||
      (stat.mode & 0o777) !== 0o700
    ) {
      throw new Error('unsafe');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    missing = true;
  }
  if (missing) await mkdir(outputDirectory, { mode: 0o700 });
  if ((await realpath(outputDirectory)) !== outputDirectory) throw new Error('unsafe');

  const handle = await open(
    outputDirectory,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0),
  );
  const opened = await handle.stat();
  const current = await lstat(outputDirectory);
  if (
    !opened.isDirectory() ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    opened.dev !== current.dev ||
    opened.ino !== current.ino ||
    !ownedByCurrentUser(opened.uid) ||
    (opened.mode & 0o777) !== 0o700 ||
    !ownedByCurrentUser(current.uid) ||
    (current.mode & 0o777) !== 0o700
  ) {
    await handle.close();
    throw new Error('unsafe');
  }
  return handle;
}

async function assertBuildDirectoryIdentity(handle) {
  const opened = await handle.stat();
  const current = await lstat(outputDirectory);
  if (
    !opened.isDirectory() ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    opened.dev !== current.dev ||
    opened.ino !== current.ino ||
    !ownedByCurrentUser(opened.uid) ||
    (opened.mode & 0o777) !== 0o700 ||
    (current.mode & 0o777) !== 0o700
  ) {
    throw new Error('unsafe');
  }
}

function compilerFlags(testing = false) {
  const flags = [
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
  ];
  if (process.platform === 'linux') flags.push('-D_FORTIFY_SOURCE=2');
  if (testing) flags.push('-DSAFE_BUNDLE_TESTING=1');
  return flags;
}

function compileSource(sourceHandle, outputPath, testing = false) {
  const sourceDescriptor = process.platform === 'darwin' ? '/dev/fd/4' : '/proc/self/fd/4';
  const flags = compilerFlags(testing);
  flags.push('-x', 'c', sourceDescriptor, '-o', outputPath);
  const result = spawnSync(compiler, flags, {
    env: {
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ignore', sourceHandle.fd],
    timeout: 30_000,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error('compile');
}

async function assertCompiledArtifact(handle) {
  const stat = await handle.stat();
  if (
    !stat.isFile() ||
    !ownedByCurrentUser(stat.uid) ||
    (stat.mode & 0o022) !== 0 ||
    stat.size <= 0 ||
    stat.size > 1024 * 1024
  ) {
    throw new Error('unsafe');
  }
}

function runInstaller(installerPath, operation, directoryHandle, artifactHandle) {
  const result = spawnSync(installerPath, [operation], {
    env: {},
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', directoryHandle.fd, artifactHandle.fd],
    timeout: 5_000,
  });
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stdout !== 'native_installer_v1:installed\n' ||
    result.stderr !== ''
  ) {
    throw new Error('install');
  }
}

async function installCompiledArtifact(
  installerPath,
  compiledPath,
  operation,
  directoryHandle,
) {
  const artifactHandle = await open(
    compiledPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await assertCompiledArtifact(artifactHandle);
    await assertBuildDirectoryIdentity(directoryHandle);
    runInstaller(installerPath, operation, directoryHandle, artifactHandle);
    await directoryHandle.sync();
    await assertBuildDirectoryIdentity(directoryHandle);
  } finally {
    await artifactHandle.close().catch(() => undefined);
  }
}

async function compileAndInstall(
  directoryHandle,
  sourceHandle,
  installerSourceHandle,
) {
  failureStage = 'scratch_open';
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-native-build-')));
  const installerPath = join(scratch, 'native-installer');
  const productionPath = join(scratch, 'safe-bundle');
  const testingPath = join(scratch, 'safe-bundle-test');
  const scratchStat = await lstat(scratch);
  if (
    !scratchStat.isDirectory() ||
    scratchStat.isSymbolicLink() ||
    !ownedByCurrentUser(scratchStat.uid) ||
    (scratchStat.mode & 0o777) !== 0o700
  ) {
    throw new Error('unsafe');
  }
  try {
    failureStage = 'installer_compile';
    compileSource(installerSourceHandle, installerPath);
    failureStage = 'production_compile';
    compileSource(sourceHandle, productionPath);
    failureStage = 'production_install';
    await installCompiledArtifact(
      installerPath,
      productionPath,
      'install-production',
      directoryHandle,
    );
    if (buildTests) {
      failureStage = 'testing_compile';
      compileSource(sourceHandle, testingPath, true);
      failureStage = 'testing_install';
      await installCompiledArtifact(
        installerPath,
        testingPath,
        'install-testing',
        directoryHandle,
      );
    }
  } finally {
    await unlink(testingPath).catch(() => undefined);
    await unlink(productionPath).catch(() => undefined);
    await unlink(installerPath).catch(() => undefined);
    await rmdir(scratch).catch(() => undefined);
  }
}

async function openBuildSource(path) {
  await rejectSymlinkAncestors(dirname(path));
  if ((await realpath(path)) !== path) throw new Error('unsafe');
  const pathStat = await lstat(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || !ownedByCurrentUser(pathStat.uid)) {
    throw new Error('unsafe');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = await handle.stat();
  if (
    !opened.isFile() ||
    opened.dev !== pathStat.dev ||
    opened.ino !== pathStat.ino ||
    !ownedByCurrentUser(opened.uid)
  ) {
    await handle.close();
    throw new Error('unsafe');
  }
  return handle;
}

async function main() {
  if (!validArguments || (process.platform !== 'darwin' && process.platform !== 'linux')) {
    throw new Error('unsupported');
  }
  let sourceHandle;
  let installerSourceHandle;
  let directoryHandle;
  try {
    failureStage = 'source_open';
    sourceHandle = await openBuildSource(sourcePath);
    failureStage = 'installer_source_open';
    installerSourceHandle = await openBuildSource(installerSourcePath);
    failureStage = 'output_open';
    directoryHandle = await openBuildDirectory();
    await compileAndInstall(directoryHandle, sourceHandle, installerSourceHandle);
  } finally {
    await directoryHandle?.close().catch(() => undefined);
    await installerSourceHandle?.close().catch(() => undefined);
    await sourceHandle?.close().catch(() => undefined);
  }
}

try {
  await main();
  process.stdout.write('native_helper_built\n');
} catch {
  process.stdout.write(`native_helper_build_failed:${failureStage}\n`);
  process.exitCode = 1;
}
