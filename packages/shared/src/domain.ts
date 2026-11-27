/**
 * Phase 2 request contracts (SPEC §4). All objects are strict: unknown keys are rejected.
 * Scope ids (tenantId / carrierId / driverId) are NEVER part of a body — they come from the session.
 * Money: rial as integer (JSON number ≤ 2^53, converted to BigInt by the API). Weight: integer kg.
 */
import { z } from 'zod';
import { ALLOCATIONS, CARRIER_STATUSES, FARE_CALCS, HALL_CATEGORIES, PACKAGING_CATEGORIES } from './enums';
import { optionalText, zHHmm, zIsoDate, zMobile, zPassword, zPlate, zUuid } from './schemas';
import { isValidSheba } from './validators';
import { enDigits } from './digits';

const text = (max = 200) => z.string().trim().min(1, 'این فیلد الزامی است').max(max);
const zMoney = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const zKg = z.number().int().min(0).max(1_000_000);
const zCityId = z.number().int().positive();
const zReason = text(500);
/** Jalali year-month, e.g. "1405-09". */
export const zYearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'ماه معتبر نیست (مثال: ۱۴۰۵-۰۹)');
export const zSheba = z
  .string()
  .transform((v) => enDigits(v).replace(/\s/g, '').toUpperCase())
  .refine(isValidSheba, 'شماره شبا معتبر نیست');
const zDigits = (min: number, max: number, msg: string) =>
  z
    .string()
    .transform((v) => enDigits(v).trim())
    .refine((v) => /^\d+$/.test(v) && v.length >= min && v.length <= max, msg);

/** Body for actions that only need a reason (halt, block, reject, cancel …). */
export const reasonSchema = z.object({ reason: zReason }).strict();
export type ReasonInput = z.infer<typeof reasonSchema>;
export const optionalNoteSchema = z.object({ note: optionalText(500) }).strict();

// ═════════════════════════════ Factory (agent D) ═════════════════════════════
export const carrierCreateSchema = z
  .object({
    code: zDigits(1, 10, 'کد باربری باید عددی باشد'),
    name: text(120),
    phone: optionalText(30),
    address: optionalText(300),
    nationalId: optionalText(20),
  })
  .strict();
export const carrierUpdateSchema = carrierCreateSchema
  .omit({ code: true })
  .partial()
  .extend({ status: z.enum(CARRIER_STATUSES).optional() })
  .strict();
export type CarrierCreateInput = z.infer<typeof carrierCreateSchema>;
export type CarrierUpdateInput = z.infer<typeof carrierUpdateSchema>;

export const carrierUserCreateSchema = z
  .object({
    username: z.string().trim().regex(/^[a-z0-9_.]{3,32}$/, 'نام کاربری فقط حروف کوچک لاتین، رقم، _ و . (۳ تا ۳۲)'),
    displayName: text(80),
    password: zPassword,
  })
  .strict();
export const resetPasswordSchema = z.object({ newPassword: zPassword }).strict();
export const userStatusSchema = z.object({ active: z.boolean() }).strict();
export type CarrierUserCreateInput = z.infer<typeof carrierUserCreateSchema>;

export const carrierQuotaUpsertSchema = z
  .object({ yearMonth: zYearMonth, tonnageLimitKg: z.number().int().min(0).max(1e12) })
  .strict();
export type CarrierQuotaUpsertInput = z.infer<typeof carrierQuotaUpsertSchema>;

export const hallCreateSchema = z
  .object({
    title: text(80),
    category: z.enum(HALL_CATEGORIES),
    defaultAllocation: z.enum(ALLOCATIONS),
    terminalName: optionalText(80),
    terminalCity: optionalText(80),
    active: z.boolean().default(true),
  })
  .strict();
export const hallUpdateSchema = hallCreateSchema.partial().strict();
export type HallCreateInput = z.infer<typeof hallCreateSchema>;

