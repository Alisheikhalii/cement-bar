'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { faDigits, faNumber } from '@cb/shared';
import { cn } from '../cn';
import { uiStrings } from '../strings';
import { IconButton3D } from './Button3D';

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  return (
    <nav
      aria-label={uiStrings.pageOf(faDigits(page), faDigits(pages))}
      className={cn('flex flex-wrap items-center justify-between gap-space-sm', className)}
    >
      <span className="text-body-sm text-text-secondary">{uiStrings.totalRows(faNumber(total))}</span>
      <div className="flex items-center gap-space-xs">
        {/* RTL: "previous" points right, "next" points left. */}
        <IconButton3D
          label={uiStrings.prevPage}
          icon={<ChevronRight className="size-5" aria-hidden />}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        />
        <span className="min-w-24 text-center text-label-lg text-text-body" aria-live="polite">
          {uiStrings.pageOf(faDigits(page), faDigits(pages))}
        </span>
        <IconButton3D
          label={uiStrings.nextPage}
          icon={<ChevronLeft className="size-5" aria-hidden />}
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        />
      </div>
    </nav>
  );
}
