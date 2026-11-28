import { Injectable } from '@nestjs/common';
import type { Hall, HallDay, HallSchedule, Prisma } from '@prisma/client';
import {
  addDaysIso,
  localDate,
  type HallCreateInput,
  type HallDayCreateInput,
  type HallDayDto,
  type HallDayGenerateResultDto,
  type HallDto,
  type HallScheduleDto,
  type HallScheduleItem,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS, type PrismaTx } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { dayTimes, isAllocationCompatible, planHallDays } from './hall-days';

/** Default window of GET /:id/days when no range is given (days before / after today). */
const DAYS_BACK = 7;
const DAYS_AHEAD = 31;
const MAX_RANGE_DAYS = 92;
/** Hall-day statuses that may still be halted. */
const HALTABLE = ['SCHEDULED', 'OPEN', 'ALLOCATING'] as const;

type HallWithSchedules = Hall & { schedules: HallSchedule[] };

function toScheduleDto(s: HallSchedule): HallScheduleDto {
  return {
    weekday: s.weekday,
    t0: s.t0,
    priorityEnd: s.priorityEnd,
    hallEnd: s.hallEnd,
    headMinutes: s.headMinutes,
    freeMinutes: s.freeMinutes,
    active: s.active,
  };
}

export function toHallDto(h: HallWithSchedules): HallDto {
  return {
    id: h.id,
    title: h.title,
    category: h.category,
    defaultAllocation: h.defaultAllocation,
    terminalName: h.terminalName,
    terminalCity: h.terminalCity,
    active: h.active,
    createdAt: h.createdAt.toISOString(),
    schedules: [...h.schedules].sort((a, b) => a.weekday - b.weekday).map(toScheduleDto),
  };
}

export function toHallDayDto(d: HallDay): HallDayDto {
  return {
    id: d.id,
    hallId: d.hallId,
    date: d.date,
    t0At: d.t0At.toISOString(),
    priorityEndAt: d.priorityEndAt ? d.priorityEndAt.toISOString() : null,
    hallEndAt: d.hallEndAt.toISOString(),
    status: d.status,
    haltedReason: d.haltedReason,
  };
}

/**
 * ASSUMPTION(Q-D-6): a TIMED (bag) hall needs a priority-selection end time on every active schedule row
 * and on every one-off day, because the bag allocation job runs at priority_end_at (SPEC §3.3).
 */
function assertPriorityEnd(hall: Hall, priorityEnd: string | null | undefined, active = true): void {
  if (hall.defaultAllocation === 'TIMED' && active && !priorityEnd) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'priorityEnd', message: 'required for TIMED halls' }] });
  }
}