const hallTimes = {
  t0: zHHmm,
  priorityEnd: zHHmm.optional(),
  hallEnd: zHHmm,
};
const timesOrdered = (v: { t0: string; priorityEnd?: string; hallEnd: string }) =>
  v.t0 < v.hallEnd && (!v.priorityEnd || (v.t0 < v.priorityEnd && v.priorityEnd <= v.hallEnd));
const TIMES_MSG = { message: 'ترتیب ساعت‌ها باید «شروع < پایان اولویت ≤ پایان سالن» باشد', path: ['hallEnd'] };

/** One weekday row; weekday 0 = Saturday … 6 = Friday (Iranian week). */
export const hallScheduleItemSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    ...hallTimes,
    headMinutes: z.number().int().min(1).max(180).optional(),
    freeMinutes: z.number().int().min(1).max(180).optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine(timesOrdered, TIMES_MSG);
/** PUT /factory/halls/:id/schedules — replaces the whole week (missing weekdays = closed). */
export const hallScheduleReplaceSchema = z
  .object({ items: z.array(hallScheduleItemSchema).max(7) })
  .strict()
  .refine((v) => new Set(v.items.map((i) => i.weekday)).size === v.items.length, {
    message: 'هر روز هفته فقط یک بار',
    path: ['items'],
  });
export type HallScheduleItem = z.infer<typeof hallScheduleItemSchema>;

/** Exception / one-off day. Times are local HH:mm on `date` (BUSINESS_TIMEZONE). */
export const hallDayCreateSchema = z
  .object({ date: zIsoDate, ...hallTimes })
  .strict()
  .refine(timesOrdered, TIMES_MSG);
export const hallDayUpdateSchema = z
  .object({ t0: zHHmm, priorityEnd: zHHmm.optional(), hallEnd: zHHmm, reason: zReason })
  .strict()
  .refine(timesOrdered, TIMES_MSG);
/** Materialise hall_days from the weekly schedule for [from, from+days). Existing days are kept. */
export const hallDayGenerateSchema = z.object({ from: zIsoDate, days: z.number().int().min(1).max(31) }).strict();
export type HallDayCreateInput = z.infer<typeof hallDayCreateSchema>;

export const destinationSchema = z
  .object({ cityId: zCityId, title: text(80), active: z.boolean().default(true), sortOrder: z.number().int().min(0).default(0) })
  .strict();
export const loaderTypeSchema = z
  .object({
    code: z.string().trim().regex(/^[A-Z0-9_]{2,20}$/, 'کد فقط حروف بزرگ لاتین، رقم و _'),
    title: text(60),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict();
export const packagingTypeSchema = z
  .object({ title: text(60), category: z.enum(PACKAGING_CATEGORIES), active: z.boolean().default(true) })
  .strict();
export const productSchema = z.object({ title: text(80), active: z.boolean().default(true) }).strict();

/** POST /factory/policies = new version. `params` is validated per strategy with `policyParamsByStrategy`. */
export const policyCreateSchema = z
  .object({
    hallId: zUuid,
    strategy: z.enum(['TIMED_PRIORITY_RESERVATION', 'BULK_GROUP_ROTATION', 'FREE_FIRST_COME']),
    params: z.record(z.string(), z.unknown()),
    note: optionalText(300),
  })
  .strict();
export type PolicyCreateInput = z.infer<typeof policyCreateSchema>;

/** Factory or carrier blocking a driver. `until` omitted = indefinite. */
export const driverBlockSchema = z.object({ reason: zReason, until: zIsoDate.optional() }).strict();

/** Multipart fields of POST /factory/daily-files (file field name: "file"). */
export const dailyFileMetaSchema = z.object({ carrierId: zUuid, forDate: zIsoDate, note: optionalText(300) }).strict();
export const DAILY_FILE_MAX_BYTES = 10 * 1024 * 1024;

// ═════════════════════════════ Carrier (agent F) ═════════════════════════════
export const driverDecisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), note: optionalText(500) })
  .strict()
  .refine((v) => v.decision === 'APPROVE' || !!v.note, { message: 'علت رد الزامی است', path: ['note'] });
