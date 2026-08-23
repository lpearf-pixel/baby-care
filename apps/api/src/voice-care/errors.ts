export class VoiceCareForbiddenError extends Error {
  constructor() {
    super('This Voice Care operation is not allowed.');
    this.name = 'VoiceCareForbiddenError';
  }
}

export class VoiceCarePairingInvalidError extends Error {
  constructor() {
    super('The Voice Care pairing request is invalid.');
    this.name = 'VoiceCarePairingInvalidError';
  }
}

export class VoiceCareNotFoundError extends Error {
  constructor() {
    super('The Voice Care device was not found.');
    this.name = 'VoiceCareNotFoundError';
  }
}

export class VoiceCareStateConflictError extends Error {
  constructor() {
    super('The Voice Care state has changed.');
    this.name = 'VoiceCareStateConflictError';
  }
}
