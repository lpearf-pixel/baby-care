import { constants } from 'node:fs';
import { chmod, mkdir, rename, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(packageRoot, 'native', 'safe-bundle.c');
const outputDirectory = resolve(packageRoot, '.native');
const output = resolve(outputDirectory, 'safe-bundle');
const temporaryOutput = resolve(outputDirectory, `.safe-bundle-build-${process.pid}`);
const compiler = '/usr/bin/cc';

async function fail() {
  await unlink(temporaryOutput).catch(() => undefined);
  process.stdout.write('native_helper_build_failed\n');
  process.exit(1);
}

if (process.platform !== 'darwin' && process.platform !== 'linux') {
  await fail();
}

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await chmod(outputDirectory, 0o700);

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
  source,
  '-o',
  temporaryOutput,
];
if (process.platform === 'linux') flags.splice(flags.length - 3, 0, '-D_FORTIFY_SOURCE=2');

const result = spawnSync(compiler, flags, {
  env: {
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin',
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
  },
  stdio: 'ignore',
  timeout: 30_000,
});
if (result.error || result.signal || result.status !== 0) {
  await fail();
}

await chmod(temporaryOutput, constants.S_IRWXU);
await rename(temporaryOutput, output);
await chmod(output, constants.S_IRWXU);
process.stdout.write('native_helper_built\n');
