const MAX_ATTEMPTS_PER_MINUTE = 30;
const ATTEMPT_WINDOW_MS = 60_000;

export class VoiceCareBusyError extends Error {
  constructor() {
    super('voice_care_busy');
    this.name = 'VoiceCareBusyError';
  }
}

export class VoiceCareIntentCoordinator {
  private readonly active = new Set<string>();
  private readonly attempts = new Map<string, number[]>();

  async run<T>(deviceId: string, acceptedAt: Date, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (signal.aborted || this.active.has(deviceId)) throw new VoiceCareBusyError();
    const floor = acceptedAt.getTime() - ATTEMPT_WINDOW_MS;
    const recent = (this.attempts.get(deviceId) ?? []).filter((value) => value > floor);
    if (recent.length >= MAX_ATTEMPTS_PER_MINUTE) throw new VoiceCareBusyError();
    recent.push(acceptedAt.getTime());
    this.attempts.set(deviceId, recent);
    this.active.add(deviceId);
    try {
      return await work();
    } finally {
      this.active.delete(deviceId);
    }
  }
}
