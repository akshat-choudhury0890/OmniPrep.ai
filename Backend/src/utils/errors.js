/** An error whose message is safe to show to API clients. */
export class AppError extends Error {
  constructor(status, code, message, { details, cause, headers } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
