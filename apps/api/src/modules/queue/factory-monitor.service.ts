/**
 * Factory monitoring & fairness reporting (US-F8/F9): hall status today, per-carrier bulk rotation
 * state, bag allocation-run summaries, and the bulk fairness report.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  localDate,
  type BulkFairnessRowDto,
  type FactoryAllocationRunDto,
  type FactoryMonitorDto,
  type FactoryMonitorHallDto,
  type FactoryMonitorWindowDto,
} from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, type PrismaTx } from '../../common/prisma/prisma.service';
import { destinationLabel } from './queue-mappers';
import { bulkWindowDto, syncHallDayStatus, type WindowLike } from './queue-support';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class FactoryMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  private get db(): PrismaTx {
    return this.prisma;
  }

  async monitor(user: AuthUser): Promise<FactoryMonitorDto> {
    const { tenantId } = scopedTenant(user);
    const now = this.clock.now();
    const today = localDate(now);
    const halls = await this.prisma.hall.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    const rawDays = await this.prisma.hallDay.findMany({ where: { tenantId, date: today } });
    const dayByHall = new Map<string, Awaited<ReturnType<typeof syncHallDayStatus>>>();
    for (const d of rawDays) dayByHall.set(d.hallId, await syncHallDayStatus(this.db, d, now));
    const dayIds = [...dayByHall.values()].map((d) => d.id);

    const bulkDays = dayIds.length
      ? await this.prisma.bulkDay.findMany({
          where: { tenantId, hallDayId: { in: dayIds } },
          include: { windows: { orderBy: { seq: 'asc' } } },
        })
      : [];
    const carrierIds = [...new Set(bulkDays.map((b) => b.carrierId))];
    const carriers = carrierIds.length
      ? await this.prisma.carrier.findMany({ where: { id: { in: carrierIds } }, select: { id: true, name: true } })
      : [];
    const carrierName = new Map(carriers.map((c) => [c.id, c.name]));

    const groupIds = new Set<string>();
    for (const b of bulkDays) {
      groupIds.add(b.headGroupId);
      for (const w of b.windows) groupIds.add(w.groupId);
      for (const g of parseSnapshotIds(b.membersSnapshot)) groupIds.add(g);
    }
    const rotations = bulkDays.length
      ? await this.prisma.bulkRotationState.findMany({ where: { tenantId, carrierId: { in: carrierIds } } })
      : [];
    for (const r of rotations) if (r.cursorGroupId) groupIds.add(r.cursorGroupId);
    const groups = groupIds.size ? await this.prisma.bulkGroup.findMany({ where: { id: { in: [...groupIds] } }, select: { id: true, title: true } }) : [];
    const title = new Map(groups.map((g) => [g.id, g.title]));

    const windowIds = bulkDays.flatMap((b) => b.windows.map((w) => w.id));
    const reservedCounts = await this.reservedCounts(windowIds);
    const runs = dayIds.length
      ? await this.prisma.allocationRun.findMany({ where: { tenantId, hallDayId: { in: dayIds } } })
      : [];
    const runByDay = new Map(runs.map((r) => [r.hallDayId, r]));

    const out: FactoryMonitorHallDto[] = halls.map((hall) => {
      const day = dayByHall.get(hall.id) ?? null;
      const hallBulkDays = day ? bulkDays.filter((b) => b.hallDayId === day.id) : [];
      const bulk = hallBulkDays.map((b) => {
        const rotation = rotations.find((r) => r.carrierId === b.carrierId && r.hallId === hall.id);
        const open = b.windows.find((w) => w.closedAt === null) ?? null;
        const activeWindow: FactoryMonitorWindowDto | null = open
          ? {
              ...bulkWindowDto(open as WindowLike, title.get(open.groupId) ?? '', reservedCounts.get(open.id) ?? 0),
              carrierId: b.carrierId,
              carrierName: carrierName.get(b.carrierId) ?? '',
            }
          : null;
        return {
          carrierId: b.carrierId,
          carrierName: carrierName.get(b.carrierId) ?? '',
          headGroupTitle: title.get(b.headGroupId) ?? null,
          cursorGroupTitle: rotation?.cursorGroupId ? (title.get(rotation.cursorGroupId) ?? null) : null,
          cursorRemaining: rotation?.cursorRemaining.length ?? 0,
          activeWindow,
        };
      });
      const run = day ? runByDay.get(day.id) : undefined;
      return {
        hallId: hall.id,
        title: hall.title,
        category: hall.category,
        dayId: day?.id ?? null,
        dayStatus: day?.status ?? null,
        t0At: day ? day.t0At.toISOString() : null,
        hallEndAt: day ? day.hallEndAt.toISOString() : null,
        haltedReason: day?.haltedReason ?? null,
        bulk,
        allocationRun: run ? runSummary(run) : null,
      };
    });
    return { serverTime: now.toISOString(), today, halls: out };
  }

  async allocationRun(user: AuthUser, id: string): Promise<FactoryAllocationRunDto> {
    const { tenantId } = scopedTenant(user);
    const run = await this.prisma.allocationRun.findFirst({ where: { id, tenantId } });
    if (!run) throw new DomainError('NOT_FOUND');
    return {
      id: run.id,
      hallDayId: run.hallDayId,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt.toISOString(),
      engineVersion: run.engineVersion,
      inputHash: run.inputHash,
      outputHash: run.outputHash,
      input: run.input,
      output: run.output,
    };
  }

  async bulkFairness(user: AuthUser, from?: string, to?: string): Promise<BulkFairnessRowDto[]> {
    const { tenantId } = scopedTenant(user);
    const today = localDate(this.clock.now());
    const start = from ?? today;
    const end = to ?? today;
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
      throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'from', message: 'from<=to (YYYY-MM-DD)' }] });
    }
    const bulkDays = await this.prisma.bulkDay.findMany({
      where: { tenantId, hallDay: { is: { date: { gte: start, lte: end } } } },
      include: {
        hallDay: { select: { date: true } },
        windows: {
          orderBy: { seq: 'asc' },
          include: {
            reservations: {
              where: { status: { not: 'CANCELLED' } },
              include: {
                driver: { include: { vehicles: { where: { active: true }, take: 1, select: { plate: true } } } },
                unit: { include: { announcement: true } },
              },
            },
          },
        },
      },
      orderBy: [{ hallDayId: 'asc' }, { createdAt: 'asc' }],
    });
    const carrierIds = [...new Set(bulkDays.map((b) => b.carrierId))];
    const carriers = carrierIds.length
      ? await this.prisma.carrier.findMany({ where: { id: { in: carrierIds } }, select: { id: true, name: true } })
      : [];
    const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
    const groupIds = [...new Set(bulkDays.flatMap((b) => b.windows.map((w) => w.groupId)))];
    const groups = groupIds.length ? await this.prisma.bulkGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, title: true } }) : [];
    const title = new Map(groups.map((g) => [g.id, g.title]));
    const rows: BulkFairnessRowDto[] = [];
    for (const b of bulkDays) {
      for (const w of b.windows) {
        for (const r of w.reservations) {
          const a = r.unit.announcement;
          rows.push({
            date: b.hallDay.date,
            carrierName: carrierName.get(b.carrierId) ?? '',
            groupTitle: title.get(w.groupId) ?? '',
            windowSeq: w.seq,
            round: w.round,
            kind: w.kind,
            driverName: `${r.driver.firstName} ${r.driver.lastName}`,
            plate: r.driver.vehicles[0]?.plate ?? null,
            announcementNumber: a.number,
            destinationTitle: await destinationLabel(this.db, a),
            reservedAt: r.reservedAt.toISOString(),
          });
        }
      }
    }
    return rows;
  }

  private async reservedCounts(windowIds: string[]): Promise<Map<string, number>> {
    if (windowIds.length === 0) return new Map();
    const rows = await this.prisma.reservation.groupBy({
      by: ['bulkWindowId'],
      where: { bulkWindowId: { in: windowIds }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.bulkWindowId!, r._count._all]));
  }
}

function runSummary(run: { id: string; startedAt: Date; finishedAt: Date; engineVersion: string; inputHash: string; outputHash: string; output: Prisma.JsonValue }) {
  const out = run.output && typeof run.output === 'object' ? (run.output as Record<string, unknown>) : {};
  const assignments = Array.isArray(out.assignments) ? out.assignments.length : 0;
  const notAllocated = Array.isArray(out.notAllocated) ? out.notAllocated.length : 0;
  return {
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    engineVersion: run.engineVersion,
    assignmentCount: assignments,
    notAllocatedCount: notAllocated,
    inputHash: run.inputHash,
    outputHash: run.outputHash,
  };
}

function parseSnapshotIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const g of value) {
    if (g && typeof g === 'object' && typeof (g as { id?: unknown }).id === 'string') ids.push((g as { id: string }).id);
  }
  return ids;
}
