import { describe, expect, it } from 'vitest';
import { isCsrfValid, type CsrfInput } from './csrf';

const base: CsrfInput = {
  method: 'POST',
  skipToken: false,
  origin: undefined,
  headerToken: 'tok-123',
  cookieToken: 'tok-123',
  webOrigin: 'http://localhost:3000',
};

describe('isCsrfValid', () => {
  it('always allows safe methods', () => {
    expect(isCsrfValid({ ...base, method: 'GET', headerToken: undefined, origin: 'https://evil.example' })).toBe(true);
    expect(isCsrfValid({ ...base, method: 'HEAD', headerToken: undefined })).toBe(true);
  });

  it('accepts matching header and cookie', () => {
    expect(isCsrfValid(base)).toBe(true);
    expect(isCsrfValid({ ...base, origin: 'http://localhost:3000' })).toBe(true);
  });

  it('rejects missing header or cookie', () => {
    expect(isCsrfValid({ ...base, headerToken: undefined })).toBe(false);
    expect(isCsrfValid({ ...base, cookieToken: undefined })).toBe(false);
  });

  it('rejects mismatched tokens (including different length)', () => {
    expect(isCsrfValid({ ...base, headerToken: 'tok-124' })).toBe(false);
    expect(isCsrfValid({ ...base, headerToken: 'tok' })).toBe(false);
  });

  it('rejects a foreign Origin even on token-exempt routes', () => {
    expect(isCsrfValid({ ...base, origin: 'https://evil.example' })).toBe(false);
    expect(isCsrfValid({ ...base, skipToken: true, headerToken: undefined, origin: 'https://evil.example' })).toBe(
      false,
    );
  });

  it('allows token-exempt routes without a token', () => {
    expect(isCsrfValid({ ...base, skipToken: true, headerToken: undefined, cookieToken: undefined })).toBe(true);
  });
});
