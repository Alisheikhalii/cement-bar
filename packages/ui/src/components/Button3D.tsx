import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'success' | 'danger' | 'warning' | 'neutral' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-container text-on-primary shadow-bevel-primary hover:bg-primary active:shadow-bevel-primary-active',
  success: 'bg-success text-on-primary shadow-bevel-success hover:bg-success-bevel active:shadow-none',
  danger: 'bg-danger text-on-primary shadow-bevel-danger hover:bg-danger-bevel active:shadow-none',
  warning: 'bg-warning text-on-primary shadow-bevel-warning hover:bg-warning-bevel active:shadow-none',
  neutral:
    'bg-surface-container text-primary-container shadow-bevel-neutral hover:bg-surface-container-high active:shadow-none',
  ghost: 'bg-transparent text-primary-container hover:bg-surface-container-low active:translate-y-0',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-label-md gap-1.5',
  md: 'min-h-11 px-5 text-label-lg gap-2',
  lg: 'min-h-12 px-6 text-body-lg font-bold gap-2',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Class builder so links (next/link) can look like 3D buttons without duplicating styles. */
export function button3DClasses({
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    'inline-flex select-none items-center justify-center rounded-xl font-semibold',
    'transition-[transform,box-shadow,background-color] duration-150 ease-out active:translate-y-1',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    variants[variant],
    sizes[size],
    fullWidth && 'w-full',
    className,
  );
}

export interface Button3DProps extends Omit<ComponentPropsWithRef<'button'>, 'children'>, ButtonStyleOptions {
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button3D({
  variant,
  size,
  fullWidth,
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: Button3DProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={button3DClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export interface IconButton3DProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Required accessible name (also shown as native tooltip). */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
}

/** 44px round 3D icon button. */
export function IconButton3D({
  label,
  icon,
  variant = 'neutral',
  className,
  type = 'button',
  ...rest
}: IconButton3DProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(button3DClasses({ variant, size: 'md' }), 'size-11 min-h-11 shrink-0 rounded-full p-0', className)}
      {...rest}
    >
      {icon}
    </button>
  );
}
