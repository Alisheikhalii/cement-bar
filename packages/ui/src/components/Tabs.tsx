'use client';
import type { ReactNode } from 'react';
import * as RTabs from '@radix-ui/react-tabs';
import { cn } from '../cn';

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  content?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Stretch triggers to equal width (login tabs, mobile). */
  fullWidth?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** 3D segmented control on a tonal track; active segment is raised. */
export function Tabs({ items, value, defaultValue, onValueChange, fullWidth, className, ...aria }: TabsProps) {
  return (
    <RTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      dir="rtl"
      className={cn('flex flex-col gap-space-md', className)}
    >
      <RTabs.List
        className={cn(
          'flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-surface-container p-1 shadow-inner',
          fullWidth ? 'w-full' : 'w-fit',
        )}
        {...aria}
      >
        {items.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className={cn(
              'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-space-md text-label-lg text-text-secondary',
              'transition-[background-color,box-shadow,color] duration-150 hover:text-primary-container',
              'data-[state=active]:bg-surface-card data-[state=active]:text-primary-container data-[state=active]:shadow-bevel-neutral',
              fullWidth && 'flex-1',
            )}
          >
            {t.icon}
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {items.map((t) =>
        t.content !== undefined ? (
          <RTabs.Content key={t.value} value={t.value} className="animate-fade-in focus:outline-none">
            {t.content}
          </RTabs.Content>
        ) : null,
      )}
    </RTabs.Root>
  );
}
