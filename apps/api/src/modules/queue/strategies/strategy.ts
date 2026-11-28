/**
 * Queue strategy contract (SPEC §3.1). The orchestrator owns this file; the three strategies
 * (`FreeFirstComeStrategy`, `TimedPriorityStrategy`, `BulkGroupRotationStrategy`) implement it.
 *
 * All decisions are made inside the reservation transaction with the SERVER clock. `canReserve`
 * must be side-effect free; `advance` is idempotent and safe to call from ticks, lazy reads and
 * the reservation path.
 */
import type { HallDay, LoadUnit } from '@prisma/client';
import type { ErrorCode, StrategyCode } from '@cb/shared';
import type { PrismaTx } from '../../../common/prisma/prisma.service';

export interface ReserveAnnouncement {
  id: string;
  carrierId: string;
  hallId: string;
  loaderTypeId: string;
  loaderType2Id: string | null;
}

export interface ReserveDriver {
  driverId: string;
  /** Carrier the driver belongs to (bulk loads only come from this carrier, D3). */
  carrierId: string;
  loaderTypeId: string;
}

export interface ReserveContext {
  tenantId: string;
  driver: ReserveDriver;
  unit: LoadUnit & { announcement: ReserveAnnouncement };
  /** The hall day the unit belongs to (null for a unit without one). */
  hallDay: HallDay | null;
  now: Date;
  tx: PrismaTx;
}

export type Decision = { ok: true } | { ok: false; code: ErrorCode; details?: unknown };

export interface AdvanceContext {
  tenantId: string;
  hallDayId: string;
  now: Date;
  /** Bulk rotation is per carrier; omit to advance every carrier of the hall. */
  carrierId?: string;
}

export interface QueueStrategy {
  readonly code: StrategyCode;
  canReserve(ctx: ReserveContext): Promise<Decision>;
  onReserved(tx: PrismaTx, ctx: ReserveContext, reservationId: string): Promise<void>;
  advance(tx: PrismaTx, ctx: AdvanceContext): Promise<void>;
  onCancelled(tx: PrismaTx, reservationId: string): Promise<void>;
}
