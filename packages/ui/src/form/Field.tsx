import type { ReactNode } from 'react';
import { cn } from '../cn';
import { toneBg, type Tone } from '../tokens';

export interface FormSectionProps {
  title: string;
  description?: string;
  tone?: Tone;
  className?: string;
  children: ReactNode;
}

/** Form block with coloured dot title (as in the design HTMLs' modal forms). */
export function FormSection({ title, description, tone = 'primary', className, children }: FormSectionProps) {
  return (
    <section className={cn('flex flex-col gap-space-md', className)}>
      <div>
        <h3 className="flex items-center gap-space-xs text-headline-sm text-text-primary">
          <span aria-hidden className={cn('size-2.5 rounded-full', toneBg[tone])} />
          {title}
        </h3>
        {description ? <p className="mt-1 text-body-sm text-text-secondary">{description}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">{children}</div>
    </section>
  );
}

export interface FieldProps {
  label: string;
  /** id of the control, wires label/aria-describedby. */
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function fieldDescribedBy(id: string, error?: string, hint?: string): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-label-lg text-text-body">
        {label}
        {required ? (
          <span className="ms-1 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-label-md text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
