import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { ERRORS, loginSchema } from '@cb/shared';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';
import { mapError } from './error-mapping';

describe('mapError', () => {
  it('maps DomainError to its status, code and Persian message', () => {
    const m = mapError(new DomainError('ACCOUNT_LOCKED'));
    expect(m.status).toBe(423);
    expect(m.body).toEqual({ error: { code: 'ACCOUNT_LOCKED', message: ERRORS.ACCOUNT_LOCKED.fa } });
    expect(m.unexpected).toBe(false);
  });

  it('keeps details on DomainError', () => {
    const m = mapError(new DomainError('CONFLICT', { field: 'mobile' }));
    expect(m.status).toBe(409);
    expect(m.body.error.details).toEqual({ field: 'mobile' });
  });

  it('maps ZodError to VALIDATION_FAILED with issue paths', () => {
    const r = loginSchema.safeParse({ identifier: 'x', password: '' });
    expect(r.success).toBe(false);
    const m = mapError(r.error);
    expect(m.status).toBe(400);
    expect(m.body.error.code).toBe('VALIDATION_FAILED');
    const details = m.body.error.details as { issues: { path: string }[] };
    expect(details.issues.map((i) => i.path)).toContain('identifier');
  });

  it('maps Prisma unique violation to CONFLICT with field', () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
      meta: { target: ['mobile'] },
    });
    const m = mapError(err);
    expect(m.status).toBe(409);
    expect(m.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'mobile' } });
  });

  it('maps HttpExceptions by status', () => {
    expect(mapError(new NotFoundException()).body.error.code).toBe('NOT_FOUND');
    expect(mapError(new ForbiddenException()).body.error.code).toBe('FORBIDDEN');
    expect(mapError(new ThrottlerException()).body.error.code).toBe('RATE_LIMITED');
    expect(mapError(new ThrottlerException()).status).toBe(429);
  });

  it('hides unknown errors as INTERNAL without leaking the message', () => {
    const m = mapError(new Error('db password is hunter2'));
    expect(m.status).toBe(500);
    expect(m.unexpected).toBe(true);
    expect(JSON.stringify(m.body)).not.toContain('hunter2');
    expect(m.body.error.code).toBe('INTERNAL');
  });

  it('maps body-parser errors to VALIDATION_FAILED', () => {
    const m = mapError(Object.assign(new Error('bad json'), { type: 'entity.parse.failed', status: 400 }));
    expect(m.status).toBe(400);
    expect(m.body.error.code).toBe('VALIDATION_FAILED');
  });
});
