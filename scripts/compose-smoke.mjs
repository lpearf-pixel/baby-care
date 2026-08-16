const BASE_URL = 'http://127.0.0.1:8080';
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-development-setup-token-change-me';
const attempts = 30;
const delayMs = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoMinutesAgo(asOf, minutes) {
  return new Date(asOf.getTime() - minutes * 60_000).toISOString();
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

function cookieFrom(response, { secure }) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('SMOKE_FAILED expected session cookie');
  if (!/;\s*HttpOnly(?:;|$)/i.test(setCookie) || !/;\s*SameSite=Lax(?:;|$)/i.test(setCookie)) {
    throw new Error('SMOKE_FAILED session cookie policy mismatch');
  }
  if (/;\s*Secure(?:;|$)/i.test(setCookie) !== secure) {
    throw new Error('SMOKE_FAILED session cookie secure mismatch');
  }
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
const dadCookie = cookieFrom(dadLogin.response, { secure: false });

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
const nannyCookie = cookieFrom(nannyLogin.response, { secure: false });

const nannyFamily = await request('/api/family', { cookie: nannyCookie });
if (nannyFamily.payload?.name !== 'Xiangxiang Family') {
  throw new Error('SMOKE_FAILED Nanny family read mismatch');
}

const nannyBaby = await request('/api/baby', { cookie: nannyCookie });
if (nannyBaby.payload?.displayName !== 'xiangxiang') {
  throw new Error('SMOKE_FAILED Nanny baby read mismatch');
}

const nannyMembers = await request('/api/family/members', { cookie: nannyCookie });
if (!Array.isArray(nannyMembers.payload) || nannyMembers.payload.length !== 3) {
  throw new Error('SMOKE_FAILED Nanny members read mismatch');
}
for (const member of nannyMembers.payload) {
  const fields = Object.keys(member).sort().join(',');
  if (fields !== 'displayName,membershipId,permissionLevel,relationship,status') {
    throw new Error('SMOKE_FAILED Nanny member projection mismatch');
  }
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

const careAsOf = new Date();
const formulaAt = isoMinutesAgo(careAsOf, 30);
const directAt = isoMinutesAgo(careAsOf, 25);
const sleepAt = isoMinutesAgo(careAsOf, 20);
const diaperAt = isoMinutesAgo(careAsOf, 10);

const formulaFeed = await request('/api/care/feeding-sessions', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: {
    occurredAt: formulaAt,
    clientRequestId: crypto.randomUUID(),
    components: [{
      kind: 'bottle',
      liquidType: 'formula',
      amountMl: 60,
      bottleCapacityMl: 150,
    }],
  },
});
const formulaEventId = formulaFeed.payload?.id;
if (typeof formulaEventId !== 'string') throw new Error('SMOKE_FAILED formula event id missing');

await request('/api/care/feeding-sessions', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: {
    occurredAt: directAt,
    clientRequestId: crypto.randomUUID(),
    components: [{ kind: 'direct_breastfeeding', durationMinutes: 18 }],
  },
});

await request('/api/care/diapers', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: {
    occurredAt: diaperAt,
    clientRequestId: crypto.randomUUID(),
    kind: 'urine_stool',
    stoolColor: 'yellow',
    stoolConsistency: 'seedy',
    stoolAmount: 'medium',
  },
});

await request('/api/care/sleep/start', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: {
    occurredAt: sleepAt,
    clientRequestId: crypto.randomUUID(),
  },
});

const firstSummary = await request(`/api/care/summary?at=${encodeURIComponent(careAsOf.toISOString())}`, {
  cookie: dadCookie,
});
if (
  firstSummary.payload?.rolling24h?.bottleTotalMl !== 60
  || firstSummary.payload?.rolling24h?.formulaMl !== 60
  || firstSummary.payload?.rolling24h?.directBreastfeedingSessions !== 1
  || firstSummary.payload?.rolling24h?.directBreastfeedingMinutes !== 18
) {
  throw new Error('SMOKE_FAILED initial M2 summary mismatch');
}
if (firstSummary.payload?.rolling24h?.bottleTotalMl === 150) {
  throw new Error('SMOKE_FAILED bottle capacity leaked into intake total');
}
console.log('SMOKE_OK component=m2-care-summary-initial');

await request(`/api/care/events/${formulaEventId}`, {
  method: 'PATCH',
  cookie: dadCookie,
  body: {
    eventType: 'feeding',
    occurredAt: formulaAt,
    components: [{
      kind: 'bottle',
      liquidType: 'formula',
      amountMl: 65,
      bottleCapacityMl: 150,
    }],
  },
});

const editedSummary = await request(`/api/care/summary?at=${encodeURIComponent(careAsOf.toISOString())}`, {
  cookie: dadCookie,
});
if (editedSummary.payload?.rolling24h?.bottleTotalMl !== 65) {
  throw new Error('SMOKE_FAILED edited bottle total mismatch');
}
console.log('SMOKE_OK component=m2-care-edit');

await request(`/api/care/events/${formulaEventId}/undo`, {
  method: 'POST',
  cookie: dadCookie,
});

const undoneSummary = await request(`/api/care/summary?at=${encodeURIComponent(careAsOf.toISOString())}`, {
  cookie: dadCookie,
});
if (
  undoneSummary.payload?.rolling24h?.bottleTotalMl !== 0
  || undoneSummary.payload?.rolling24h?.directBreastfeedingSessions !== 1
  || undoneSummary.payload?.rolling24h?.directBreastfeedingMinutes !== 18
) {
  throw new Error('SMOKE_FAILED undo summary mismatch');
}
console.log('SMOKE_OK component=m2-care-undo');

const nannyCare = await request('/api/care/actions', {
  method: 'POST',
  expectedStatus: 201,
  cookie: nannyCookie,
  body: {
    occurredAt: isoMinutesAgo(careAsOf, 1),
    clientRequestId: crypto.randomUUID(),
    action: { kind: 'bathing' },
  },
});
const nannyEventId = nannyCare.payload?.id;
if (typeof nannyEventId !== 'string') throw new Error('SMOKE_FAILED Nanny care event id missing');

const timeline = await request(`/api/care/timeline?before=${encodeURIComponent(careAsOf.toISOString())}&limit=20`, {
  cookie: dadCookie,
});
const nannyTimelineItem = Array.isArray(timeline.payload?.items)
  ? timeline.payload.items.find((item) => item.id === nannyEventId)
  : undefined;
if (
  nannyTimelineItem?.actorDisplayName !== 'Nanny'
  || nannyTimelineItem?.source !== 'manual'
  || nannyTimelineItem?.eventType !== 'bathing'
) {
  throw new Error('SMOKE_FAILED Nanny care attribution mismatch');
}
console.log('SMOKE_OK component=m2-nanny-attribution');
console.log('SMOKE_OK component=m2-care-release-flow');
