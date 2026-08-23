export class ExportInProgressError extends Error {
  readonly code = 'export_in_progress' as const;

  constructor() {
    super('An export is already in progress for this actor.');
    this.name = 'ExportInProgressError';
  }
}

export interface ExportCoordinator {
  run<T>(actorUserId: string, operation: () => Promise<T>): Promise<T>;
}

export class StableExportCoordinator implements ExportCoordinator {
  private readonly runningActors = new Set<string>();

  async run<T>(actorUserId: string, operation: () => Promise<T>): Promise<T> {
    if (this.runningActors.has(actorUserId)) throw new ExportInProgressError();
    this.runningActors.add(actorUserId);
    try {
      return await operation();
    } finally {
      this.runningActors.delete(actorUserId);
    }
  }
}
