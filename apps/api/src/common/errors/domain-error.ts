import { ERRORS, type ErrorCode } from '@cb/shared';

/** Business/auth error with a stable code; rendered by AllExceptionsFilter. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'DomainError';
  }

  get status(): number {
    return ERRORS[this.code].status;
  }
}
