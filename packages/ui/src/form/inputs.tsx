'use client';
import type { ChangeEvent, ComponentPropsWithRef } from 'react';
import { cn } from '../cn';
import { normalizeNumeric } from '../helpers/plate';

/** Shared control look: tonal field that lifts on focus. */
export const controlClasses = cn(
  'block min-h-11 w-full min-w-0 rounded-xl border border-border-subtle bg-surface-container-low px-space-sm',
  'text-body-md text-text-primary placeholder:text-text-muted transition-[background-color,box-shadow]',
  'focus:border-primary-container focus:bg-surface-card focus:shadow-elevation-1 focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-surface',
);

export interface TextInputProps extends ComponentPropsWithRef<'input'> {
  invalid?: boolean;
}

export function TextInput({ invalid, className, ...rest }: TextInputProps) {
  return <input aria-invalid={invalid || undefined} className={cn(controlClasses, className)} {...rest} />;
}

export interface NumberInputProps extends Omit<ComponentPropsWithRef<'input'>, 'onChange' | 'value' | 'type'> {
  value: string;
  /** Receives the normalized Latin-digit string. */
  onValueChange: (value: string) => void;
  allowDecimal?: boolean;
  invalid?: boolean;
}

/** Accepts Persian, Arabic and Latin digits; emits normalized Latin digits. */
export function NumberInput({
  value,
  onValueChange,
  allowDecimal,
  invalid,
  className,
  ...rest
}: NumberInputProps) {
  return (
    <input
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      dir="ltr"
      autoComplete="off"
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onValueChange(normalizeNumeric(e.target.value, allowDecimal))}
      className={cn(controlClasses, 'text-end tabular-nums', className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlClasses, 'py-space-xs leading-6', className)}
      {...rest}
    />
  );
}
