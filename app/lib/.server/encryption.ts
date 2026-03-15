import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Encryption');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Resolve the 32-byte encryption key from the DEVONZ_ENCRYPTION_KEY env var.
 * Accepts hex-encoded (64 chars), base64-encoded (44 chars), or raw 32-byte values.
 */
function resolveEncryptionKey(): Buffer {
  const raw = process.env.DEVONZ_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      'DEVONZ_ENCRYPTION_KEY environment variable is not set. ' +
        "Generate a 32-byte key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  let key: Buffer;

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=?$/.test(raw)) {
    key = Buffer.from(raw, 'base64');
  } else {
    key = Buffer.from(raw, 'utf-8');
  }

  if (key.length !== 32) {
    throw new Error(
      `DEVONZ_ENCRYPTION_KEY must be exactly 32 bytes (256 bits). ` +
        `Received ${key.length} bytes. Provide a 64-character hex string, a 44-character base64 string, or a 32-byte raw value.`,
    );
  }

  return key;
}

const encryptionKey = resolveEncryptionKey();

logger.info('Encryption module initialized');

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing: IV (12 bytes) + auth tag (16 bytes) + ciphertext.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([iv, authTag, encrypted]);

  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded ciphertext string that was produced by encrypt().
 * Expects format: base64(IV[12] + authTag[16] + ciphertext).
 */
export function decrypt(ciphertext: string): string {
  let combined: Buffer;

  try {
    combined = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new Error('Invalid ciphertext: not valid base64 encoding');
  }

  const minLength = IV_LENGTH + AUTH_TAG_LENGTH;

  if (combined.length < minLength) {
    throw new Error(`Invalid ciphertext: too short (${combined.length} bytes, minimum ${minLength} bytes required)`);
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encryptedData = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    throw new Error('Decryption failed: invalid ciphertext or tampered data');
  }
}
