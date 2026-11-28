import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuotaService } from '../src/common/quota/quota.service';
import { DomainError } from '../src/common/errors/domain-error';
import { createTestApp, type TestApp } from './helpers/app';
import { createFixture, type Fixture } from './helpers/fixtures';

/** BR-08 / AC-11 / D12: usage = Σ weightToKg × non-cancelled units, Jalali month of announceDate. */
describe('QuotaService (D12)', () => {
  let t: TestApp;
  let fx: Fixture;
  let quota: QuotaService;
  let number = 0;

  async function announce(o: { date: string; trucks: number; weightToKg: number; status?: 'ACTIVE' | 'CANCELLED' | 'DRAFT'; cancelUnits?: number }) {
    number += 1;
    const a = await t.prisma.announcement.create({
      data: {
        tenantId: fx.tenantId,
        carrierId: fx.carrierId,
        hallId: randomUUID(),
        number,
        status: o.status ?? 'ACTIVE',
        announceDate: o.date,
        announceTime: '08:00',
        productId: randomUUID(),
        packagingTypeId: randomUUID(),
        cargoValue: 1n,
        loadingLocationId: randomUUID(),
        fareCalc: 'PER_TRUCK',
        loaderTypeId: fx.loaderTypeId,
        truckCount: o.trucks,
        weightFromKg: 1000,
        weightToKg: o.weightToKg,
        destFareType: 'x',
        description: 'quota test',
      },
    });
    await t.prisma.loadUnit.createMany({
      data: Array.from({ length: o.trucks }, (_, i) => ({
        tenantId: fx.tenantId,
        announcementId: a.id,
        seq: i + 1,
        allocation: 'FREE' as const,
        state: i < (o.cancelUnits ?? 0) ? ('CANCELLED' as const) : ('OPEN' as const),
      })),
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
    fx = await createFixture(t);
    quota = t.app.get(QuotaService);
    await t.prisma.carrierQuota.create({
      data: { tenantId: fx.tenantId, carrierId: fx.carrierId, yearMonth: '1405-09', tonnageLimitKg: 100_000n },
    });
    // 1405-09 = 2026-11-22 … 2026-12-21
    await announce({ date: '2026-11-22', trucks: 2, weightToKg: 10_000 }); // 20,000
    await announce({ date: '2026-12-21', trucks: 3, weightToKg: 10_000, cancelUnits: 1 }); // 20,000 (1 unit cancelled)
    await announce({ date: '2026-12-01', trucks: 5, weightToKg: 10_000, status: 'CANCELLED' }); // ignored
    await announce({ date: '2026-12-01', trucks: 5, weightToKg: 10_000, status: 'DRAFT' }); // ignored
    await announce({ date: '2026-11-21', trucks: 5, weightToKg: 10_000 }); // previous month — ignored
  });

  afterAll(async () => {
    await fx.dispose();
    await t.close();
  });

  it('computes usage with the D12 formula on month boundaries', async () => {
    const u = await quota.usage(fx.tenantId, fx.carrierId, '1405-09');
    expect(u).toMatchObject({ limitKg: 100_000n, usedKg: 40_000n });
    const prev = await quota.usage(fx.tenantId, fx.carrierId, '1405-08');
    expect(prev).toMatchObject({ limitKg: null, usedKg: 50_000n });
  });

  it('QUOTA_NOT_SET when the month has no quota row', async () => {
    await expect(
      t.prisma.$transaction((tx) => quota.assertCanConsume(tx, fx.tenantId, fx.carrierId, '1405-10', 1n)),
    ).rejects.toMatchObject({ code: 'QUOTA_NOT_SET' });
  });

  it('QUOTA_EXCEEDED beyond the limit; exact fit is allowed', async () => {
    await expect(
      t.prisma.$transaction((tx) => quota.assertCanConsume(tx, fx.tenantId, fx.carrierId, '1405-09', 60_001n)),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      t.prisma.$transaction((tx) => quota.assertCanConsume(tx, fx.tenantId, fx.carrierId, '1405-09', 60_000n)),
    ).resolves.toMatchObject({ usedKg: 40_000n });
  });

  it('serialises concurrent writers: two 40t announcements against 60t remaining → exactly one wins', async () => {
    const attempt = () =>
      t.prisma.$transaction(async (tx) => {
        await quota.assertCanConsume(tx, fx.tenantId, fx.carrierId, '1405-09', 40_000n);
        await new Promise((r) => setTimeout(r, 150)); // widen the race window
        number += 1;
        const a = await tx.announcement.create({
          data: {
            tenantId: fx.tenantId, carrierId: fx.carrierId, hallId: randomUUID(), number, announceDate: '2026-12-10',
            announceTime: '09:00', productId: randomUUID(), packagingTypeId: randomUUID(), cargoValue: 1n,
            loadingLocationId: randomUUID(), fareCalc: 'PER_TRUCK', loaderTypeId: fx.loaderTypeId, truckCount: 4,
            weightFromKg: 1000, weightToKg: 10_000, destFareType: 'x', description: 'race',
          },
        });
        await tx.loadUnit.createMany({
          data: [1, 2, 3, 4].map((seq) => ({ tenantId: fx.tenantId, announcementId: a.id, seq, allocation: 'FREE' as const })),
        });
      });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect((await quota.usage(fx.tenantId, fx.carrierId, '1405-09')).usedKg).toBe(80_000n);
  });
});
