/**
 * Response DTOs of the carrier slice. OWNED BY AGENT F in Phase 2 — the only shared file that agent may edit.
 * Keep types JSON-shaped (bigint → string, Date → ISO string).
 *
 * Also holds the table column configs of the carrier slice that are not part of the shared
 * columns contract (drivers, master data, daily files, quota usage).
 */
import { defineColumns } from '../columns/types';
import { DRIVER_STATUS_LABELS_FA, VEHICLE_STATUS_LABELS_FA, type DriverStatus, type VehicleStatus } from '../enums';

// ─────────────────────────── dashboard ───────────────────────────
/** GET /carrier/dashboard */
export interface CarrierDashboardDto {
  /** Jalali month of "today" (server clock, Asia/Tehran). */
  yearMonth: string;
  quota: { limitKg: string | null; usedKg: string; remainingKg: string | null };
  activeAnnouncements: number;
  activePermits: number;
  pendingDrivers: number;
  pendingVehicleChanges: number;
  pendingCancelRequests: number;
  unseenDailyFiles: number;
}

// ─────────────────────────── drivers ───────────────────────────
export const CARRIER_DRIVER_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'fullName', label: 'نام راننده', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'mobile', label: 'موبایل', type: 'text', source: { kind: 'field', path: 'user.mobile' }, filter: 'text', defaultVisible: true },
  { id: 'nationalId', label: 'کد ملی', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'status', label: 'وضعیت', type: 'enum', source: { kind: 'field', path: 'status' }, sortable: true, filter: 'enum', enumLabels: DRIVER_STATUS_LABELS_FA, defaultVisible: true },
  { id: 'plate', label: 'پلاک', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'loaderType', label: 'نوع بارگیر', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'vehicleStatus', label: 'وضعیت خودرو', type: 'enum', source: { kind: 'computed' }, enumLabels: VEHICLE_STATUS_LABELS_FA, defaultVisible: true },
  { id: 'licenseNo', label: 'شماره گواهینامه', type: 'text', source: { kind: 'field', path: 'licenseNo' }, filter: 'text' },
  { id: 'healthCardExpiry', label: 'انقضای کارت سلامت', type: 'date', source: { kind: 'computed' } },
  { id: 'smartCardExpiry', label: 'انقضای کارت هوشمند', type: 'date', source: { kind: 'computed' } },
  { id: 'inspectionExpiry', label: 'انقضای معاینه فنی', type: 'date', source: { kind: 'computed' } },
  { id: 'blockReason', label: 'علت مسدودی', type: 'text', source: { kind: 'field', path: 'blockReason' } },
  { id: 'decisionNote', label: 'یادداشت تصمیم', type: 'text', source: { kind: 'field', path: 'decisionNote' } },
  { id: 'createdAt', label: 'تاریخ ثبت‌نام', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true, filter: 'date', defaultVisible: true },
]);

export interface CarrierVehicleDto {
  id: string;
  plate: string;
  smartCardNo: string;
  loaderTypeId: string;
  loaderType: string | null;
  status: VehicleStatus;
  smartCardExpiry: string;
  inspectionExpiry: string;
  /** Requested change awaiting this carrier's decision (T7). */
  pendingChange: {
    plate?: string;
    loaderTypeId?: string;
    loaderType?: string | null;
    smartCardNo?: string;
    requestedAt: string;
  } | null;
}

/** GET /carrier/drivers/:id */
export interface CarrierDriverDetailDto {
  id: string;
  status: DriverStatus;
  firstName: string;
  lastName: string;
  mobile: string | null;
  nationalId: string;
  licenseNo: string;
  licenseIssueDate: string;
  birthCity: string | null;
  birthDate: string | null;
  residenceCity: string | null;
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  healthCardExpiry: string;
  blockedUntil: string | null;
  blockReason: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  vehicle: CarrierVehicleDto | null;
}

// ─────────────────────────── master data ───────────────────────────
export const CARRIER_MASTER_KINDS = [
  'parties',
  'goods-owners',
  'loading-locations',
  'cargo-descriptions',
  'loading-conditions',
] as const;
export type CarrierMasterKind = (typeof CARRIER_MASTER_KINDS)[number];

/** `shared` = factory-owned row (carrierId null): read-only for carriers (DECISIONS P2-5). */
const sharedCol = { id: 'shared', label: 'مشترک کارخانه', type: 'bool', source: { kind: 'computed' }, defaultVisible: true } as const;
const createdCol = { id: 'createdAt', label: 'تاریخ ثبت', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true } as const;

