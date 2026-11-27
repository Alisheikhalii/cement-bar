// Static reference data for the seed (Persian names are data, not UI strings).

export const TENANT_NAME = 'سیمان خاکستری نی‌ریز';

export const CARRIERS = [
  { code: '101', name: 'متحده بختگان', username: 'carrier101' },
  { code: '102', name: 'فرید ترابر نصر', username: 'carrier102' },
  { code: '103', name: 'مجید ترابر نی‌ریز', username: 'carrier103' },
] as const;

export const PASSWORDS = {
  factory: 'Factory@1234',
  carrier: 'Carrier@1234',
  driver: 'Driver@1234',
} as const;

/** Province id → name, and city id = province*100 + n (stable ids). */
export const PROVINCES: { id: number; name: string; cities: string[] }[] = [
  {
    id: 17,
    name: 'فارس',
    cities: [
      'نی‌ریز', 'شیراز', 'بوانات', 'آباده طشک', 'اقلید', 'خرامه', 'مرودشت', 'سروستان', 'فسا', 'قطرویه',
      'استهبان', 'داراب', 'آباده', 'جهرم', 'لار', 'کازرون', 'فیروزآباد', 'زرقان', 'صفاشهر', 'ارسنجان',
      'کوار', 'خنج', 'لامرد', 'سپیدان', 'فراشبند',
    ],
  },
  {
    id: 21,
    name: 'کرمان',
    cities: ['کرمان', 'سیرجان', 'شهربابک', 'رفسنجان', 'بافت', 'زرند', 'بم', 'جیرفت', 'انار', 'بردسیر'],
  },
  { id: 31, name: 'یزد', cities: ['یزد', 'مهریز', 'تفت', 'میبد', 'اردکان', 'ابرکوه'] },
];

/** Destinations (title = city name) — must exist in PROVINCES. */
export const DESTINATIONS = [
  'شیراز', 'نی‌ریز', 'سیرجان', 'شهربابک', 'بوانات', 'آباده طشک', 'اقلید', 'خرامه', 'مرودشت', 'فسا', 'کرمان', 'یزد',
];

export const LOADER_TYPES = [
  { code: 'FLATBED', title: 'تریلی کفی' },
  { code: 'SIDED', title: 'تریلی لبه‌دار' },
  { code: 'BUNKER', title: 'بنکر' },
  { code: 'DUMP10', title: 'کمپرسی ۱۰ چرخ' },
  { code: 'DUMP12', title: 'کمپرسی ۱۲ چرخ' },
  { code: 'TRAILER_DUMP', title: 'تریلی کمپرسی' },
] as const;

export const PACKAGING_TYPES = [
  { title: 'کیسه ۵۰ کیلویی', category: 'BAG' },
  { title: 'جامبوبگ', category: 'BAG' },
  { title: 'فله', category: 'BULK' },
] as const;

export const PRODUCTS = ['سیمان تیپ ۲', 'سیمان تیپ ۵', 'سیمان پوزولانی'];

export const HALLS = {
  bag: { title: 'سالن کیسه‌ای', category: 'BAG', defaultAllocation: 'TIMED' },
  bulk: { title: 'سالن فله', category: 'BULK', defaultAllocation: 'GROUP' },
} as const;

/** Iranian week: 0=Saturday … 5=Thursday. */
export const WORKING_WEEKDAYS = [0, 1, 2, 3, 4, 5];

export const BAG_SCHEDULE = { t0: '06:30', priorityEnd: '06:46', hallEnd: '14:00' };
export const BULK_SCHEDULE = { t0: '07:00', hallEnd: '14:00', headMinutes: 10, freeMinutes: 5 };

export const DRIVER_COUNT = 120;
export const PLATE_LETTERS_CYCLE = ['ع', 'ب', 'ج', 'د', 'س', 'ص', 'ط', 'ق', 'ل', 'م', 'ن', 'و', 'ه', 'ی'];
export const FIRST_NAMES = ['علی', 'محمد', 'حسین', 'رضا', 'مهدی', 'احمد', 'حسن', 'جواد', 'مجید', 'سعید', 'امیر', 'کریم'];
export const LAST_NAMES = [
  'احمدی', 'محمدی', 'حسینی', 'رضایی', 'کریمی', 'موسوی', 'جعفری', 'صادقی', 'رحیمی', 'نوری', 'قاسمی', 'زارعی',
];
