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
  // Defence in depth: a client should normalise decimals before sending, but
  // if a bare "72,5" arrives, accept a single comma as the decimal separator
  // rather than silently turning it into the fallback. We do NOT try to guess
  // thousands separators here; locale handling lives in the client.
  if (typeof value === 'string' && value.includes(',') && !value.includes('.')) {
    if ((value.match(/,/g) || []).length === 1) {
      value = value.replace(',', '.');
    }
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function toPositiveInt(value, fallback = null) {
  const num = toNumber(value, fallback);
  if (num === null) return fallback;
  return Math.max(0, Math.round(num));
}

export function toNonNegativeNumber(value, fallback = null) {
  const num = toNumber(value, fallback);
  if (num === null) return fallback;
  return Math.max(0, num);
}

export function requireString(value, field, { max = 200 } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `El campo "${field}" es obligatorio`);
  }
  return value.trim().slice(0, max);
}
