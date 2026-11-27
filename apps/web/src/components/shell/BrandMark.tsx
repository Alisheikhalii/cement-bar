import { fa } from '@/i18n/fa';

/** Brand block: local SVG mark + company name + product subtitle. Server-safe. */
export function BrandMark({ inverted = true }: { inverted?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-space-xs">
      <img src="/icon.svg" alt="" width={36} height={36} className="size-9 shrink-0 rounded-xl shadow-elevation-1" />
      <div className="min-w-0 leading-tight">
        <p className={`truncate text-headline-sm ${inverted ? 'text-on-primary' : 'text-text-primary'}`}>{fa.brand.name}</p>
        <p className={`truncate text-caption ${inverted ? 'text-primary-fixed' : 'text-text-secondary'}`}>{fa.brand.subtitle}</p>
      </div>
    </div>
  );
}