export type DriverDecisionInput = z.infer<typeof driverDecisionSchema>;

const partyAddress = z
  .object({ title: optionalText(60), cityId: zCityId.optional(), postalCode: optionalText(10), address: text(300) })
  .strict();
export const partySchema = z
  .object({
    title: text(80),
    name: text(120),
    nationalId: zDigits(10, 11, 'شناسه ملی باید ۱۰ یا ۱۱ رقم باشد'),
    economicCode: optionalText(20),
    addresses: z.array(partyAddress).max(10).default([]),
  })
  .strict();
export const goodsOwnerSchema = z
  .object({
    name: text(120),
    nationalId: zDigits(10, 11, 'شناسه ملی باید ۱۰ یا ۱۱ رقم باشد'),
    phone: optionalText(30),
    mobile: zMobile.optional(),
    otherInfo: optionalText(500),
  })
  .strict();
export const loadingLocationSchema = z
  .object({
    warehouseType: text(60),
    name: text(120),
    nationalCode: optionalText(20),
    nature: optionalText(60),
    cityId: zCityId.optional(),
    address: optionalText(300),
    phone: optionalText(30),
  })
  .strict();
export const cargoDescriptionSchema = z.object({ text: text(300) }).strict();
export const loadingConditionSchema = z.object({ name: optionalText(80), condition: text(500) }).strict();

/** POST /carrier/permits/:id/{arrive|load|exit|no-show} body (optional note). */
export const permitActionSchema = z.object({ note: optionalText(300) }).strict();
/** POST /carrier/permits/:id/return */
export const permitReturnSchema = reasonSchema;

