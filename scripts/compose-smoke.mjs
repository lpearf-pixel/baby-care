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
const dadHandoffAt = isoMinutesAgo(careAsOf, 60);
const formulaAt = isoMinutesAgo(careAsOf, 30);
const directAt = isoMinutesAgo(careAsOf, 25);
const sleepAt = isoMinutesAgo(careAsOf, 20);
const diaperAt = isoMinutesAgo(careAsOf, 10);

const dadTakeover = await request('/api/care/handoffs', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: {
    occurredAt: dadHandoffAt,
    clientRequestId: crypto.randomUUID(),
  },
});
if (
  dadTakeover.payload?.checkpoint?.actorDisplayName !== 'Dad'
  || dadTakeover.payload?.previousCheckpoint !== null
  || dadTakeover.payload?.window?.mode !== 'rolling_24h'
  || dadTakeover.payload?.window?.to !== dadHandoffAt
  || dadTakeover.payload?.window?.from !== isoMinutesAgo(new Date(dadHandoffAt), 24 * 60)
  || Date.parse(dadTakeover.payload.window.to) - Date.parse(dadTakeover.payload.window.from) !== 24 * 60 * 60_000
) {
  throw new Error('SMOKE_FAILED first Dad handoff fallback mismatch');
}

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
    expectedVersion: 1,
    event: {
      eventType: 'feeding',
      occurredAt: formulaAt,
      components: [{
        kind: 'bottle',
        liquidType: 'formula',
        amountMl: 65,
        bottleCapacityMl: 150,
      }],
    },
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
  body: { expectedVersion: 2 },
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

const m3FormulaAt = isoMinutesAgo(careAsOf, 15);
const m3FormulaFeed = await request('/api/care/feeding-sessions', {
  method: 'POST',
  expectedStatus: 201,
  cookie: dadCookie,
  body: {
    occurredAt: m3FormulaAt,
    clientRequestId: crypto.randomUUID(),
    components: [{
      kind: 'bottle',
      liquidType: 'formula',
      amountMl: 60,
      bottleCapacityMl: 150,
    }],
  },
});
const m3FormulaEventId = m3FormulaFeed.payload?.id;
if (typeof m3FormulaEventId !== 'string') throw new Error('SMOKE_FAILED M3 formula event id missing');

const m3NannyDiaper = await request('/api/care/diapers', {
  method: 'POST',
  expectedStatus: 201,
  cookie: nannyCookie,
  body: {
    occurredAt: isoMinutesAgo(careAsOf, 8),
    clientRequestId: crypto.randomUUID(),
    confirmedWarnings: ['possible_duplicate'],
    kind: 'urine_stool',
    stoolColor: 'yellow',
    stoolConsistency: 'seedy',
    stoolAmount: 'medium',
  },
});
const m3NannyDiaperId = m3NannyDiaper.payload?.id;
if (typeof m3NannyDiaperId !== 'string') throw new Error('SMOKE_FAILED M3 Nanny diaper event id missing');

const m3Medication = await request('/api/care/actions', {
  method: 'POST',
  expectedStatus: 201,
  cookie: nannyCookie,
  body: {
    occurredAt: isoMinutesAgo(careAsOf, 7),
    clientRequestId: crypto.randomUUID(),
    action: {
      kind: 'medication',
      medicationName: 'Recorded medicine',
      dose: 1.25,
      doseUnit: 'mL',
    },
  },
});
const m3MedicationId = m3Medication.payload?.id;
if (typeof m3MedicationId !== 'string') throw new Error('SMOKE_FAILED M3 medication event id missing');

const nannyTakeover = await request('/api/care/handoffs', {
  method: 'POST',
  expectedStatus: 201,
  cookie: nannyCookie,
  body: {
    occurredAt: careAsOf.toISOString(),
    clientRequestId: crypto.randomUUID(),
  },
});
const nannyCheckpointId = nannyTakeover.payload?.checkpoint?.id;
if (
  typeof nannyCheckpointId !== 'string'
  || nannyTakeover.payload?.checkpoint?.actorDisplayName !== 'Nanny'
  || nannyTakeover.payload?.previousCheckpoint?.id !== dadTakeover.payload?.checkpoint?.id
  || nannyTakeover.payload?.window?.mode !== 'checkpoint'
  || nannyTakeover.payload?.window?.from !== dadHandoffAt
  || nannyTakeover.payload?.window?.to !== careAsOf.toISOString()
  || nannyTakeover.payload?.feeding?.bottleTotalMl !== 60
  || nannyTakeover.payload?.feeding?.formulaMl !== 60
  || nannyTakeover.payload?.feeding?.bottleTotalMl === 150
) {
  throw new Error('SMOKE_FAILED M3 checkpoint handoff summary mismatch');
}
const handoffNotableEvents = Array.isArray(nannyTakeover.payload?.notableEvents)
  ? nannyTakeover.payload.notableEvents
  : [];
