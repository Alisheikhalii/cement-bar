import { z } from 'zod';
import { enDigits } from './digits';
import { isValidNationalId, normalizeMobile, formatPlate, PLATE_LETTERS } from './validators';
import { ROLES, STRATEGIES } from './enums';

// ───────── primitives ─────────
const trimmed = (max = 200) => z.string().trim().min(1, 'این فیلد الزامی است').max(max);
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const zMobile = z
  .string()
  .transform((v, ctx) => {
    const m = normalizeMobile(v);
    if (!m) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'شماره موبایل معتبر نیست' });
      return z.NEVER;
    }
    return m;
  });

export const zNationalId = z
  .string()
  .transform((v) => enDigits(v).trim())
  .refine(isValidNationalId, 'کد ملی معتبر نیست');

export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
export const zHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت معتبر نیست (HH:mm)');
export const zUuid = z.string().uuid();
export const zPassword = z.string().min(8, 'رمز عبور حداقل ۸ کاراکتر باشد').max(128);

export const zPlate = z
  .object({
    two: z.string(),
    letter: z.enum(PLATE_LETTERS),
    three: z.string(),
    iran: z.string(),
  })
  .strict()
  .transform((p, ctx) => {
    const f = formatPlate(p);
    if (!f) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'پلاک معتبر نیست' });
      return z.NEVER;
    }
    return f;
  });

// ───────── list / pagination ─────────
export const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    sort: z
      .string()
      .regex(/^[a-zA-Z0-9_.]+:(asc|desc)$/)
      .optional(),
    q: z.string().trim().max(100).optional(),
    format: z.enum(['json', 'xlsx']).default('json'),
  })
  .passthrough(); // column filters as f_<column>=value are validated per-resource
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ───────── auth ─────────
export const loginSchema = z
  .object({
    // username for operators, mobile for drivers
    identifier: z.string().trim().min(3).max(64),
    password: z.string().min(1).max(128),
    deviceInfo: z.string().max(200).optional(),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: zPassword })
  .strict();

export const registerDriverSchema = z
  .object({
    mobile: zMobile,
    password: zPassword,
    firstName: trimmed(60),
    lastName: trimmed(60),
    nationalId: zNationalId,
    licenseNo: trimmed(30),
    licenseIssueDate: zIsoDate,
    birthCityId: z.number().int().positive(),
    healthCardExpiry: zIsoDate,
    carrierId: zUuid,
    vehicle: z
      .object({
        smartCardNo: trimmed(20),
        plate: zPlate,
        loaderTypeId: zUuid,
        smartCardExpiry: zIsoDate,
        inspectionExpiry: zIsoDate,
      })
      .strict(),
  })
  .strict();
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;

export interface MeResponse {
  id: string;
  role: (typeof ROLES)[number];
  displayName: string;
  username: string | null;
  mobile: string | null;
  carrier: { id: string; name: string; code: string } | null;
  driver: { id: string; status: string } | null;
  mustChangePassword: boolean;
}

// ───────── policy params (per strategy) ─────────
export const timedPolicyParams = z
  .object({
    maxPriorities: z.number().int().min(1).max(3).default(3),
    requireValidDocuments: z.boolean().default(true),
    cancelPenaltyHours: z.number().int().min(0).max(720).default(24),
    leftoverAfterAllocation: z.enum(['KEEP', 'AUTO_FREE']).default('KEEP'),
  })
  .strict();

export const bulkPolicyParams = z
  .object({
    headMinutes: z.number().int().min(1).max(180).default(10),
    freeMinutes: z.number().int().min(1).max(180).default(5),
    requireValidDocuments: z.boolean().default(true),
    cancelPenaltyHours: z.number().int().min(0).max(720).default(24),
  })
  .strict();

export const freePolicyParams = z
  .object({
    maxActiveFreeReservations: z.number().int().min(1).max(10).default(1),
    requireValidDocuments: z.boolean().default(true),
    cancelPenaltyHours: z.number().int().min(0).max(720).default(24),
  })
  .strict();

/** Carrier-level bulk rotation settings (BulkRotationState.settings). */
export const bulkCarrierSettings = z
  .object({
    maxLoadsPerDriverPerDay: z.number().int().min(1).max(10).default(2),
    leftoverAtHallEnd: z.enum(['CARRY', 'FREE']).default('CARRY'),
  })
  .strict();

export const policyParamsByStrategy = {
  TIMED_PRIORITY_RESERVATION: timedPolicyParams,
  BULK_GROUP_ROTATION: bulkPolicyParams,
  FREE_FIRST_COME: freePolicyParams,
} as const satisfies Record<(typeof STRATEGIES)[number], z.ZodTypeAny>;

export type TimedPolicyParams = z.infer<typeof timedPolicyParams>;
export type BulkPolicyParams = z.infer<typeof bulkPolicyParams>;
export type FreePolicyParams = z.infer<typeof freePolicyParams>;
export type BulkCarrierSettings = z.infer<typeof bulkCarrierSettings>;
