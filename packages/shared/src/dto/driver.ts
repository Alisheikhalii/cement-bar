/**
 * Response DTOs of the driver slice. OWNED BY AGENT G in Phase 2 — the only shared file that agent may edit.
 * Keep types JSON-shaped (bigint → string, Date → ISO string).
 * All names are prefixed with `Driver` to avoid collisions in the shared barrel export.
 */
import type { CarrierStatus, DriverStatus, HallCategory, HallDayStatus, VehicleStatus } from '../enums';

/** Document validity level (DECISIONS Q-B5): >60 days success, 15..60 warning, 0..14 danger, <0 expired. */
export type DriverDocumentLevel = 'success' | 'warning' | 'danger' | 'expired';
export const DRIVER_DOCUMENT_KINDS = ['HEALTH_CARD', 'SMART_CARD', 'INSPECTION'] as const;
export type DriverDocumentKind = (typeof DRIVER_DOCUMENT_KINDS)[number];

export interface DriverDocumentDto {
  kind: DriverDocumentKind;
  /** Local ISO date "YYYY-MM-DD". */
  expiry: string;
  /** Days left computed with the SERVER clock in Asia/Tehran (negative = expired). */
  daysLeft: number;
  level: DriverDocumentLevel;
}

export type DriverAlertKind =
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'BLOCKED'
  | 'PENALIZED'
  | 'DOCUMENT_EXPIRED'
  | 'DOCUMENT_EXPIRING'
  | 'VEHICLE_CHANGE_PENDING'
  | 'NO_VEHICLE';

export interface DriverAlertDto {
  kind: DriverAlertKind;
  tone: 'info' | 'warning' | 'danger';
  /** REJECTED: carrier note; BLOCKED: block reason. */
  reason?: string | null;
  /** BLOCKED / PENALIZED: ISO instant until which the restriction holds (null = indefinite). */
  until?: string | null;
  /** DOCUMENT_*: which document. */
  document?: DriverDocumentKind;
  daysLeft?: number;
}

export interface DriverRef {
  id: string;
  title: string;
}

export interface DriverCityRef {
  id: number;
  name: string;
  province: string;
}

export interface DriverVehicleSummaryDto {
  id: string;
  plate: string;
  status: VehicleStatus;
  loaderType: DriverRef | null;
}

export interface DriverDashboardDto {
  serverTime: string;
  /** Today's local ISO date in Asia/Tehran. */
  today: string;
  driver: {
    firstName: string;
    lastName: string;
    status: DriverStatus;
    /** Display hint only: approved, not blocked, not penalized, documents valid. The API re-checks every action. */
    canOperate: boolean;
  };
  carrier: { id: string; name: string; status: CarrierStatus };
  vehicle: DriverVehicleSummaryDto | null;
  documents: DriverDocumentDto[];
  alerts: DriverAlertDto[];
}

export interface DriverProfileDto {
  /** Read-only identity (P2-4). */
  mobile: string | null;
  nationalId: string;
  firstName: string;
  lastName: string;
  status: DriverStatus;
  decisionNote: string | null;
  // editable (driverProfileUpdateSchema)
  licenseNo: string;
  licenseIssueDate: string;
  birthCity: DriverCityRef | null;
  birthDate: string | null;
  healthCardExpiry: string;
  residenceCity: DriverCityRef | null;
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  bankName: string | null;
  accountNo: string | null;
  sheba: string | null;
}

export interface DriverVehiclePendingChangeDto {
  plate?: string;
  loaderType?: DriverRef | null;
  smartCardNo?: string;
  requestedAt: string;
}

export interface DriverVehicleDto {
  id: string;
  smartCardNo: string;
  plate: string;
  loaderType: DriverRef | null;
  status: VehicleStatus;
  smartCardExpiry: string;
  inspectionExpiry: string;
  pendingChange: DriverVehiclePendingChangeDto | null;
}

export interface DriverCompanyDto {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  address: string | null;
  status: CarrierStatus;
  /** True for the carrier the driver is registered with. */
  mine: boolean;
  /** Only for `mine`: the driver's approval status with this carrier. */
  driverStatus: DriverStatus | null;
}

export interface DriverHallHoursEntryDto {
  hallId: string;
  hallTitle: string;
  category: HallCategory;
  terminalName: string | null;
  terminalCity: string | null;
  /** DAY = a factory-created hall day; SCHEDULE = projected from the weekly schedule (not created yet). */
  source: 'DAY' | 'SCHEDULE';
  /** null for SCHEDULE entries. */
  status: HallDayStatus | null;
  t0At: string;
  priorityEndAt: string | null;
  hallEndAt: string;
}

export interface DriverHallHoursDayDto {
  /** Local ISO date in Asia/Tehran. */
  date: string;
  /** 0 = Saturday … 6 = Friday. */
  weekday: number;
  entries: DriverHallHoursEntryDto[];
}

export interface DriverHallHoursDto {
  serverTime: string;
  today: string;
  days: DriverHallHoursDayDto[];
}

/** Number of days (today included) covered by GET /driver/hall-hours. */
export const DRIVER_HALL_HOURS_DAYS = 7;
