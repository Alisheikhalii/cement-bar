/**
 * Queue engine contracts (Phase 3): request schemas + response DTOs shared by API and web.
 * Keep types JSON-shaped (bigint → string, Date → ISO string).
 *
 * Ownership: written by the orchestrator before the P3 fan-out; the three agents implement
 * against it and do not change its shapes without a note in DECISIONS.md.
 */
import { z } from 'zod';
import type {
  Allocation,
  BagTurnStatus,
  BulkWindowCloseReason,
  BulkWindowKind,
  CancelRequestStatus,
  HallCategory,
  HallDayStatus,
  ReservationSource,
  ReservationStatus,
  UnitState,
} from '../enums';

// ───────── request schemas ─────────
export const setBagPrioritiesSchema = z
  .object({ announcementIds: z.array(z.string().uuid()).max(3) })
  .strict();
export type SetBagPrioritiesInput = z.infer<typeof setBagPrioritiesSchema>;

export const createReservationSchema = z
  .object({
    announcementId: z.string().uuid().optional(),
    unitId: z.string().uuid().optional(),
    /** Client-generated key (uuid or 8-64 url-safe chars); a retry with the same key returns the same permit. */
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/, 'کلید تکرار نامعتبر است'),
  })
  .strict()
  .refine((v) => Boolean(v.announcementId) !== Boolean(v.unitId), 'یکی از بار یا واحد بار را انتخاب کنید');
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const cancelRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

export const carrierDecisionSchema = z
  .object({ note: z.string().trim().max(500).optional() })
  .strict();
export type CarrierDecisionInput = z.infer<typeof carrierDecisionSchema>;

export const bulkHaltSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const bulkCloseWindowSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const bulkGroupCreateSchema = z.object({ title: z.string().trim().min(1).max(80) }).strict();
export type BulkGroupCreateInput = z.infer<typeof bulkGroupCreateSchema>;

export const bulkGroupUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    active: z.boolean().optional(),
    /** Operator reason is mandatory when the change takes effect today (BR-F1/BR-F13). */
    reason: z.string().trim().max(500).optional(),
    applyNow: z.boolean().optional(),
  })
  .strict();
export type BulkGroupUpdateInput = z.infer<typeof bulkGroupUpdateSchema>;

export const bulkGroupReorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) }).strict();
export type BulkGroupReorderInput = z.infer<typeof bulkGroupReorderSchema>;

export const bulkGroupMembersSchema = z
  .object({
    driverIds: z.array(z.string().uuid()),
    reason: z.string().trim().max(500).optional(),
    applyNow: z.boolean().optional(),
  })
  .strict();
export type BulkGroupMembersInput = z.infer<typeof bulkGroupMembersSchema>;

export const bulkSettingsSchema = z
  .object({
    maxLoadsPerDriverPerDay: z.number().int().min(1).max(10).optional(),
    leftoverAtHallEnd: z.enum(['CARRY', 'FREE']).optional(),
  })
  .strict();
export type BulkSettingsInput = z.infer<typeof bulkSettingsSchema>;

