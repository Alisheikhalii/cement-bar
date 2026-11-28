/**
 * Response DTOs of the factory slice. OWNED BY AGENT D in Phase 2 — the only shared file that agent may edit.
 * Keep types JSON-shaped (bigint → string, Date → ISO string).
 *
 * Also holds the column configs of the factory list endpoints (ServerTable + parseListQuery/respondList).
 */
import {
  CARRIER_STATUS_LABELS_FA,
  DRIVER_STATUS_LABELS_FA,
  ROLE_LABELS_FA,
  type Allocation,
  type CarrierStatus,
  type DriverStatus,
  type HallCategory,
  type HallDayStatus,
  type PackagingCategory,
  type StrategyCode,
} from '../enums';
import { defineColumns } from '../columns/types';

// ───────── dashboard ─────────
export interface FactoryHallTodayDto {
  hallId: string;
  hallTitle: string;
  category: HallCategory;
  dayId: string | null;
  status: HallDayStatus | null;
  t0At: string | null;
  hallEndAt: string | null;
}

export interface FactoryDashboardDto {
  /** Local ISO date (business tz) the counters refer to. */
  today: string;
  /** Jalali year-month of `today` ("1405-09"). */
  yearMonth: string;
  announcementsToday: number;
  activeReservations: number;
  carriers: { active: number; suspended: number };
  drivers: { approved: number; pending: number; blocked: number };
  hallsToday: FactoryHallTodayDto[];
  /** Active carriers without a quota row for `yearMonth` (announcing is blocked for them, D12). */
  carriersWithoutQuota: number;
}

// ───────── carriers ─────────
export interface CarrierDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  nationalId: string | null;
  status: CarrierStatus;
  createdAt: string;
}