const handoffFormula = handoffNotableEvents.find((item) => item.id === m3FormulaEventId);
const handoffDiaper = handoffNotableEvents.find((item) => item.id === m3NannyDiaperId);
const handoffMedication = handoffNotableEvents.find((item) => item.id === m3MedicationId);
const handoffActors = Array.isArray(nannyTakeover.payload?.actorActivity)
  ? nannyTakeover.payload.actorActivity
  : [];
if (
  handoffFormula?.actorDisplayName !== 'Dad'
  || handoffFormula?.payload?.components?.[0]?.amountMl !== 60
  || handoffFormula?.payload?.components?.[0]?.bottleCapacityMl !== 150
  || handoffDiaper?.actorDisplayName !== 'Nanny'
  || handoffDiaper?.eventType !== 'diaper'
  || handoffMedication?.actorDisplayName !== 'Nanny'
  || handoffMedication?.eventType !== 'medication'
  || handoffMedication?.payload?.action?.medicationName !== 'Recorded medicine'
  || handoffMedication?.payload?.action?.dose !== 1.25
  || handoffMedication?.payload?.action?.doseUnit !== 'mL'
  || !handoffActors.some((actor) => actor.actorDisplayName === 'Dad' && actor.eventCount > 0)
  || !handoffActors.some((actor) => actor.actorDisplayName === 'Nanny' && actor.eventCount > 0)
) {
  throw new Error('SMOKE_FAILED M3 handoff typed facts or actor attribution mismatch');
}
console.log('SMOKE_OK component=m3-handoff');

const firstTimelinePage = await request('/api/care/timeline?limit=1', { cookie: dadCookie });
if (
  !Array.isArray(firstTimelinePage.payload?.items)
  || firstTimelinePage.payload.items.length !== 1
  || typeof firstTimelinePage.payload.nextCursor !== 'string'
) {
  throw new Error('SMOKE_FAILED M3 first typed timeline page mismatch');
}
const secondTimelinePage = await request(
  `/api/care/timeline?limit=1&cursor=${encodeURIComponent(firstTimelinePage.payload.nextCursor)}`,
  { cookie: dadCookie },
);
if (
  !Array.isArray(secondTimelinePage.payload?.items)
  || secondTimelinePage.payload.items.length !== 1
  || secondTimelinePage.payload.items[0]?.id === firstTimelinePage.payload.items[0]?.id
) {
  throw new Error('SMOKE_FAILED M3 cursor continuation mismatch');
}
const m3FormulaDetail = await request(`/api/care/events/${m3FormulaEventId}`, { cookie: nannyCookie });
if (
  m3FormulaDetail.payload?.eventType !== 'feeding'
  || m3FormulaDetail.payload?.actorDisplayName !== 'Dad'
  || m3FormulaDetail.payload?.source !== 'manual'
  || m3FormulaDetail.payload?.version !== 1
  || m3FormulaDetail.payload?.payload?.components?.[0]?.amountMl !== 60
  || m3FormulaDetail.payload?.payload?.components?.[0]?.bottleCapacityMl !== 150
) {
  throw new Error('SMOKE_FAILED M3 typed formula detail mismatch');
}
console.log('SMOKE_OK component=m3-typed-timeline');

const m3FormulaEdit = await request(`/api/care/events/${m3FormulaEventId}`, {
  method: 'PATCH',
  cookie: dadCookie,
  body: {
    expectedVersion: 1,
    event: {
      eventType: 'feeding',
      occurredAt: m3FormulaAt,
      components: [{
        kind: 'bottle',
        liquidType: 'formula',
        amountMl: 65,
        bottleCapacityMl: 150,
      }],
    },
  },
});
if (m3FormulaEdit.payload?.version !== 2 || m3FormulaEdit.payload?.status !== 'active') {
  throw new Error('SMOKE_FAILED M3 formula edit receipt mismatch');
}