export const PARTY_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'title', label: 'عنوان', type: 'text', source: { kind: 'field', path: 'title' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'name', label: 'نام', type: 'text', source: { kind: 'field', path: 'name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'nationalId', label: 'کد ملی', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'economicCode', label: 'کد اقتصادی', type: 'text', source: { kind: 'field', path: 'economicCode' }, filter: 'text', defaultVisible: true },
  { id: 'addressCount', label: 'تعداد آدرس', type: 'number', source: { kind: 'computed' }, defaultVisible: true },
  createdCol,
]);
export const GOODS_OWNER_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'name', label: 'نام', type: 'text', source: { kind: 'field', path: 'name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'nationalId', label: 'کدملی', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'phone', label: 'تلفن', type: 'text', source: { kind: 'field', path: 'phone' }, filter: 'text', defaultVisible: true },
  { id: 'mobile', label: 'موبایل', type: 'text', source: { kind: 'field', path: 'mobile' }, filter: 'text', defaultVisible: true },
  { id: 'otherInfo', label: 'سایر اطلاعات', type: 'text', source: { kind: 'field', path: 'otherInfo' }, defaultVisible: true },
  createdCol,
]);
export const LOADING_LOCATION_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'warehouseType', label: 'نوع انبار', type: 'text', source: { kind: 'field', path: 'warehouseType' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'name', label: 'نام انبار', type: 'text', source: { kind: 'field', path: 'name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'nationalCode', label: 'کد/شناسه ملی انبار', type: 'text', source: { kind: 'field', path: 'nationalCode' }, filter: 'text', defaultVisible: true },
  { id: 'nature', label: 'ماهیت انبار', type: 'text', source: { kind: 'field', path: 'nature' }, filter: 'text', defaultVisible: true },
  { id: 'city', label: 'نام شهر', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'address', label: 'آدرس', type: 'text', source: { kind: 'field', path: 'address' } },
  { id: 'phone', label: 'تلفن', type: 'text', source: { kind: 'field', path: 'phone' } },
  sharedCol,
  createdCol,
]);
export const CARGO_DESCRIPTION_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'text', label: 'شرح محموله', type: 'text', source: { kind: 'field', path: 'text' }, sortable: true, filter: 'text', defaultVisible: true },
  sharedCol,
  createdCol,
]);
export const LOADING_CONDITION_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'name', label: 'نام', type: 'text', source: { kind: 'field', path: 'name' }, sortable: true, filter: 'text', defaultVisible: true },
  { id: 'condition', label: 'شرایط بارگیری', type: 'text', source: { kind: 'field', path: 'condition' }, filter: 'text', defaultVisible: true },
  sharedCol,
  createdCol,
]);

export const CARRIER_MASTER_COLUMNS = {
  parties: PARTY_COLUMNS,
  'goods-owners': GOODS_OWNER_COLUMNS,
  'loading-locations': LOADING_LOCATION_COLUMNS,
  'cargo-descriptions': CARGO_DESCRIPTION_COLUMNS,
  'loading-conditions': LOADING_CONDITION_COLUMNS,
} as const;

/** GET /carrier/master/:kind/:id — the editable values (national ids decrypted). */
export type CarrierMasterRecordDto = { id: string; shared: boolean } & Record<string, unknown>;
/** GET /carrier/master/:kind/options?q= */
export interface CarrierMasterOptionDto {
  id: string;
  label: string;
  shared: boolean;
}

// ─────────────────────────── daily files ───────────────────────────
export const CARRIER_DAILY_FILE_COLUMNS = defineColumns([
  { id: 'rowNo', label: 'ردیف', type: 'number', source: { kind: 'computed' }, defaultVisible: true, hideOnMobile: true },
  { id: 'forDate', label: 'تاریخ', type: 'date', source: { kind: 'field', path: 'forDate' }, sortable: true, filter: 'date', defaultVisible: true },
  { id: 'originalName', label: 'نام فایل', type: 'text', source: { kind: 'field', path: 'originalName' }, filter: 'text', defaultVisible: true },
  { id: 'sizeKb', label: 'حجم (کیلوبایت)', type: 'number', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'note', label: 'توضیحات', type: 'text', source: { kind: 'field', path: 'note' }, defaultVisible: true },
  { id: 'createdAt', label: 'زمان ارسال', type: 'datetime', source: { kind: 'field', path: 'createdAt' }, sortable: true, filter: 'date', defaultVisible: true },
  { id: 'seen', label: 'دیده‌شده', type: 'bool', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'seenAt', label: 'زمان مشاهده', type: 'datetime', source: { kind: 'field', path: 'seenAt' }, sortable: true },
]);

// ─────────────────────────── reports ───────────────────────────
/** Quota usage (BR-08 / D12): one row per carrier for a Jalali month. */
export const QUOTA_USAGE_COLUMNS = defineColumns([
  { id: 'carrierCode', label: 'کد شرکت', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'carrierName', label: 'نام شرکت', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'yearMonth', label: 'ماه', type: 'text', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'limitKg', label: 'سهمیه', type: 'weightKg', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'usedKg', label: 'مصرف‌شده', type: 'weightKg', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'remainingKg', label: 'مانده', type: 'weightKg', source: { kind: 'computed' }, defaultVisible: true },
  { id: 'usedPercent', label: 'درصد مصرف', type: 'number', source: { kind: 'computed' }, defaultVisible: true },
]);

/** GET /factory/reports/carriers — options for the carrier filter of factory reports. */
export interface ReportCarrierOptionDto {
  id: string;
  code: string;
  name: string;
}
