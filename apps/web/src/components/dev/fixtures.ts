import type { ColumnDef } from '@tanstack/react-table';
import { faNumber } from '@cb/shared';

/** Dev-gallery sample data only (not product UI strings). */
export interface DemoRow {
  id: string;
  driver: string;
  plate: string;
  destination: string;
  weightKg: number;
  status: 'RESERVED' | 'LOADED' | 'CANCELLED';
}

export const DEMO_STATUS: Record<DemoRow['status'], { label: string; tone: 'info' | 'success' | 'danger' }> = {
  RESERVED: { label: 'رزرو شده', tone: 'info' },
  LOADED: { label: 'بارگیری شد', tone: 'success' },
  CANCELLED: { label: 'لغو شد', tone: 'danger' },
};

const NAMES = ['علی رضایی', 'محمد کریمی', 'حسین احمدی', 'رضا محمدی', 'مهدی حسینی', 'جواد موسوی', 'سعید نوری'];
const CITIES = ['شیراز', 'سیرجان', 'آباده', 'فسا', 'بوانات', 'شهربابک'];
const STATUSES: DemoRow['status'][] = ['RESERVED', 'LOADED', 'CANCELLED'];
const BASE_WEIGHT_KG = 24_000;
const WEIGHT_STEP_KG = 500;

export const DEMO_ROWS: DemoRow[] = Array.from({ length: 23 }, (_, i) => ({
  id: `r${i + 1}`,
  driver: NAMES[i % NAMES.length] ?? '',
  plate: `${12 + i}ع${345 + i}-67`,
  destination: CITIES[i % CITIES.length] ?? '',
  weightKg: BASE_WEIGHT_KG + (i % 5) * WEIGHT_STEP_KG,
  status: STATUSES[i % STATUSES.length] ?? 'RESERVED',
}));

export const demoColumns: ColumnDef<DemoRow, unknown>[] = [
  { accessorKey: 'driver', header: 'راننده' },
  { accessorKey: 'plate', header: 'پلاک', meta: { hideOnMobile: false } },
  { accessorKey: 'destination', header: 'مقصد' },
  {
    accessorKey: 'weightKg',
    header: 'وزن (کیلوگرم)',
    cell: (c) => faNumber(c.getValue() as number),
    meta: { hideOnMobile: true },
  },
];