@Injectable()
export class HallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  async findOwned(user: AuthUser, id: string, db: PrismaTx = this.prisma): Promise<HallWithSchedules> {
    const h = await db.hall.findFirst({ where: { id, ...scopedTenant(user) }, include: { schedules: true } });
    if (!h) throw new DomainError('NOT_FOUND');
    return h;
  }

  async list(user: AuthUser): Promise<HallDto[]> {
    const halls = await this.prisma.hall.findMany({
      where: scopedTenant(user),
      include: { schedules: true },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });
    return halls.map(toHallDto);
  }

  async detail(user: AuthUser, id: string): Promise<HallDto> {
    return toHallDto(await this.findOwned(user, id));
  }

  async create(user: AuthUser, input: HallCreateInput): Promise<HallDto> {
    if (!isAllocationCompatible(input.category, input.defaultAllocation)) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'defaultAllocation', message: 'incompatible with category' }] });
    }
    const hall = await this.prisma.$transaction(
      async (tx) => {
        const h = await tx.hall.create({
          data: {
            ...scopedTenant(user),
            title: input.title,
            category: input.category,
            defaultAllocation: input.defaultAllocation,
            terminalName: input.terminalName ?? null,
            terminalCity: input.terminalCity ?? null,
            active: input.active,
            createdBy: user.id,
          },
          include: { schedules: true },
        });
        await this.audit.log({ action: 'hall.created', entity: 'Hall', entityId: h.id, after: toHallDto(h) }, tx);
        return h;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toHallDto(hall);
  }

  /** ASSUMPTION(Q-D-4): the category of a hall that already has announcements cannot change. */
  async update(user: AuthUser, id: string, patch: Partial<HallCreateInput>): Promise<HallDto> {
    const hall = await this.prisma.$transaction(
      async (tx) => {
        const b = await this.findOwned(user, id, tx);
        const category = patch.category ?? b.category;
        const allocation = patch.defaultAllocation ?? b.defaultAllocation;
        if (!isAllocationCompatible(category, allocation)) {
          throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'defaultAllocation', message: 'incompatible with category' }] });
        }
        if (category !== b.category && (await tx.announcement.count({ where: { hallId: b.id } })) > 0) {
          throw new DomainError('INVALID_STATE', { field: 'category' });
        }
        const a = await tx.hall.update({ where: { id: b.id }, data: patch, include: { schedules: true } });
        await this.audit.log({ action: 'hall.updated', entity: 'Hall', entityId: a.id, before: toHallDto(b), after: toHallDto(a) }, tx);
        return a;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toHallDto(hall);
  }

  /** PUT /:id/schedules — replaces the whole week atomically. Existing hall_days are not changed. */
  async replaceSchedules(user: AuthUser, id: string, items: HallScheduleItem[]): Promise<HallDto> {
    const hall = await this.prisma.$transaction(
      async (tx) => {
        const h = await this.findOwned(user, id, tx);
        for (const i of items) assertPriorityEnd(h, i.priorityEnd, i.active);
        await tx.hallSchedule.deleteMany({ where: { hallId: h.id } });
        if (items.length) {
          await tx.hallSchedule.createMany({
            data: items.map((i) => ({
              tenantId: h.tenantId,
              hallId: h.id,
              weekday: i.weekday,
              t0: i.t0,
              priorityEnd: i.priorityEnd ?? null,
              hallEnd: i.hallEnd,
              headMinutes: i.headMinutes ?? null,
              freeMinutes: i.freeMinutes ?? null,
              active: i.active,
              createdBy: user.id,
            })),
          });
        }
        const after = await this.findOwned(user, id, tx);
        await this.audit.log(
          {
            action: 'hall.schedules_replaced',
            entity: 'Hall',
            entityId: h.id,
            before: h.schedules.map(toScheduleDto),
            after: after.schedules.map(toScheduleDto),
          },
          tx,
        );
        return after;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toHallDto(hall);
  }

  // ───────── hall days ─────────
  async listDays(user: AuthUser, hallId: string, range: { from?: string; to?: string }): Promise<HallDayDto[]> {
    const h = await this.findOwned(user, hallId);
    const today = localDate(this.clock.now());
    const from = range.from ?? addDaysIso(today, -DAYS_BACK);
    const to = range.to ?? addDaysIso(from, DAYS_BACK + DAYS_AHEAD);
    if (from > to || addDaysIso(from, MAX_RANGE_DAYS) < to) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'to', message: `range must be 0..${MAX_RANGE_DAYS} days` }] });
    }
    const days = await this.prisma.hallDay.findMany({
      where: { hallId: h.id, tenantId: h.tenantId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    return days.map(toHallDayDto);
  }

  /** One-off / exception day. Its T0 must be in the future (server clock). Duplicate date → 409. */
  async createDay(user: AuthUser, hallId: string, input: HallDayCreateInput): Promise<HallDayDto> {
    const day = await this.prisma.$transaction(
      async (tx) => {
        const h = await this.findOwned(user, hallId, tx);
        assertPriorityEnd(h, input.priorityEnd);
        const times = dayTimes(input.date, input);
        if (times.t0At <= this.clock.now()) throw new DomainError('INVALID_STATE', { field: 't0' });
        const d = await tx.hallDay.create({
          data: { tenantId: h.tenantId, hallId: h.id, date: input.date, ...times, createdBy: user.id },
        });
        await this.audit.log({ action: 'hall_day.created', entity: 'HallDay', entityId: d.id, after: toHallDayDto(d) }, tx);
        return d;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toHallDayDto(day);
  }

  /** Re-times a day that has not started yet (SCHEDULED and T0 in the future); the new T0 must be in the future too. */
  async updateDay(
    user: AuthUser,
    hallId: string,
    dayId: string,
    input: { t0: string; priorityEnd?: string; hallEnd: string; reason: string },
  ): Promise<HallDayDto> {
    const now = this.clock.now();
    const day = await this.prisma.$transaction(
      async (tx) => {
        const h = await this.findOwned(user, hallId, tx);
        const b = await this.findDay(tx, h, dayId);
        if (b.status !== 'SCHEDULED' || b.t0At <= now) throw new DomainError('INVALID_STATE', { status: b.status });
        assertPriorityEnd(h, input.priorityEnd);
        const times = dayTimes(b.date, input);
        if (times.t0At <= now) throw new DomainError('INVALID_STATE', { field: 't0' });
        const upd = await tx.hallDay.updateMany({ where: { id: b.id, status: 'SCHEDULED', t0At: b.t0At }, data: times });
        if (upd.count !== 1) throw new DomainError('INVALID_STATE');
        const a = await this.findDay(tx, h, dayId);
        await this.audit.log(
          { action: 'hall_day.updated', entity: 'HallDay', entityId: a.id, before: toHallDayDto(b), after: toHallDayDto(a), reason: input.reason },
          tx,
        );
        return a;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toHallDayDto(day);
  }

  /** Materialises days from the weekly schedule; existing days are kept (re-running is a no-op). */
  async generateDays(user: AuthUser, hallId: string, from: string, days: number): Promise<HallDayGenerateResultDto> {
    return this.prisma.$transaction(
      async (tx) => {
        const h = await this.findOwned(user, hallId, tx);
        const to = addDaysIso(from, days - 1);
        const existing = await tx.hallDay.findMany({ where: { hallId: h.id, date: { gte: from, lte: to } }, select: { date: true } });
        const plan = planHallDays(h.schedules, from, days, new Set(existing.map((e) => e.date)), this.clock.now());
        if (plan.create.length) {
          // skipDuplicates + unique(hallId, date): a concurrent run cannot create a second row for a date.
          await tx.hallDay.createMany({
            data: plan.create.map((d) => ({ tenantId: h.tenantId, hallId: h.id, createdBy: user.id, ...d })),
            skipDuplicates: true,
          });
        }
        const created = plan.create.map((d) => d.date);
        await this.audit.log(
          { action: 'hall_day.generated', entity: 'Hall', entityId: h.id, after: { from, days, created, skipped: plan.skipped.length } },
          tx,
        );
        return { created, skipped: plan.skipped };
      },
      { timeout: TX_TIMEOUT_MS },
    );
  }

  /**
   * Emergency halt (HALL_HALTED). Allowed from SCHEDULED/OPEN/ALLOCATING. The status change is a
   * conditional update, so concurrent halts cannot both succeed. Resuming is not part of v1.
   */
  async haltDay(user: AuthUser, hallId: string, dayId: string, reason: string): Promise<HallDayDto> {
    const day = await this.prisma.$transaction(
      async (tx) => {
        const h = await this.findOwned(user, hallId, tx);
        const b = await this.findDay(tx, h, dayId);
        const upd = await tx.hallDay.updateMany({
          where: { id: b.id, status: { in: [...HALTABLE] } },
          data: { status: 'HALTED', haltedReason: reason },
        });
        if (upd.count !== 1) throw new DomainError('INVALID_STATE', { status: b.status });
        const a = await this.findDay(tx, h, dayId);
        await tx.queueEvent.create({
          data: {
            tenantId: h.tenantId,
            hallDayId: a.id,
            type: 'HALL_HALTED',
            payload: { hallId: h.id, date: a.date, from: b.status, reason } satisfies Prisma.InputJsonObject,
            actorId: user.id,
          },
        });
        await this.audit.log(
          { action: 'hall_day.halted', entity: 'HallDay', entityId: a.id, before: { status: b.status }, after: { status: a.status }, reason },
          tx,
        );
        return a;
      },
      { timeout: TX_TIMEOUT_MS },
    );
    return toHallDayDto(day);
  }

  private async findDay(tx: PrismaTx, h: Hall, dayId: string): Promise<HallDay> {
    const d = await tx.hallDay.findFirst({ where: { id: dayId, hallId: h.id, tenantId: h.tenantId } });
    if (!d) throw new DomainError('NOT_FOUND');
    return d;
  }
}
