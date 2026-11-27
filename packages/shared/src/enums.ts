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
