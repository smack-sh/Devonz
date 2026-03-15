/// <reference types="vitest/globals" />
import { parseCookies, getApiKeysFromCookie, getProviderSettingsFromCookie, setDecryptor } from './cookies';

/*
 * ---------------------------------------------------------------------------
 * parseCookies
 * ---------------------------------------------------------------------------
 */
describe('parseCookies', () => {
  it('parses a single cookie', () => {
    expect(parseCookies('session=abc123')).toEqual({ session: 'abc123' });
  });

  it('parses multiple cookies', () => {
    const result = parseCookies('session=abc123; theme=dark; lang=en');
    expect(result).toEqual({ session: 'abc123', theme: 'dark', lang: 'en' });
  });

  it('returns empty object for null input', () => {
    expect(parseCookies(null)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseCookies('')).toEqual({});
  });

  it('handles URL-encoded names and values', () => {
    const result = parseCookies('my%20cookie=hello%20world');
    expect(result).toEqual({ 'my cookie': 'hello world' });
  });

  it('handles values containing equals signs', () => {
    const result = parseCookies('data=base64==value');
    expect(result).toEqual({ data: 'base64==value' });
  });

  it('handles malformed percent-encoding by falling back to raw values', () => {
    // %ZZ is not valid percent-encoding
    const result = parseCookies('bad%ZZname=bad%ZZvalue');
    expect(result).toEqual({ 'bad%ZZname': 'bad%ZZvalue' });
  });

  it('skips entries with no value (name-only)', () => {
    const result = parseCookies('novalue; valid=yes');

    // 'novalue' has no '=' so rest.length == 0, it gets skipped
    expect(result).toEqual({ valid: 'yes' });
  });
});

/*
 * ---------------------------------------------------------------------------
 * getApiKeysFromCookie
 * ---------------------------------------------------------------------------
 */
describe('getApiKeysFromCookie', () => {
  it('parses API keys from a valid JSON cookie', () => {
    const keys = { openai: 'sk-abc123', anthropic: 'sk-ant-xyz' };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);
    expect(result).toEqual(keys);
  });

  it('returns empty object when apiKeys cookie is missing', () => {
    expect(getApiKeysFromCookie('other=value')).toEqual({});
  });

  it('returns empty object for null cookie header', () => {
    expect(getApiKeysFromCookie(null)).toEqual({});
  });

  it('returns empty object when apiKeys contains malformed JSON', () => {
    const cookie = `apiKeys=${encodeURIComponent('{not valid json')}`;
    expect(getApiKeysFromCookie(cookie)).toEqual({});
  });

  it('handles multiple provider keys', () => {
    const keys = {
      openai: 'sk-openai-key',
      anthropic: 'sk-ant-key',
      groq: 'gsk-groq-key',
      google: 'AIza-google-key',
    };
    const cookie = `session=xyz; apiKeys=${encodeURIComponent(JSON.stringify(keys))}; theme=dark`;
    const result = getApiKeysFromCookie(cookie);
    expect(result).toEqual(keys);
  });

  it('returns empty object when apiKeys is an empty JSON object', () => {
    const cookie = `apiKeys=${encodeURIComponent('{}')}`;
    expect(getApiKeysFromCookie(cookie)).toEqual({});
  });
});

/*
 * ---------------------------------------------------------------------------
 * getProviderSettingsFromCookie
 * ---------------------------------------------------------------------------
 */
describe('getProviderSettingsFromCookie', () => {
  it('parses provider settings from a valid JSON cookie', () => {
    const settings = {
      openai: { baseUrl: 'https://api.openai.com', enabled: true },
      anthropic: { baseUrl: 'https://api.anthropic.com', enabled: false },
    };
    const cookie = `providers=${encodeURIComponent(JSON.stringify(settings))}`;
    const result = getProviderSettingsFromCookie(cookie);
    expect(result).toEqual(settings);
  });

  it('returns empty object when providers cookie is missing', () => {
    expect(getProviderSettingsFromCookie('apiKeys=something')).toEqual({});
  });

  it('returns empty object for null cookie header', () => {
    expect(getProviderSettingsFromCookie(null)).toEqual({});
  });

  it('returns empty object when providers contains malformed JSON', () => {
    const cookie = `providers=${encodeURIComponent('not-json')}`;
    expect(getProviderSettingsFromCookie(cookie)).toEqual({});
  });
});

/*
 * ---------------------------------------------------------------------------
 * Encrypted cookie value handling
 * ---------------------------------------------------------------------------
 */
describe('encrypted cookie value handling', () => {
  const fakeEncrypt = (plaintext: string): string => {
    // Simple reversible encoding for testing — NOT real encryption
    return Buffer.from(plaintext).toString('base64');
  };

  const fakeDecrypt = (ciphertext: string): string => {
    return Buffer.from(ciphertext, 'base64').toString('utf-8');
  };

  afterEach(() => {
    // Reset decryptor to null after each test so tests are isolated
    setDecryptor(null as unknown as (s: string) => string);
  });

  it('reads plaintext cookie values without modification', () => {
    setDecryptor(fakeDecrypt);

    const keys = { openai: 'sk-plaintext-key', anthropic: 'sk-ant-xyz' };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);
    expect(result).toEqual(keys);
  });

  it('auto-detects and decrypts "enc:" prefixed values', () => {
    setDecryptor(fakeDecrypt);

    const encryptedValue = `enc:${fakeEncrypt('sk-real-secret-key')}`;
    const keys = { openai: encryptedValue, anthropic: 'sk-plaintext' };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);

    expect(result.openai).toBe('sk-real-secret-key');
    expect(result.anthropic).toBe('sk-plaintext');
  });

  it('handles encrypt-then-read round trip', () => {
    setDecryptor(fakeDecrypt);

    const original = 'sk-secret-api-key-12345';
    const stored = `enc:${fakeEncrypt(original)}`;

    const keys = { myProvider: stored };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);

    expect(result.myProvider).toBe(original);
  });

  it('falls back to raw ciphertext when decryption fails (malformed)', () => {
    const failingDecryptor = (_ciphertext: string): string => {
      throw new Error('Decryption failed: invalid ciphertext');
    };
    setDecryptor(failingDecryptor);

    const malformed = 'enc:not-valid-ciphertext';
    const keys = { openai: malformed };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);

    // Should return the raw ciphertext without the "enc:" prefix
    expect(result.openai).toBe('not-valid-ciphertext');
  });

  it('returns raw ciphertext when no decryptor is registered', () => {
    // Ensure no decryptor is set
    setDecryptor(null as unknown as (s: string) => string);

    const keys = { openai: 'enc:some-encrypted-data' };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);

    expect(result.openai).toBe('some-encrypted-data');
  });

  it('handles mixed plaintext and encrypted keys', () => {
    setDecryptor(fakeDecrypt);

    const keys = {
      openai: `enc:${fakeEncrypt('sk-openai-secret')}`,
      anthropic: 'sk-ant-plaintext',
      groq: `enc:${fakeEncrypt('gsk-groq-secret')}`,
    };
    const cookie = `apiKeys=${encodeURIComponent(JSON.stringify(keys))}`;
    const result = getApiKeysFromCookie(cookie);

    expect(result.openai).toBe('sk-openai-secret');
    expect(result.anthropic).toBe('sk-ant-plaintext');
    expect(result.groq).toBe('gsk-groq-secret');
  });
});
