// Stable API error codes + Persian user messages. API format:
// { "error": { "code": "WINDOW_CLOSED", "message": "...", "details"?: {} } }
export const ERRORS = {
  VALIDATION_FAILED: { status: 400, fa: 'اطلاعات ورودی معتبر نیست' },
  UNAUTHENTICATED: { status: 401, fa: 'لطفاً وارد سامانه شوید' },
  SESSION_REVOKED: { status: 401, fa: 'نشست شما باطل شده است؛ احتمالاً از دستگاه دیگری وارد شده‌اید' },
  INVALID_CREDENTIALS: { status: 401, fa: 'نام کاربری یا رمز عبور اشتباه است' },
  ACCOUNT_LOCKED: { status: 423, fa: 'به دلیل تلاش‌های ناموفق، حساب موقتاً قفل شده است' },
  ACCOUNT_DISABLED: { status: 403, fa: 'حساب کاربری غیرفعال است' },
  FORBIDDEN: { status: 403, fa: 'دسترسی به این بخش مجاز نیست' },
  CSRF_FAILED: { status: 403, fa: 'درخواست نامعتبر است' },
  NOT_FOUND: { status: 404, fa: 'مورد درخواستی یافت نشد' },
  CONFLICT: { status: 409, fa: 'این مورد قبلاً ثبت شده است' },
  RATE_LIMITED: { status: 429, fa: 'تعداد درخواست‌ها زیاد است؛ کمی بعد تلاش کنید' },
  INTERNAL: { status: 500, fa: 'خطای داخلی سامانه' },
  // domain
  DRIVER_NOT_APPROVED: { status: 403, fa: 'حساب راننده هنوز توسط باربری تأیید نشده است' },
  DRIVER_BLOCKED: { status: 403, fa: 'حساب راننده مسدود است' },
  DRIVER_PENALIZED: { status: 403, fa: 'به دلیل لغو مجوز، تا پایان زمان محرومیت امکان نوبت‌گیری ندارید' },
  DOCUMENTS_EXPIRED: { status: 403, fa: 'یکی از مدارک (کارت سلامت، کارت هوشمند یا معاینه فنی) منقضی شده است' },
  LOADER_MISMATCH: { status: 403, fa: 'نوع بارگیر شما با این بار سازگار نیست' },
  WINDOW_CLOSED: { status: 403, fa: 'پنجره رزرو گروه شما باز نیست' },
  NOT_IN_GROUP: { status: 403, fa: 'شما عضو گروه فعالی در این باربری نیستید' },
  HALL_NOT_OPEN: { status: 403, fa: 'سالن اعلام بار هنوز باز نشده یا بسته شده است' },
  HALL_HALTED: { status: 403, fa: 'سالن به صورت اضطراری متوقف شده است' },
  TURN_EXISTS: { status: 409, fa: 'شما امروز نوبت ثبت کرده‌اید' },
  NO_TURN: { status: 403, fa: 'ابتدا باید ثبت نوبت کنید' },
  PRIORITY_WINDOW_CLOSED: { status: 403, fa: 'مهلت انتخاب اولویت‌ها به پایان رسیده است' },
  DAILY_LIMIT_REACHED: { status: 403, fa: 'به سقف تعداد بار مجاز امروز رسیده‌اید' },
  ONE_PER_WINDOW: { status: 403, fa: 'در هر پنجره فقط یک رزرو مجاز است' },
  ACTIVE_FREE_LIMIT: { status: 403, fa: 'یک رزرو آزاد فعال دارید' },
  UNIT_TAKEN: { status: 409, fa: 'این بار همین الان توسط راننده دیگری رزرو شد' },
  NO_UNIT_AVAILABLE: { status: 409, fa: 'بار قابل رزروی باقی نمانده است' },
  QUOTA_EXCEEDED: { status: 403, fa: 'ثبت این اعلام بار از سهمیه ماهانه باربری بیشتر است' },
  CANCEL_PENDING: { status: 409, fa: 'درخواست لغو قبلی در حال بررسی است' },
  INVALID_STATE: { status: 409, fa: 'این عملیات در وضعیت فعلی امکان‌پذیر نیست' },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
