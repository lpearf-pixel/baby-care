import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

const MEMORY = 65_536;
const PASSES = 3;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        parallelism: PARALLELISM,
        tagLength: TAG_LENGTH,
        memory: MEMORY,
        passes: PASSES,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derivePassword(password, salt);
  return `$argon2id$v=19$m=${MEMORY},t=${PASSES},p=${PARALLELISM}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    const parts = encoded.split('$');
    if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19') return false;

    const parameters = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? '');
    if (!parameters) return false;
    if (
      Number(parameters[1]) !== MEMORY ||
      Number(parameters[2]) !== PASSES ||
      Number(parameters[3]) !== PARALLELISM
    ) {
      return false;
    }

    const salt = Buffer.from(parts[4] ?? '', 'base64url');
    const expected = Buffer.from(parts[5] ?? '', 'base64url');
    if (salt.length !== SALT_LENGTH || expected.length !== TAG_LENGTH) return false;

    const actual = await derivePassword(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
