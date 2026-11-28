// Mirrors prisma enums (apps/api/prisma/schema.prisma). Keep in sync.
export const ROLES = ['FACTORY_OPERATOR', 'CARRIER_OPERATOR', 'DRIVER'] as const;
export type Role = (typeof ROLES)[number];

export const DRIVER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'BLOCKED'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const ALLOCATIONS = ['GROUP', 'TIMED', 'FREE'] as const;
export type Allocation = (typeof ALLOCATIONS)[number];

export const STRATEGIES = ['TIMED_PRIORITY_RESERVATION', 'BULK_GROUP_ROTATION', 'FREE_FIRST_COME'] as const;
export type StrategyCode = (typeof STRATEGIES)[number];

export const HALL_CATEGORIES = ['BAG', 'BULK'] as const;
export type HallCategory = (typeof HALL_CATEGORIES)[number];

export const RESERVATION_STATUSES = [
  'RESERVED', 'ARRIVED', 'LOADED', 'EXITED', 'CANCEL_REQUESTED', 'CANCELLED', 'NO_SHOW', 'RETURNED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'RESERVED', 'ARRIVED', 'LOADED', 'EXITED', 'CANCEL_REQUESTED',
];

export const ANNOUNCEMENT_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ROLE_LABELS_FA: Record<Role, string> = {
  FACTORY_OPERATOR: 'اپراتور کارخانه',
  CARRIER_OPERATOR: 'اپراتور باربری',
  DRIVER: 'راننده',
};

export const DRIVER_STATUS_LABELS_FA: Record<DriverStatus, string> = {
  PENDING: 'در انتظار تأیید',
  APPROVED: 'تأیید شده',
  REJECTED: 'رد شده',
  BLOCKED: 'مسدود',
};

export const ALLOCATION_LABELS_FA: Record<Allocation, string> = {
  GROUP: 'گروهی (فله)',
  TIMED: 'زمانی (کیسه‌ای)',
  FREE: 'آزاد',
};

export const RESERVATION_STATUS_LABELS_FA: Record<ReservationStatus, string> = {
  RESERVED: 'رزرو شده',
  ARRIVED: 'حضور',
  LOADED: 'بارگیری شد',
  EXITED: 'خروج',
  CANCEL_REQUESTED: 'درخواست لغو',
  CANCELLED: 'لغو شده',
  NO_SHOW: 'عدم حضور',
  RETURNED: 'برگشت',
};

export const CARRIER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type CarrierStatus = (typeof CARRIER_STATUSES)[number];
export const CARRIER_STATUS_LABELS_FA: Record<CarrierStatus, string> = { ACTIVE: 'فعال', SUSPENDED: 'تعلیق' };

export const VEHICLE_STATUSES = ['APPROVED', 'PENDING_CHANGE'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
export const VEHICLE_STATUS_LABELS_FA: Record<VehicleStatus, string> = {
  APPROVED: 'تأیید شده',
  PENDING_CHANGE: 'تغییر در انتظار تأیید',
};

export const PACKAGING_CATEGORIES = ['BAG', 'BULK'] as const;
export type PackagingCategory = (typeof PACKAGING_CATEGORIES)[number];
export const HALL_CATEGORY_LABELS_FA: Record<HallCategory, string> = { BAG: 'کیسه‌ای', BULK: 'فله' };

export const HALL_DAY_STATUSES = ['SCHEDULED', 'OPEN', 'ALLOCATING', 'CLOSED', 'HALTED', 'CANCELLED'] as const;
export type HallDayStatus = (typeof HALL_DAY_STATUSES)[number];
export const HALL_DAY_STATUS_LABELS_FA: Record<HallDayStatus, string> = {
  SCHEDULED: 'برنامه‌ریزی‌شده',
  OPEN: 'باز',
  ALLOCATING: 'در حال تخصیص',
  CLOSED: 'بسته',
  HALTED: 'توقف اضطراری',
  CANCELLED: 'لغو شده',
};

export const UNIT_STATES = ['OPEN', 'RESERVED', 'CONSUMED', 'CANCELLED', 'HELD'] as const;
export type UnitState = (typeof UNIT_STATES)[number];
export const UNIT_STATE_LABELS_FA: Record<UnitState, string> = {
  OPEN: 'آزاد',
  RESERVED: 'رزرو شده',
  CONSUMED: 'مصرف شده',
  CANCELLED: 'لغو شده',
  HELD: 'نگه‌داشته',
};

export const FARE_CALCS = ['PER_TRUCK', 'PER_TON'] as const;
export type FareCalc = (typeof FARE_CALCS)[number];
export const FARE_CALC_LABELS_FA: Record<FareCalc, string> = { PER_TRUCK: 'کامیونی', PER_TON: 'تناژی' };

export const ANNOUNCEMENT_STATUS_LABELS_FA: Record<AnnouncementStatus, string> = {
  DRAFT: 'پیش‌نویس',
  ACTIVE: 'فعال',
  COMPLETED: 'تکمیل شده',
  CANCELLED: 'کنسل شده',
  ARCHIVED: 'آرشیو',
};
/** List filters of the announcements page (source spec §4.2). */
export const ANNOUNCEMENT_VIEWS = ['active', 'archived', 'history'] as const;
export type AnnouncementView = (typeof ANNOUNCEMENT_VIEWS)[number];

export const CANCEL_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type CancelRequestStatus = (typeof CANCEL_REQUEST_STATUSES)[number];

export const RESERVATION_SOURCES = ['TIMED', 'GROUP', 'FREE', 'MANUAL'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

/** Permit list filter (source spec §4.6): active vs archived. */
export const PERMIT_VIEWS = ['active', 'archived'] as const;
export type PermitView = (typeof PERMIT_VIEWS)[number];
export const ARCHIVED_RESERVATION_STATUSES: readonly ReservationStatus[] = ['EXITED', 'CANCELLED', 'NO_SHOW', 'RETURNED'];

/** Operational permit transitions (PRD §5.5). Key = action, value = allowed `from` statuses → `to`. */
export const PERMIT_TRANSITIONS = {
  arrive: { from: ['RESERVED'], to: 'ARRIVED' },
  load: { from: ['ARRIVED'], to: 'LOADED' },
  exit: { from: ['LOADED'], to: 'EXITED' },
  'no-show': { from: ['RESERVED'], to: 'NO_SHOW' },
  return: { from: ['LOADED'], to: 'RETURNED' },
} as const satisfies Record<string, { from: readonly ReservationStatus[]; to: ReservationStatus }>;
export type PermitAction = keyof typeof PERMIT_TRANSITIONS;
