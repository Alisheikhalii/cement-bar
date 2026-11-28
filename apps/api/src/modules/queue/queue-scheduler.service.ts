/**
 * Idempotent queue scheduler (SPEC §3.3/§3.4 "worker every 5s"). Interval ticks are skipped under
 * NODE_ENV=test; `runOnce()` is exposed for tests and manual ticks. Safe with multiple instances
 * thanks to the advisory locks + unique constraints used by the engine.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { QueueSseEvent } from '@cb/shared';
import { ClockService } from '../../common/clock/clock.service';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { QueueEngineService } from './queue-engine.service';

const TICK_MS = 5_000;

@Injectable()
export class QueueSchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly engine: QueueEngineService,
    private readonly publisher: RealtimePublisher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => {
      this.runOnce().catch(() => undefined);
    }, TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One tick: lazily open/close hall days, run due bag allocations and advance bulk rotations. */
  async runOnce(tenantId?: string): Promise<void> {
    const now = this.clock.now();
    const days = await this.prisma.hallDay.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        OR: [
          { status: { in: ['SCHEDULED', 'OPEN', 'ALLOCATING'] }, t0At: { lte: now } },
          { status: { in: ['OPEN', 'ALLOCATING'] }, hallEndAt: { lte: now } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    for (const { id } of days) {
      const events: QueueSseEvent[] = [];
      await this.prisma.$transaction(
        async (tx) => {
          const day = await tx.hallDay.findUnique({ where: { id } });
          if (!day) return;
          const synced = await this.engine.syncHallDay(tx, day, now);
          if (synced.status === 'SCHEDULED') return; // T0 not reached
          const hall = await tx.hall.findUnique({ where: { id: synced.hallId } });
          if (!hall) return;
          const live = synced.status === 'OPEN' || synced.status === 'ALLOCATING';
          if (hall.category === 'BAG') {
            // Lazy/true fallback: allocate whenever the priority window has ended, even after hallEnd.
            if (synced.priorityEndAt && now >= synced.priorityEndAt) {
              events.push(...(await this.engine.allocateBagTx(tx, synced, now)));
            }
            return;
          }
          if (!live) return;
          // BULK: advance every carrier that has a bulk day today or open GROUP units in this hall.
          const carriers = new Set<string>();
          for (const b of await tx.bulkDay.findMany({ where: { hallDayId: synced.id }, select: { carrierId: true } })) {
            carriers.add(b.carrierId);
          }
          const withUnits = await tx.announcement.findMany({
            where: {
              tenantId: synced.tenantId,
              hallId: synced.hallId,
              status: 'ACTIVE',
              deletedAt: null,
              units: { some: { allocation: 'GROUP', state: 'OPEN' } },
            },
            select: { carrierId: true },
            distinct: ['carrierId'],
          });
          for (const a of withUnits) carriers.add(a.carrierId);
          for (const carrierId of carriers) {
            events.push(...(await this.engine.advanceBulkTx(tx, carrierId, synced, now)));
          }
        },
        { timeout: TX_TIMEOUT_MS },
      );
      await this.publisher.publishAll(events);
    }
  }
}
