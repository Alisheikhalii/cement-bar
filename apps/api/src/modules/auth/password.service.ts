import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AUTH } from '../../config/app-config';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: AUTH.argon2.memoryCost,
  timeCost: AUTH.argon2.timeCost,
  parallelism: AUTH.argon2.parallelism,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Burn comparable CPU time when the user does not exist (prevents user enumeration by timing). */
  async dummyVerify(plain: string): Promise<void> {
    this.dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
    await this.verify(await this.dummyHash, plain);
  }
}
