import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { CareActorContext, CareAuth } from '../src/care/care-auth.js';
import { registerVoiceCareBrowserRoutes } from '../src/routes/voice-care-browser.js';
import type { VoiceCareDeviceService } from '../src/voice-care/device-service.js';
import type { VoiceCareLeaseService } from '../src/voice-care/lease-service.js';
import {
  VoiceCareNotFoundError,
  VoiceCarePairingInvalidError,
  VoiceCareStateConflictError,
} from '../src/voice-care/errors.js';

const actor: CareActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  membershipId: '22222222-2222-4222-8222-222222222222',
  familyId: '33333333-3333-4333-8333-333333333333',
  babyId: '44444444-4444-4444-8444-444444444444',
  relationship: 'dad',
  permissionLevel: 'family_admin',
};

function fixture(overrides: Partial<VoiceCareDeviceService> = {}) {
  const careAuth = {
    requireRead: vi.fn(async () => actor),
    requireWrite: vi.fn(async () => actor),
  } as unknown as CareAuth;
  const deviceService = {
    createChallenge: vi.fn(async () => ({
      challengeId: '55555555-5555-4555-8555-555555555555',
      challenge: 'A'.repeat(43),
      expiresAt: '2026-08-23T08:05:00.000Z',
    })),
    pair: vi.fn(),
    list: vi.fn(async () => []),
    revoke: vi.fn(),
    ...overrides,
  } as VoiceCareDeviceService;
  const app = Fastify({ logger: false });
  const leaseService = {
    activate: vi.fn(),
    revoke: vi.fn(),
  } as VoiceCareLeaseService;
  registerVoiceCareBrowserRoutes(app, { careAuth, deviceService, leaseService });
  return { app, careAuth, deviceService };
}

describe('M5 Voice Care browser route', () => {
  it('does not expose an unexpected service or database error', async () => {
    const privateMarker = 'postgres://private-key@household/voice-row';
    const { app } = fixture({ createChallenge: vi.fn(async () => { throw new Error(privateMarker); }) });
    const response = await app.inject({ method: 'POST', url: '/api/voice-care/pairing-challenges' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'voice_care_state_conflict',
      message: 'Voice Care is temporarily unavailable.',
      traceId: expect.any(String),
    });
    expect(response.body).not.toContain(privateMarker);
    await app.close();
  });

  it('also closes list failures without returning database details', async () => {
    const privateMarker = 'select public_key from private_household_device';
    const { app } = fixture({ list: vi.fn(async () => { throw new Error(privateMarker); }) });
    const response = await app.inject({ method: 'GET', url: '/api/voice-care/devices' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'voice_care_state_conflict' });
    expect(response.body).not.toContain(privateMarker);
    await app.close();
  });

  it.each([
    [new VoiceCarePairingInvalidError(), 409, 'voice_care_pairing_invalid'],
    [new VoiceCareStateConflictError(), 409, 'voice_care_state_conflict'],
    [new VoiceCareNotFoundError(), 404, 'voice_care_not_found'],
  ] as const)('maps %s to one closed browser error', async (error, status, code) => {
    const { app } = fixture({ revoke: vi.fn(async () => { throw error; }) });
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/voice-care/devices/66666666-6666-4666-8666-666666666666',
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code, traceId: expect.any(String) });
    await app.close();
  });

  it('rejects malformed device ids before service work and serves a bounded device list', async () => {
    const { app, deviceService } = fixture();
    const invalid = await app.inject({ method: 'DELETE', url: '/api/voice-care/devices/not-a-uuid' });
    expect(invalid.statusCode).toBe(400);
    expect(deviceService.revoke).not.toHaveBeenCalled();
    const list = await app.inject({ method: 'GET', url: '/api/voice-care/devices' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
    expect(deviceService.list).toHaveBeenCalledWith(actor);
    await app.close();
  });
});
