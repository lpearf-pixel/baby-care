import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(packageRoot, 'native', 'safe-bundle.c');
const outputDirectory = resolve(packageRoot, '.native');
const compiler = '/usr/bin/cc';
const buildTests = process.argv.length === 3 && process.argv[2] === '--test';
const validArguments = process.argv.length === 2 || buildTests;

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

async function compileHelper(directoryHandle, sourceHandle, name, testing) {
  const sourceDescriptor = process.platform === 'darwin' ? '/dev/fd/4' : '/proc/self/fd/4';
  const temporaryName = `.safe-bundle-build-${randomBytes(12).toString('hex')}`;
  const temporaryPath = join(outputDirectory, temporaryName);
  const outputPath = join(outputDirectory, name);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-native-build-')));
  const compiledPath = join(scratch, 'safe-bundle');
  const scratchStat = await lstat(scratch);
  if (
    !scratchStat.isDirectory() ||
    scratchStat.isSymbolicLink() ||
    !ownedByCurrentUser(scratchStat.uid) ||
    (scratchStat.mode & 0o777) !== 0o700
  ) {
    throw new Error('unsafe');
  }
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
  flags.push('-x', 'c', sourceDescriptor, '-o', compiledPath);

  try {
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
    await assertBuildDirectoryIdentity(directoryHandle);
    let compiled;
    let artifact;
    try {
      compiled = await open(
        compiledPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      artifact = await open(
        temporaryPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o700,
      );
      await assertBuildDirectoryIdentity(directoryHandle);
      const compiledStat = await compiled.stat();
      if (!compiledStat.isFile() || !ownedByCurrentUser(compiledStat.uid)) {
        throw new Error('unsafe');
      }
      await artifact.writeFile(await compiled.readFile());
      await artifact.chmod(0o700);
      await artifact.sync();
      const stat = await artifact.stat();
      if (!stat.isFile() || !ownedByCurrentUser(stat.uid) || (stat.mode & 0o777) !== 0o700) {
        throw new Error('unsafe');
      }
    } finally {
      await artifact?.close().catch(() => undefined);
      await compiled?.close().catch(() => undefined);
    }
    await assertBuildDirectoryIdentity(directoryHandle);
    await rename(temporaryPath, outputPath);
    await directoryHandle.sync();
    await assertBuildDirectoryIdentity(directoryHandle);
  } catch (error) {
    try {
      await assertBuildDirectoryIdentity(directoryHandle);
      await unlink(temporaryPath).catch(() => undefined);
    } catch {
      // Preserve any ambiguous path when the validated build directory identity changed.
    }
    throw error;
  } finally {
    await unlink(compiledPath).catch(() => undefined);
    await rmdir(scratch).catch(() => undefined);
  }
}

async function main() {
  if (!validArguments || (process.platform !== 'darwin' && process.platform !== 'linux')) {
    throw new Error('unsupported');
  }
  await rejectSymlinkAncestors(dirname(sourcePath));
  if ((await realpath(sourcePath)) !== sourcePath) throw new Error('unsafe');
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !ownedByCurrentUser(sourceStat.uid)) {
    throw new Error('unsafe');
  }
  const directoryHandle = await openBuildDirectory();
  const sourceHandle = await open(
    sourcePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const openedSource = await sourceHandle.stat();
    if (
      !openedSource.isFile() ||
      openedSource.dev !== sourceStat.dev ||
      openedSource.ino !== sourceStat.ino ||
      !ownedByCurrentUser(openedSource.uid)
    ) {
      throw new Error('unsafe');
    }
    await compileHelper(directoryHandle, sourceHandle, 'safe-bundle', false);
    if (buildTests) {
      await compileHelper(directoryHandle, sourceHandle, 'safe-bundle-test', true);
    }
  } finally {
    await sourceHandle.close().catch(() => undefined);
    await directoryHandle.close().catch(() => undefined);
  }
}

try {
  await main();
  process.stdout.write('native_helper_built\n');
} catch {
  process.stdout.write('native_helper_build_failed\n');
  process.exitCode = 1;
}
