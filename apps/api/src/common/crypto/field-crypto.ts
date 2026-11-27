import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * Field-level encryption for PII (national id, sheba): AES-256-GCM with random IV,
 * plus a deterministic HMAC-SHA256 for unique/lookup columns. Keys come from env only.
 */
export class FieldCrypto {
  private readonly encKey: Buffer;
  private readonly hashKey: Buffer;

  constructor(encryptionKeyBase64: string, hashKey: string) {
    const key = Buffer.from(encryptionKeyBase64, 'base64');
    if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64)');
    if (hashKey.length < 16) throw new Error('FIELD_HASH_KEY too short');
    this.encKey = key;
    this.hashKey = Buffer.from(hashKey, 'utf8');
  }

  /** Returns "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, ctB64] = payload.split(':');
    if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) {
      throw new Error('Unsupported ciphertext format');
    }
    const decipher = createDecipheriv(ALGO, this.encKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Deterministic keyed hash (hex) for equality lookups / unique constraints. */
  hash(value: string): string {
    return createHmac('sha256', this.hashKey).update(value, 'utf8').digest('hex');
  }
}