export const bulkStartHeadSchema = z
  .object({
    headGroupId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type BulkStartHeadInput = z.infer<typeof bulkStartHeadSchema>;

export const manualPermitSchema = z
  .object({
    announcementId: z.string().uuid(),
    driverId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type ManualPermitInput = z.infer<typeof manualPermitSchema>;

// ───────── shared shapes ─────────
export interface QueueHallDayDto {
  id: string;
  /** Local ISO date in Asia/Tehran. */
  date: string;
  status: HallDayStatus;
  t0At: string;
  priorityEndAt: string | null;
  hallEndAt: string;
  haltedReason: string | null;
}

export interface QueueHallDto {
  hallId: string;
  title: string;
  category: HallCategory;
  day: QueueHallDayDto | null;
  /** Wall-clock now of the server (same value as the X-Server-Time header). */
  serverTime: string;
}

export interface DriverQueueHallsDto {
  serverTime: string;
  halls: QueueHallDto[];
}

// ───────── bag hall ─────────
export interface BagTurnDto {
  id: string;
  turnNo: number;
  status: BagTurnStatus;
  registeredAt: string;
}

export interface BagPriorityDto {
  rank: number;
  announcementId: string;
  announcementNumber: number;
  title: string;
  carrierName: string;
  destinationTitle: string | null;
}

export interface BagAssignmentDto {
  reservationId: string;
  permitNo: number;
  unitId: string;
  announcementId: string;
  announcementNumber: number;
  title: string;
  carrierName: string;
  destinationTitle: string | null;
  reservedAt: string;
}

/** Why the register/priority buttons are disabled (server-evaluated hint; the API re-checks). */
export type BagBlockReason =
  | 'BEFORE_T0'
  | 'AFTER_PRIORITY_END'
  | 'TURN_EXISTS'
  | 'NO_TURN'
  | 'HALL_HALTED'
  | 'NO_DAY'
  | 'DRIVER_NOT_APPROVED'
  | 'DRIVER_BLOCKED'
  | 'DRIVER_PENALIZED'
  | 'DOCUMENTS_EXPIRED';

export interface BagHallDto {
  serverTime: string;
  hall: { id: string; title: string } | null;
  day: QueueHallDayDto | null;
  turn: BagTurnDto | null;
  priorities: BagPriorityDto[];
  /** true when a POST /driver/bag/turn would succeed right now. */
  canRegister: boolean;
  registerBlock: BagBlockReason | null;
  /** true when PUT /driver/bag/priorities would succeed right now. */
  canSetPriorities: boolean;
  priorityBlock: BagBlockReason | null;
  /** Running priority window (null before it opens). */
  window: { opensAt: string; closesAt: string } | null;
  result: { status: 'WAITING' | 'ALLOCATED' | 'NOT_ALLOCATED'; assignment: BagAssignmentDto | null } | null;
}

// ───────── bulk hall ─────────
export interface BulkWindowDto {
  id: string;
  seq: number;
  kind: BulkWindowKind;
  round: number;
  groupId: string;
  groupTitle: string;
  eligibleCount: number;
  reservedCount: number;
  burnedCount: number;
  carriedCount: number;
  skippedCount: number;
  opensAt: string;
  closesAt: string;
  closedAt: string | null;
  closeReason: BulkWindowCloseReason | null;
}

export type DriverBulkRole = 'HEAD' | 'CURSOR' | 'OTHER';

export interface DriverBulkStateDto {
  serverTime: string;
  hall: { id: string; title: string } | null;
  day: QueueHallDayDto | null;
  halted: boolean;
  haltedReason: string | null;
  myGroup: { id: string; title: string; role: DriverBulkRole; remainingCount: number } | null;
  headGroup: { id: string; title: string } | null;
  /** The active window; `isMine` is true when the authenticated driver may reserve in it. */
  window: {
    seq: number;
    kind: BulkWindowKind;
    round: number;
    groupId: string;
    groupTitle: string;
    isMine: boolean;
    opensAt: string;
    closesAt: string;
  } | null;
  nextGroupTitle: string | null;
  groupCount: number;
  canReserveNow: boolean;
}

// ───────── loads ─────────
export interface DriverLoadCityDto {
  cityId: number;
  cityName: string;
  provinceName: string;
  total: number;
  open: number;
}

export interface DriverLoadUnitDto {
  id: string;
  seq: number;
  allocation: Allocation;
  state: UnitState;
  reservedByMe: boolean;
}

export type LoadBlockReason =
  | 'LOADER_MISMATCH'
  | 'WINDOW_CLOSED'
  | 'NOT_IN_GROUP'
  | 'NO_UNIT_AVAILABLE'
  | 'HALL_NOT_OPEN'
  | 'HALL_HALTED'
  | 'DRIVER_NOT_APPROVED'
  | 'DRIVER_BLOCKED'
  | 'DRIVER_PENALIZED'
  | 'DOCUMENTS_EXPIRED'
  | 'DAILY_LIMIT_REACHED'
  | 'ONE_PER_WINDOW'
  | 'ACTIVE_FREE_LIMIT';

export interface DriverLoadDto {
  id: string;
  number: number;
  carrierId: string;
  carrierName: string;
  hallId: string;
  hallTitle: string;
  hallCategory: HallCategory;
  productTitle: string;
  packagingTitle: string;
  loaderTitles: string[];
  destinationTitle: string;
  originTitle: string;
  announceDate: string;
  announceTime: string;
  truckCount: number;
  weightFromKg: number;
  weightToKg: number;
  fareRial: string | null;
  allocation: Allocation;
  totalUnits: number;
  openUnits: number;
  reservedUnits: number;
  /** true when every non-cancelled unit is reserved/consumed (red «رزرو شده» tag). */
  fullyReserved: boolean;
  /** The authenticated driver already holds an active reservation on this announcement. */
  myReservedUnitId: string | null;
  isReservable: boolean;
  /** Why the reserve button is disabled; null when reservable. */
  blockReason: LoadBlockReason | null;
  /** Present in the detail endpoint only. */
  units?: DriverLoadUnitDto[];
}

// ───────── reservations ─────────
export interface ReservationCancelRequestDto {
  id: string;
  status: CancelRequestStatus;
  reason: string;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface DriverReservationDto {
  id: string;
  permitNo: number;
  status: ReservationStatus;
  source: ReservationSource;
  reservedAt: string;
  unitId: string;
  unitSeq: number;
  announcementId: string;
  announcementNumber: number;
  title: string;
  carrierName: string;
  destinationTitle: string;
  hallId: string;
  hallTitle: string;
  hallCategory: HallCategory;
  cancelRequest: ReservationCancelRequestDto | null;
  canRequestCancel: boolean;
}

export interface DriverHistoryDto {
  turns: (BagTurnDto & { hallTitle: string; date: string; assignment: BagAssignmentDto | null })[];
  reservations: DriverReservationDto[];
}

// ───────── carrier bulk management ─────────
export interface CarrierBulkGroupDriverDto {
  driverId: string;
  firstName: string;
  lastName: string;
  plate: string | null;
  loaderTitle: string | null;
}
export interface CarrierBulkGroupDto {
  id: string;
  title: string;
  sortOrder: number;
  active: boolean;
  memberCount: number;
  members: CarrierBulkGroupDriverDto[];
}

export interface CarrierBulkSettingsDto {
  maxLoadsPerDriverPerDay: number;
  leftoverAtHallEnd: 'CARRY' | 'FREE';
  /** Group that opens the next scheduled bulk day (BR-F1 initial head). */
  startHeadGroupId: string | null;
  headMinutes: number;
  freeMinutes: number;
}

export interface CarrierBulkLiveDto {
  serverTime: string;
  hall: { id: string; title: string } | null;
  day: QueueHallDayDto | null;
  headGroup: { id: string; title: string } | null;
  cursor: { groupId: string; groupTitle: string; remainingCount: number; round: number } | null;
  halted: boolean;
  haltedReason: string | null;
  activeWindow: (BulkWindowDto & { eligibleDrivers: CarrierBulkGroupDriverDto[] }) | null;
  recentWindows: BulkWindowDto[];
  settings: CarrierBulkSettingsDto;
}

export interface CarrierCancelRequestDto {
  id: string;
  status: CancelRequestStatus;
  reason: string;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** Person who asked for the cancellation. */
  driverName: string;
  carrierName: string;
  reservation: {
    id: string;
    permitNo: number;
    status: ReservationStatus;
    announcementNumber: number;
    unitSeq: number;
    destinationTitle: string;
  };
}

// ───────── factory monitor & fairness report ─────────
export interface FactoryMonitorWindowDto extends BulkWindowDto {
  carrierId: string;
  carrierName: string;
}

export interface FactoryMonitorHallDto {
  hallId: string;
  title: string;
  category: HallCategory;
  dayId: string | null;
  dayStatus: HallDayStatus | null;
  t0At: string | null;
  hallEndAt: string | null;
  haltedReason: string | null;
  /** Bulk carriers running their own rotation in this hall today. */
  bulk: {
    carrierId: string;
    carrierName: string;
    headGroupTitle: string | null;
    cursorGroupTitle: string | null;
    cursorRemaining: number;
    activeWindow: FactoryMonitorWindowDto | null;
  }[];
  allocationRun: {
    id: string;
    startedAt: string;
    finishedAt: string;
    engineVersion: string;
    assignmentCount: number;
    notAllocatedCount: number;
    inputHash: string;
    outputHash: string;
  } | null;
}

export interface FactoryMonitorDto {
  serverTime: string;
  today: string;
  halls: FactoryMonitorHallDto[];
}

export interface FactoryAllocationRunDto {
  id: string;
  hallDayId: string;
  startedAt: string;
  finishedAt: string;
  engineVersion: string;
  inputHash: string;
  outputHash: string;
  input: unknown;
  output: unknown;
}

export interface BulkFairnessRowDto {
  date: string;
  carrierName: string;
  groupTitle: string;
  windowSeq: number;
  round: number;
  kind: BulkWindowKind;
  driverName: string;
  plate: string | null;
  announcementNumber: number | null;
  destinationTitle: string | null;
  reservedAt: string | null;
}

// ───────── SSE ─────────
export const QUEUE_EVENT_NAMES = ['unit.reserved', 'unit.freed', 'window.changed', 'notification'] as const;
export type QueueEventName = (typeof QUEUE_EVENT_NAMES)[number];

export interface QueueSseEvent {
  type: QueueEventName;
  tenantId: string;
  hallId?: string;
  userId?: string;
  at: string;
  payload: Record<string, unknown>;
}