const recomputedBriefing = await request(`/api/care/handoffs/${nannyCheckpointId}/summary`, {
  cookie: dadCookie,
});
if (
  recomputedBriefing.payload?.window?.from !== dadHandoffAt
  || recomputedBriefing.payload?.window?.to !== careAsOf.toISOString()
  || recomputedBriefing.payload?.feeding?.bottleTotalMl !== 65
  || recomputedBriefing.payload?.feeding?.formulaMl !== 65
  || recomputedBriefing.payload?.feeding?.bottleTotalMl === 150
) {
  throw new Error('SMOKE_FAILED M3 fixed briefing correction mismatch');
}

const staleUndo = await request(`/api/care/events/${m3FormulaEventId}/undo`, {
  method: 'POST',
  expectedStatus: 409,
  cookie: dadCookie,
  body: { expectedVersion: 1 },
});
if (staleUndo.payload?.code !== 'care_state_conflict') {
  throw new Error('SMOKE_FAILED M3 stale undo conflict mismatch');
}
const activeFormulaDetail = await request(`/api/care/events/${m3FormulaEventId}`, { cookie: nannyCookie });
if (activeFormulaDetail.payload?.version !== 2 || activeFormulaDetail.payload?.status !== 'active') {
  throw new Error('SMOKE_FAILED M3 stale undo changed active formula');
}
const m3FormulaHistory = await request(`/api/care/events/${m3FormulaEventId}/revisions`, {
  cookie: nannyCookie,
});
if (
  !Array.isArray(m3FormulaHistory.payload)
  || m3FormulaHistory.payload.length !== 1
  || m3FormulaHistory.payload[0]?.eventId !== m3FormulaEventId
  || m3FormulaHistory.payload[0]?.action !== 'edit'
  || m3FormulaHistory.payload[0]?.actorDisplayName !== 'Dad'
  || m3FormulaHistory.payload[0]?.fromVersion !== 1
  || m3FormulaHistory.payload[0]?.toVersion !== 2
  || m3FormulaHistory.payload[0]?.after?.components?.[0]?.amountMl !== 65
) {
  throw new Error('SMOKE_FAILED M3 revision history mismatch');
}
console.log('SMOKE_OK component=m3-revision-conflict');

const latestBeforeReminders = await request('/api/care/handoffs/latest', { cookie: dadCookie });
if (latestBeforeReminders.payload?.checkpoint?.id !== nannyCheckpointId) {
  throw new Error('SMOKE_FAILED M3 latest handoff before reminders mismatch');
}
const dadReminders = await request('/api/care/handoff-reminders', {
  method: 'PUT',
  cookie: dadCookie,
  body: { rules: [{ localTime: '16:00', weekdays: [1, 2, 3, 4, 5, 6, 7], enabled: true }] },
});
if (
  dadReminders.payload?.rules?.length !== 1
  || dadReminders.payload.rules[0]?.localTime !== '16:00'
  || dadReminders.payload.rules[0]?.enabled !== true
) {
  throw new Error('SMOKE_FAILED M3 reminder replacement mismatch');
}
const persistedDadReminders = await request('/api/care/handoff-reminders', { cookie: dadCookie });
if (
  persistedDadReminders.payload?.rules?.length !== 1
  || persistedDadReminders.payload.rules[0]?.localTime !== '16:00'
  || persistedDadReminders.payload.rules[0]?.weekdays?.join(',') !== '1,2,3,4,5,6,7'
  || persistedDadReminders.payload.rules[0]?.enabled !== true
) {
  throw new Error('SMOKE_FAILED M3 persisted reminder mismatch');
}
const latestAfterReminders = await request('/api/care/handoffs/latest', { cookie: dadCookie });
if (latestAfterReminders.payload?.checkpoint?.id !== nannyCheckpointId) {
  throw new Error('SMOKE_FAILED reminder configuration created a checkpoint fact');
}

console.log('SMOKE_OK component=m3-care-workspace-release-flow');
