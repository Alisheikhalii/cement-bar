'use client';
import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const widths: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  size?: ModalSize;
  /** Sticky footer, typically the primary 3D action. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ open, onOpenChange, title, subtitle, icon, size = 'md', footer, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-inverse-surface/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-3 top-1/2 z-50 mx-auto flex max-h-[90dvh] -translate-y-1/2 flex-col overflow-hidden',
            'rounded-3xl bg-surface-card shadow-elevation-4 focus:outline-none',
            widths[size],
          )}
        >
          <div className="animate-modal-enter flex min-h-0 flex-1 flex-col">
            <header className="flex items-start gap-space-sm bg-gradient-to-l from-primary-container to-tertiary-container px-space-lg py-space-md text-on-primary">
              {icon ? (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-on-primary/15" aria-hidden>
                  {icon}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-headline-md">{title}</Dialog.Title>
                {subtitle ? (
                  <Dialog.Description className="text-body-sm text-primary-fixed">{subtitle}</Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              <Dialog.Close
                className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-on-primary/15"
                aria-label={uiStrings.close}
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-space-lg py-space-md">{children}</div>
            {footer ? (
              <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-space-sm border-t border-border-subtle bg-surface-card px-space-lg py-space-md pb-[max(theme(spacing.space-md),env(safe-area-inset-bottom))]">
                {footer}
              </footer>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
