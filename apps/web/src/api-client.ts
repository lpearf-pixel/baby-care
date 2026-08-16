import type {
  BabyDto,
  BottleLiquidType,
  CareActionReceipt,
  CareHomeSummaryDto,
  CareRevisionReceipt,
  CreateCareActionInput,
  CreateDiaperInput,
  CreateFeedingSessionInput,
  CreateMeasurementInput,
  CreateNannyInput,
  DiaperEventDto,
  FamilyDto,
  FeedingQuickValuesDto,
  FeedingSessionDto,
  MeasurementReceipt,
  MemberDto,
  SessionDto,
  SetupInput,
  SleepIntervalDto,
  StartSleepInput,
  UndoCareEventRequest,
  UndoCareEventResponse,
  UpdateCareEventRequest,
  UpdateBabyInput,
  UpdateFamilyInput,
  WakeSleepInput,
} from '@baby-care/contracts';

export class BabyCareApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'BabyCareApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let error: { code?: string; message?: string; details?: unknown } = {};
    try {
      error = (await response.json()) as typeof error;
    } catch {
      // Keep a stable generic client error if the server response is not JSON.
    }
    throw new BabyCareApiError(
      error.code ?? 'request_failed',
      error.message ?? '请求失败，请稍后再试',
      error.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface BabyCareApi {
  getSetupStatus(): Promise<{ required: boolean }>;
  setupFamily(input: SetupInput, setupToken: string): Promise<{ status: 'created' }>;
  login(loginName: string, password: string): Promise<SessionDto>;
  logout(): Promise<void>;
  getSession(): Promise<SessionDto>;
  getFamily(): Promise<FamilyDto>;
  updateFamily(input: UpdateFamilyInput): Promise<FamilyDto>;
  getBaby(): Promise<BabyDto>;
  updateBaby(input: UpdateBabyInput): Promise<BabyDto>;
  listMembers(): Promise<MemberDto[]>;
  createNanny(input: CreateNannyInput): Promise<MemberDto>;
  setNannyStatus(membershipId: string, status: 'active' | 'disabled'): Promise<MemberDto>;
  resetNannyPassword(membershipId: string, newPassword: string): Promise<void>;
  getCareSummary(at: string): Promise<CareHomeSummaryDto>;
  getFeedingQuickValues(liquidType: BottleLiquidType): Promise<FeedingQuickValuesDto>;
  createFeedingSession(input: CreateFeedingSessionInput): Promise<FeedingSessionDto>;
  createDiaper(input: CreateDiaperInput): Promise<DiaperEventDto>;
  startSleep(input: StartSleepInput): Promise<SleepIntervalDto>;
  wakeSleep(input: WakeSleepInput): Promise<SleepIntervalDto>;
  createCareAction(input: CreateCareActionInput): Promise<CareActionReceipt>;
  createMeasurement(input: CreateMeasurementInput): Promise<MeasurementReceipt>;
  editCareEvent(eventId: string, input: UpdateCareEventRequest): Promise<CareRevisionReceipt>;
  undoCareEvent(eventId: string, input: UndoCareEventRequest): Promise<UndoCareEventResponse>;
}

export const babyCareApi: BabyCareApi = {
  getSetupStatus: () => request('/api/setup/status'),
  setupFamily: (input, setupToken) =>
    request('/api/setup', {
      method: 'POST',
      headers: { 'x-baby-care-setup-token': setupToken },
      body: JSON.stringify(input),
    }),
  login: (loginName, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ loginName, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getSession: () => request('/api/auth/session'),
  getFamily: () => request('/api/family'),
  updateFamily: (input) => request('/api/family', { method: 'PATCH', body: JSON.stringify(input) }),
  getBaby: () => request('/api/baby'),
  updateBaby: (input) => request('/api/baby', { method: 'PATCH', body: JSON.stringify(input) }),
  listMembers: () => request('/api/family/members'),
  createNanny: (input) =>
    request('/api/family/members', { method: 'POST', body: JSON.stringify(input) }),
  setNannyStatus: (membershipId, status) =>
    request(`/api/family/members/${membershipId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  resetNannyPassword: (membershipId, newPassword) =>
    request(`/api/family/members/${membershipId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
  getCareSummary: (at) => request(`/api/care/summary?at=${encodeURIComponent(at)}`),
  getFeedingQuickValues: (liquidType) =>
    request(`/api/care/feeding/quick-values?liquidType=${encodeURIComponent(liquidType)}`),
  createFeedingSession: (input) =>
    request('/api/care/feeding-sessions', { method: 'POST', body: JSON.stringify(input) }),
  createDiaper: (input) =>
    request('/api/care/diapers', { method: 'POST', body: JSON.stringify(input) }),
  startSleep: (input) =>
    request('/api/care/sleep/start', { method: 'POST', body: JSON.stringify(input) }),
  wakeSleep: (input) =>
    request('/api/care/sleep/wake', { method: 'POST', body: JSON.stringify(input) }),
  createCareAction: (input) =>
    request('/api/care/actions', { method: 'POST', body: JSON.stringify(input) }),
  createMeasurement: (input) =>
    request('/api/care/measurements', { method: 'POST', body: JSON.stringify(input) }),
  editCareEvent: (eventId, input) =>
    request(`/api/care/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(input) }),
  undoCareEvent: (eventId, input) =>
    request(`/api/care/events/${eventId}/undo`, { method: 'POST', body: JSON.stringify(input) }),
};
