const BASE_URL = 'http://127.0.0.1:8080';
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-development-setup-token-change-me';
const attempts = 30;
const delayMs = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(path, expectedStatus = 200) {
  let last = 'not attempted';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(3000) });
      last = `status=${response.status}`;
      if (response.status === expectedStatus) return response;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(delayMs);
  }
  throw new Error(`SMOKE_FAILED path=${path} expected=${expectedStatus} actual=${last}`);
}

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('SMOKE_FAILED expected session cookie');
  const cookie = setCookie.split(';', 1)[0];
  if (!cookie?.startsWith('baby_care_session=')) {
    throw new Error('SMOKE_FAILED unexpected session cookie');
  }
  return cookie;
}

async function request(path, { method = 'GET', body, cookie, expectedStatus = 200, setupToken } = {}) {
  const headers = { accept: 'application/json' };
  if (!['GET', 'HEAD'].includes(method)) headers.origin = APP_ORIGIN;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (setupToken) headers['x-baby-care-setup-token'] = setupToken;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  let payload;
  if (response.status !== 204) {
    const text = await response.text();
    payload = text ? JSON.parse(text) : undefined;
  }

  if (response.status !== expectedStatus) {
    const code = payload && typeof payload === 'object' ? payload.code ?? 'unknown' : 'none';
    throw new Error(`SMOKE_FAILED path=${path} expected=${expectedStatus} actual=${response.status} code=${code}`);
  }

  return { response, payload };
}

await waitFor('/');
await waitFor('/api/health');
console.log('SMOKE_OK component=health');

const setupStatus = await request('/api/setup/status');
if (setupStatus.payload?.required !== true) {
  throw new Error('SMOKE_FAILED setup/status expected required=true');
}

await request('/api/setup', {
  method: 'POST',
  expectedStatus: 201,
  setupToken: SETUP_TOKEN,
  body: {
    familyName: 'Xiangxiang Family',
    babyDisplayName: 'xiangxiang',
    dad: { loginName: 'dad', password: 'dad-smoke-password' },
    mom: { loginName: 'mom', password: 'mom-smoke-password' },
  },
});
console.log('SMOKE_OK component=setup');

const dadLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { loginName: 'dad', password: 'dad-smoke-password' },
});
const dadCookie = cookieFrom(dadLogin.response);

const dadSession = await request('/api/auth/session', { cookie: dadCookie });
if (dadSession.payload?.relationship !== 'dad' || dadSession.payload?.permissionLevel !== 'family_admin') {
  throw new Error('SMOKE_FAILED Dad session role mismatch');
}
console.log('SMOKE_OK component=dad-session');

await request('/api/family/members', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-smoke-password' },
});

const nannyLogin = await request('/api/auth/login', {
  method: 'POST',
  body: { loginName: 'nanny', password: 'nanny-smoke-password' },
});
const nannyCookie = cookieFrom(nannyLogin.response);

const nannyBaby = await request('/api/baby', { cookie: nannyCookie });
if (nannyBaby.payload?.displayName !== 'xiangxiang') {
  throw new Error('SMOKE_FAILED Nanny baby read mismatch');
}

const nannyForbidden = await request('/api/family', {
  method: 'PATCH',
  expectedStatus: 403,
  cookie: nannyCookie,
  body: { name: 'Forbidden Change' },
});
if (nannyForbidden.payload?.code !== 'forbidden') {
  throw new Error('SMOKE_FAILED Nanny admin denial code mismatch');
}

const dadUpdate = await request('/api/family', {
  method: 'PATCH',
  cookie: dadCookie,
  body: { name: 'Xiangxiang Home' },
});
if (dadUpdate.payload?.name !== 'Xiangxiang Home') {
  throw new Error('SMOKE_FAILED Dad family update mismatch');
}

console.log('SMOKE_OK component=m1-family-authorization');
