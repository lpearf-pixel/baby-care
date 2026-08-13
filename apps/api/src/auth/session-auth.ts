export const SESSION_COOKIE_NAME = 'baby_care_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === SESSION_COOKIE_NAME) {
      const value = rawValue.join('=');
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export function serializeSessionCookie(rawToken: string, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function serializeClearedSessionCookie(secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}
