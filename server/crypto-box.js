import crypto from 'node:crypto';
import config from './config.js';

/**
 * Authenticated symmetric encryption for secrets stored at rest (the Hevy
 * API key). Uses AES-256-GCM with a key derived from SESSION_SECRET.
 *
 * Output format (base64): v1.<iv>.<authTag>.<ciphertext>
 *
 * Note: rotating SESSION_SECRET invalidates previously stored secrets; they
 * can simply be re-entered by the user.
 */

const KEY = crypto.createHash('sha256').update(config.sessionSecret).digest();
const PREFIX = 'v1';

export function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload) {
  if (typeof payload !== 'string') return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

/** Mask a key for display, e.g. "abcd…wxyz". */
export function maskSecret(plaintext) {
  const s = String(plaintext || '');
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