// ═════════════════════════════ Announcements (agent E) ═════════════════════════════
/** The 7-section form (US-B3, source spec §4.2). */
export const announcementInputSchema = z
  .object({
    // 1. initial
    announceDate: zIsoDate,
    announceTime: zHHmm,
    hallId: zUuid,
    orderCode: optionalText(40),
    contractNo: optionalText(40),
    unloadCode: optionalText(40),
    // 2. sender
    senderPartyId: zUuid.optional(),
    senderName: optionalText(120),
    senderNationalId: zDigits(10, 11, 'شناسه ملی باید ۱۰ یا ۱۱ رقم باشد').optional(),
    originCityId: zCityId.optional(),
    senderPostal: optionalText(10),
    senderAddress: optionalText(300),
    // 3. receiver
    receiverPartyId: zUuid.optional(),
    receiverName: optionalText(120),
    receiverNationalId: zDigits(10, 11, 'شناسه ملی باید ۱۰ یا ۱۱ رقم باشد').optional(),
    destCityId: zCityId.optional(),
    destinationId: zUuid.optional(),
    receiverPostal: optionalText(10),
    receiverAddress: optionalText(300),
    // 4. cargo
    productId: zUuid,
    cargoDescriptionId: zUuid.optional(),
    packagingTypeId: zUuid,
    cargoValue: zMoney,
    cargoCount: z.number().int().min(0).max(1_000_000).optional(),
    // 5. truck & loading place
    loadingLocationId: zUuid,
    warehouseName: optionalText(120),
    loadingDate: zIsoDate.optional(),
    loadingEndDate: zIsoDate.optional(),
    loadingFrom: zHHmm.optional(),
    loadingTo: zHHmm.optional(),
    loadingPlaceText: optionalText(200),
    // 6. weight & fare
    fareCalc: z.enum(FARE_CALCS).default('PER_TRUCK'),
    loaderTypeId: zUuid,
    loaderType2Id: zUuid.optional(),
    truckCount: z.number().int().min(1).max(500),
    loaderLength: z.number().int().min(0).max(30).optional(),
    requestedTruckType: optionalText(60),
    weightFromKg: zKg,
    weightToKg: zKg,
    destFareType: text(40),
    farePerTruck: zMoney.optional(),
    ratePerTon: zMoney.optional(),
    // 7. other
    goodsOwnerId: zUuid.optional(),
    waybillNote: optionalText(300),
    description: text(1000),
    // allocation of the created units (US-B3 / BR-11)
    /** Defaults to the hall's defaultAllocation. Ignored (= FREE) when isFreeOutsideDestinations. */
    allocation: z.enum(ALLOCATIONS).optional(),
    isFreeOutsideDestinations: z.boolean().default(false),
    extra: z
      .object({
        shared: z.boolean().optional(),
        aggregated: z.boolean().optional(),
        native: z.boolean().optional(),
        loadingType: optionalText(60),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .refine((v) => v.weightFromKg <= v.weightToKg, { message: 'وزن «از» باید کمتر یا مساوی وزن «تا» باشد', path: ['weightToKg'] })
  .refine((v) => !v.loadingDate || !v.loadingEndDate || v.loadingDate <= v.loadingEndDate, {
    message: 'تاریخ پایان بارگیری قبل از تاریخ شروع است',
    path: ['loadingEndDate'],
  })
  .refine((v) => (v.fareCalc === 'PER_TON' ? v.ratePerTon !== undefined : v.farePerTruck !== undefined), {
    message: 'کرایه متناسب با روش محاسبه را وارد کنید',
    path: ['farePerTruck'],
  });
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;
export type AnnouncementFormValues = z.input<typeof announcementInputSchema>;

/** PATCH /carrier/announcements/:id/units/:unitId/allocation (BR-10). */
export const unitAllocationChangeSchema = z.object({ to: z.enum(ALLOCATIONS), reason: zReason }).strict();
export type UnitAllocationChangeInput = z.infer<typeof unitAllocationChangeSchema>;
/** Bulk variant on the announcement: change N open units at once. */
export const unitsAllocationBulkSchema = z
  .object({ unitIds: z.array(zUuid).min(1).max(500), to: z.enum(ALLOCATIONS), reason: zReason })
  .strict();

// ═════════════════════════════ Driver (agent G) ═════════════════════════════
/** PATCH /driver/profile — driver-panel spec §4.13.1. Mobile, national id and name are read-only. */
export const driverProfileUpdateSchema = z
  .object({
    licenseNo: text(30),
    licenseIssueDate: zIsoDate,
    birthCityId: zCityId,
    healthCardExpiry: zIsoDate,
    residenceCityId: zCityId.nullable().optional(),
    address: optionalText(300),
    postalCode: zDigits(10, 10, 'کد پستی ۱۰ رقم است').optional(),
    phone: optionalText(30),
    bankName: optionalText(60),
    accountNo: optionalText(30),
    birthDate: zIsoDate.optional(),
    sheba: zSheba.optional(),
  })
  .strict();
export type DriverProfileUpdateInput = z.infer<typeof driverProfileUpdateSchema>;

/** PATCH /driver/profile/vehicle — expiry dates apply immediately. */
export const vehicleUpdateSchema = z.object({ smartCardExpiry: zIsoDate, inspectionExpiry: zIsoDate }).strict();
/**
 * POST /driver/profile/vehicle/change — plate / loader type / smart card need carrier approval (T7).
 * Stored in Vehicle.pendingChange; vehicle.status = PENDING_CHANGE until the carrier decides.
 */
export const vehicleChangeRequestSchema = z
  .object({ plate: zPlate.optional(), loaderTypeId: zUuid.optional(), smartCardNo: text(20).optional() })
  .strict()
  .refine((v) => v.plate || v.loaderTypeId || v.smartCardNo, { message: 'حداقل یک مورد را تغییر دهید' });
/** Shape persisted in Vehicle.pendingChange (plate already normalised). Read by the carrier slice. */
export const vehiclePendingChangeSchema = z
  .object({
    plate: z.string().optional(),
    loaderTypeId: zUuid.optional(),
    smartCardNo: z.string().optional(),
    requestedAt: z.string(),
  })
  .strict();
export type VehiclePendingChange = z.infer<typeof vehiclePendingChangeSchema>;
/** POST /carrier/drivers/:id/vehicle-change {decision} */
export const vehicleChangeDecisionSchema = driverDecisionSchema;

