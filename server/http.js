export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function toPositiveInt(value, fallback = null) {
  const num = toNumber(value, fallback);
  if (num === null) return fallback;
  return Math.max(0, Math.round(num));
}

export function requireString(value, field, { max = 200 } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `El campo "${field}" es obligatorio`);
  }
  return value.trim().slice(0, max);
}
