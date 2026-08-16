import type { CareWarning } from '@baby-care/contracts';

export class CareEventNotFoundError extends Error {
  constructor(message = 'Care event was not found.') {
    super(message);
    this.name = 'CareEventNotFoundError';
  }
}

export class CareStateConflictError extends Error {
  constructor(message = 'Care event state conflicts with this operation.') {
    super(message);
    this.name = 'CareStateConflictError';
  }
}

export class CareForbiddenError extends Error {
  constructor(message = 'This care operation is not allowed.') {
    super(message);
    this.name = 'CareForbiddenError';
  }
}

export class CareValidationError extends Error {
  constructor(message = 'Care input failed validation.') {
    super(message);
    this.name = 'CareValidationError';
  }
}

export class CareConfirmationRequiredError extends Error {
  readonly warnings: readonly CareWarning[];

  constructor(warnings: readonly CareWarning[]) {
    super('Care warnings require explicit confirmation.');
    this.name = 'CareConfirmationRequiredError';
    this.warnings = warnings;
  }
}
