import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Cookies');

const ENC_PREFIX = 'enc:';

type DecryptFn = (ciphertext: string) => string;

let _decryptor: DecryptFn | null = null;

/**
 * Register a server-side decryption function for encrypted cookie values.
 * Called once at server startup from the init-decryptor module.
 */
export function setDecryptor(fn: DecryptFn): void {
  _decryptor = fn;
}

/**
 * Attempt to decrypt a cookie value. Values prefixed with "enc:" are treated
 * as encrypted; all others pass through unchanged (plaintext migration).
 *
 * On decryption failure (key rotation, corruption), falls back to returning
 * the raw ciphertext without the prefix — never throws.
 */
function decryptCookieValue(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) {
    return value;
  }

  const ciphertext = value.slice(ENC_PREFIX.length);

  if (!_decryptor) {
    logger.warn('Encrypted cookie value found but no decryptor registered, returning raw ciphertext');
    return ciphertext;
  }

  try {
    return _decryptor(ciphertext);
  } catch (error) {
    logger.warn('Failed to decrypt cookie value, falling back to raw ciphertext:', error);
    return ciphertext;
  }
}

export function parseCookies(cookieHeader: string | null) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) {
    return cookies;
  }

  // Split the cookie string by semicolons and spaces
  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest.length > 0) {
      try {
        // Decode the name and value, and join value parts in case it contains '='
        const decodedName = decodeURIComponent(name.trim());
        const decodedValue = decodeURIComponent(rest.join('=').trim());
        cookies[decodedName] = decodedValue;
      } catch {
        // Malformed percent-encoding — use raw values
        cookies[name.trim()] = rest.join('=').trim();
      }
    }
  });

  return cookies;
}

export function getApiKeysFromCookie(cookieHeader: string | null): Record<string, string> {
  const cookies = parseCookies(cookieHeader);

  if (!cookies.apiKeys) {
    return {};
  }

  try {
    const keys = JSON.parse(cookies.apiKeys) as Record<string, string>;

    for (const [provider, value] of Object.entries(keys)) {
      if (typeof value === 'string' && value.startsWith(ENC_PREFIX)) {
        keys[provider] = decryptCookieValue(value);
      }
    }

    return keys;
  } catch {
    return {};
  }
}

export function getProviderSettingsFromCookie(cookieHeader: string | null): Record<string, Record<string, unknown>> {
  const cookies = parseCookies(cookieHeader);

  if (!cookies.providers) {
    return {};
  }

  try {
    return JSON.parse(cookies.providers);
  } catch {
    return {};
  }
}
