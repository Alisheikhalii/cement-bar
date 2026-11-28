/**
 * Response DTOs of the announcements slice. OWNED BY AGENT E in Phase 2 — the only shared file that agent may edit.
 * Keep types JSON-shaped (bigint → string, Date → ISO string).
 */
import type { AnnouncementFormValues } from '../domain';
import type {
  Allocation,
  AnnouncementStatus,
  AnnouncementView,
  HallCategory,
  PackagingCategory,
  UnitState,
} from '../enums';

/** «وضعیت جذب» column (computed by the API from unit states). */
export const ABSORPTIONS = ['NONE', 'PARTIAL', 'FULL', 'CANCELLED'] as const;
export type Absorption = (typeof ABSORPTIONS)[number];
export const ABSORPTION_LABELS_FA: Record<Absorption, string> = {
  NONE: 'جذب نشده',
  PARTIAL: 'جذب ناقص',
  FULL: 'جذب کامل',
  CANCELLED: 'کنسل شده',
};

/** Statuses shown by each list view (source spec §4.2 radio filter). */
export const ANNOUNCEMENT_VIEW_STATUSES: Record<AnnouncementView, readonly AnnouncementStatus[]> = {
  // ASSUMPTION(Q-E-6): active = ACTIVE; archived = finished/cancelled; history = every status.
  active: ['ACTIVE'],
  archived: ['COMPLETED', 'ARCHIVED', 'CANCELLED'],
  history: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED'],
};

/** Request header for safe retries of create / copy (same key → same announcement, no second insert). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export interface AnnouncementUnitDto {
  id: string;
  seq: number;
  allocation: Allocation;
  state: UnitState;
  /** Allocation the unit was created with (before any BR-10 change). */
  baseAllocation: Allocation;
  /** For a freed unit: the allocation it can return to (BR-10). null otherwise. */
  revertTo: Allocation | null;
  /** Allocations this unit may be changed to right now (server rule; empty when not OPEN). */
  allowedTargets: Allocation[];
}

export interface AnnouncementUnitCounts {
  /** Non-cancelled units (= current truckCount for quota). */
  total: number;
  open: number;
  /** RESERVED + CONSUMED («تعداد مجوز صادر»). */
  issued: number;
  held: number;
  cancelled: number;
}

export type AnnouncementEditBlock = 'NOT_ACTIVE' | 'HAS_RESERVATIONS' | 'HAS_PRIORITIES';

/** Editable form values as stored (numbers instead of bigint; national ids decrypted for the owner). */
export type AnnouncementFormData = AnnouncementFormValues;

export interface AnnouncementDetailDto {
  id: string;
  number: number;
  status: AnnouncementStatus;
  cancelReason: string | null;
  createdAt: string;
  carrier: { code: string; name: string };
  hall: { id: string; title: string; category: HallCategory | null };
  /** Allocation new units of this announcement get (hall default / chosen at creation). */
  baseAllocation: Allocation;
  form: AnnouncementFormData;
  /** Display names of referenced master data (may be deactivated since). */
  labels: {
    product: string | null;
    packaging: string | null;
    loaderType: string | null;
    loaderType2: string | null;
    destination: string | null;
    originCity: string | null;
    destCity: string | null;
    loadingLocation: string | null;
    cargoDescription: string | null;
    goodsOwner: string | null;
    senderParty: string | null;
    receiverParty: string | null;
  };
  units: AnnouncementUnitDto[];
  counts: AnnouncementUnitCounts;
  /** D12 consumption of this announcement in kg (string bigint). */
  quotaKg: string;
  editable: boolean;
  editBlockedReason: AnnouncementEditBlock | null;
  cancellable: boolean;
}

export interface AnnouncementSummaryDto {
  announcements: number;
  trucks: number;
  remaining: number;
}

export interface AllocationChangeResultDto {
  changed: number;
  units: AnnouncementUnitDto[];
}

// ───────── lookups (select sources of the 7-section form) ─────────
export interface LookupHall {
  id: string;
  title: string;
  category: HallCategory;
  defaultAllocation: Allocation;
}
export interface LookupTitled {
  id: string;
  title: string;
}
export interface LookupPackaging extends LookupTitled {
  category: PackagingCategory;
}
export interface LookupLoaderType extends LookupTitled {
  code: string;
}
export interface LookupDestination extends LookupTitled {
  cityId: number;
  cityName: string;
}
export interface LookupLoadingLocation {
  id: string;
  name: string;
  warehouseType: string;
  cityId: number | null;
  cityName: string | null;
  address: string | null;
  /** carrierId = null: factory-shared row (P2-5). */
  shared: boolean;
}
export interface LookupCargoDescription {
  id: string;
  text: string;
  shared: boolean;
}
export interface LookupLoadingCondition {
  id: string;
  name: string | null;
  condition: string;
  shared: boolean;
}
export interface LookupPartyAddress {
  title?: string;
  cityId?: number;
  cityName?: string | null;
  postalCode?: string;
  address: string;
}
export interface LookupParty {
  id: string;
  title: string;
  name: string;
  nationalId: string | null;
  addresses: LookupPartyAddress[];
}
export interface LookupGoodsOwner {
  id: string;
  name: string;
}

export interface AnnouncementLookupsDto {
  /** Server-local (Asia/Tehran) date/time for form defaults. */
  today: string;
  nowTime: string;
  halls: LookupHall[];
  products: LookupTitled[];
  packagingTypes: LookupPackaging[];
  loaderTypes: LookupLoaderType[];
  destinations: LookupDestination[];
  loadingLocations: LookupLoadingLocation[];
  cargoDescriptions: LookupCargoDescription[];
  loadingConditions: LookupLoadingCondition[];
  parties: LookupParty[];
  goodsOwners: LookupGoodsOwner[];
}
