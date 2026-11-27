import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCrypto } from './field-crypto';

const key = randomBytes(32).toString('base64');
const fc = new FieldCrypto(key, 'test-hash-key-0123456789');

describe('FieldCrypto', () => {
  it('roundtrips Unicode and digits', () => {
    for (const v of ['0012345679', 'IR820540102680020817909002', 'متن فارسی']) {
      expect(fc.decrypt(fc.encrypt(v))).toBe(v);
    }
  });

  it('uses a random IV (same input → different ciphertext)', () => {
    expect(fc.encrypt('0012345679')).not.toBe(fc.encrypt('0012345679'));
  });

  it('detects tampering (GCM auth tag)', () => {
    const enc = fc.encrypt('0012345679');
    const parts = enc.split(':');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString('base64');
    expect(() => fc.decrypt(parts.join(':'))).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const other = new FieldCrypto(randomBytes(32).toString('base64'), 'test-hash-key-0123456789');
    expect(() => other.decrypt(fc.encrypt('x'))).toThrow();
  });

  it('hash is deterministic and keyed', () => {
    expect(fc.hash('0012345679')).toBe(fc.hash('0012345679'));
    expect(fc.hash('0012345679')).toMatch(/^[0-9a-f]{64}$/);
    const other = new FieldCrypto(key, 'another-hash-key-0123456789');
    expect(other.hash('0012345679')).not.toBe(fc.hash('0012345679'));
  });

  it('rejects malformed keys and payloads', () => {
    expect(() => new FieldCrypto(randomBytes(16).toString('base64'), 'test-hash-key-0123456789')).toThrow();
    expect(() => fc.decrypt('v0:a:b:c')).toThrow();
  });
});
