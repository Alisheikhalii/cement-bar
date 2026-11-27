'use client';
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Hidden visually but announced; the drawer body provides its own heading if needed. */
  children: ReactNode;
  className?: string;
}

/** Side sheet entering from the inline-start edge (right in RTL) over a blurred backdrop. */
export function Drawer({ open, onOpenChange, title, children, className }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-inverse-surface/40 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] animate-fade-in flex-col bg-surface-card shadow-elevation-4 focus:outline-none',
            className,
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <Dialog.Close
            aria-label={uiStrings.close}
            className="absolute end-2 top-2 z-10 flex size-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-container-low"
          >
            <X className="size-5" aria-hidden />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

export interface MenuProps {
  trigger: ReactNode;
  /** Accessible name of the trigger. */
  label: string;
  header?: ReactNode;
  items: MenuItem[];
  triggerClassName?: string;
}

export function Menu({ trigger, label, header, items, triggerClassName }: MenuProps) {
  return (
    <Dropdown.Root dir="rtl">
      <Dropdown.Trigger aria-label={label} className={triggerClassName}>
        {trigger}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 animate-fade-in rounded-2xl bg-surface-card p-1.5 shadow-elevation-3"
        >
          {header ? <div className="border-b border-border-subtle px-space-sm pb-space-xs pt-1">{header}</div> : null}
          {items.map((it) => (
            <Dropdown.Item
              key={it.key}
              onSelect={it.onSelect}
              className={cn(
                'flex min-h-11 cursor-pointer select-none items-center gap-space-xs rounded-xl px-space-sm text-body-md outline-none data-[highlighted]:bg-surface-container-low',
                it.danger ? 'text-danger' : 'text-text-primary',
              )}
            >
              {it.icon}
              {it.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export interface PopoverPanelProps {
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  triggerClassName?: string;
  className?: string;
}

export function PopoverPanel({ trigger, label, children, triggerClassName, className }: PopoverPanelProps) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={label} title={label} className={triggerClassName}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className={cn('z-50 w-72 max-w-[90vw] animate-fade-in rounded-2xl bg-surface-card p-space-md shadow-elevation-3', className)}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