export interface CarrierUserDto {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CarrierDetailDto extends CarrierDto {
  operators: CarrierUserDto[];
  driversCount: number;
}

export interface CarrierQuotaDto {
  yearMonth: string;
  /** null = no quota row for the month (announcing blocked, D12). */
  tonnageLimitKg: string | null;
  usedKg: string;
  updatedAt: string | null;
}

// ───────── halls ─────────
export interface HallScheduleDto {
  weekday: number;
  t0: string;
  priorityEnd: string | null;
  hallEnd: string;
  headMinutes: number | null;
  freeMinutes: number | null;
  active: boolean;
}

export interface HallDto {
  id: string;
  title: string;
  category: HallCategory;
  defaultAllocation: Allocation;
  terminalName: string | null;
  terminalCity: string | null;
  active: boolean;
  createdAt: string;
  schedules: HallScheduleDto[];
}

export interface HallDayDto {
  id: string;
  hallId: string;
  date: string;
  t0At: string;
  priorityEndAt: string | null;
  hallEndAt: string;
  status: HallDayStatus;
  haltedReason: string | null;
}

export type HallDaySkipReason = 'EXISTS' | 'NO_SCHEDULE' | 'PAST';
export interface HallDayGenerateResultDto {
  created: string[];
  /** Dates skipped: already exist, no active schedule for the weekday, or start already passed. */
  skipped: { date: string; reason: HallDaySkipReason }[];
}

// ───────── master data ─────────
export interface DestinationDto {
  id: string;
  cityId: number;
  cityName: string;
  provinceName: string;
  title: string;
  active: boolean;
  sortOrder: number;
}
export interface LoaderTypeDto {
  id: string;
  code: string;
  title: string;
  active: boolean;
  sortOrder: number;
}
export interface PackagingTypeDto {
  id: string;
  title: string;
  category: PackagingCategory;
  active: boolean;
}
export interface ProductDto {
  id: string;
  title: string;
  active: boolean;
}

// ───────── policies ─────────
export interface PolicyDto {
  id: string;
  hallId: string;
  hallTitle: string;
  strategy: StrategyCode;
  version: number;
  params: Record<string, unknown>;
  activeFrom: string;
  note: string | null;
  createdAt: string;
  /** true for the highest version of (hall, strategy). */
  current: boolean;
}

// ───────── drivers / files ─────────
export interface DriverBlockResultDto {
  id: string;
  status: DriverStatus;
  blockedUntil: string | null;
  blockReason: string | null;
}

export interface DailyFileDto {
  id: string;
  carrierId: string;
  forDate: string;
  originalName: string;
  size: number;
  sha256: string;
  note: string | null;
  createdAt: string;
}

// ───────── list column configs ─────────
/** GET /factory/carriers — root model Carrier. */
export const FACTORY_CARRIER_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'code', label: 'کد باربری', type: 'text', source: { kind: 'field', path: 'code' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'name', label: 'نام باربری', type: 'text', source: { kind: 'field', path: 'name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'phone', label: 'تلفن', type: 'text', source: { kind: 'field', path: 'phone' }, filter: 'text', defaultVisible: true },
  { id: 'status', label: 'وضعیت', type: 'enum', source: { kind: 'field', path: 'status' }, sortable: true, filter: 'enum', enumLabels: CARRIER_STATUS_LABELS_FA, defaultVisible: true },
  { id: 'operators', label: 'تعداد اپراتور', type: 'number', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'drivers', label: 'تعداد راننده', type: 'number', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'nationalId', label: 'شناسه ملی', type: 'text', source: { kind: 'field', path: 'nationalId' }, filter: 'text' },
  { id: 'createdAt', label: 'تاریخ ایجاد', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true, filter: 'date' },
]);

/** GET /factory/drivers — root model Driver. */
export const FACTORY_DRIVER_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'firstName', label: 'نام', type: 'text', source: { kind: 'field', path: 'firstName' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'lastName', label: 'نام خانوادگی', type: 'text', source: { kind: 'field', path: 'lastName' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'mobile', label: 'موبایل', type: 'text', source: { kind: 'field', path: 'user.mobile' }, filter: 'text', defaultVisible: true },
  { id: 'carrierName', label: 'باربری', type: 'text', source: { kind: 'field', path: 'carrier.name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'status', label: 'وضعیت', type: 'enum', source: { kind: 'field', path: 'status' }, sortable: true, filter: 'enum', enumLabels: DRIVER_STATUS_LABELS_FA, defaultVisible: true },
  { id: 'plate', label: 'پلاک', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'loaderType', label: 'نوع بارگیر', type: 'text', source: { kind: 'computed' } },
  { id: 'blockedUntil', label: 'مسدود تا', type: 'datetime', source: { kind: 'field', path: 'blockedUntil' }, sortable: true },
  { id: 'blockReason', label: 'علت مسدودی', type: 'text', source: { kind: 'field', path: 'blockReason' }, filter: 'text' },
  { id: 'createdAt', label: 'تاریخ ثبت‌نام', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true, filter: 'date' },
]);

/** GET /factory/daily-files — root model DailyFile. */
export const FACTORY_DAILY_FILE_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'forDate', label: 'تاریخ پرونده', type: 'date', source: { kind: 'field', path: 'forDate' }, sortable: true, filter: 'date', defaultVisible: true },
  { id: 'carrierName', label: 'باربری', type: 'text', source: { kind: 'field', path: 'carrier.name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'originalName', label: 'نام فایل', type: 'text', source: { kind: 'field', path: 'originalName' }, filter: 'text', defaultVisible: true },
  { id: 'size', label: 'حجم (بایت)', type: 'number', source: { kind: 'field', path: 'size' }, sortable: true },
  { id: 'note', label: 'توضیح', type: 'text', source: { kind: 'field', path: 'note' }, filter: 'text', defaultVisible: true },
  { id: 'createdAt', label: 'زمان بارگذاری', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true, filter: 'date', defaultVisible: true },
  { id: 'seenAt', label: 'زمان مشاهده باربری', type: 'datetime', source: { kind: 'field', path: 'seenAt' }, sortable: true, filter: 'date', defaultVisible: true },
]);

/** GET /factory/audit — root model AuditLog (tenant-scoped). */
export const FACTORY_AUDIT_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'at', label: 'زمان', type: 'datetime', source: { kind: 'field', path: 'at' }, sortable: true, filter: 'date', defaultVisible: true },
  { id: 'actorName', label: 'کاربر', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'actorRole', label: 'نقش', type: 'enum', source: { kind: 'field', path: 'actorRole' }, filter: 'enum', enumLabels: ROLE_LABELS_FA, defaultVisible: true },
  { id: 'action', label: 'رویداد', type: 'text', source: { kind: 'field', path: 'action' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'entity', label: 'موجودیت', type: 'text', source: { kind: 'field', path: 'entity' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'entityId', label: 'شناسه موجودیت', type: 'text', source: { kind: 'field', path: 'entityId' }, filter: 'text' },
  { id: 'reason', label: 'علت', type: 'text', source: { kind: 'field', path: 'reason' }, filter: 'text', defaultVisible: true },
  { id: 'ip', label: 'IP', type: 'text', source: { kind: 'field', path: 'ip' }, filter: 'text' },
]);

/** GET /factory/sessions — active sessions (one row per family), root model Session. */
export const FACTORY_SESSION_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'userName', label: 'کاربر', type: 'text', source: { kind: 'field', path: 'user.displayName' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'identifier', label: 'نام کاربری / موبایل', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'role', label: 'نقش', type: 'enum', source: { kind: 'field', path: 'user.role' }, filter: 'enum', enumLabels: ROLE_LABELS_FA, defaultVisible: true },
  { id: 'carrierName', label: 'باربری', type: 'text', source: { kind: 'computed' } },
  { id: 'createdAt', label: 'شروع نشست', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true, filter: 'date', defaultVisible: true },
  { id: 'lastUsedAt', label: 'آخرین استفاده', type: 'datetime', source: { kind: 'field', path: 'lastUsedAt' }, sortable: true, defaultVisible: true },
  { id: 'ip', label: 'IP', type: 'text', source: { kind: 'field', path: 'ip' }, filter: 'text' },
  { id: 'deviceInfo', label: 'دستگاه', type: 'text', source: { kind: 'field', path: 'deviceInfo' } },
]);
