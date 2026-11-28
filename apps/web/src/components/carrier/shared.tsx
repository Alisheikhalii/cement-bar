'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Button3D, Field, JalaliDatePicker, Modal, Textarea } from '@cb/ui';
import { faCarrier } from '@/i18n/carrier';

const c = faCarrier.common;

/** Saves a Blob as a file. Prefers the RFC 5987 `filename*` (Persian names) over the ASCII fallback. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parses `filename*=UTF-8''…` from a Content-Disposition header value. */
export function utf8Filename(disposition: string | null): string | null {
  if (!disposition) return null;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export interface ReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Reason is mandatory (true) or an optional note (false). */
  required: boolean;
  submitLabel: string;
  tone?: 'primary' | 'danger' | 'warning' | 'success';
  loading?: boolean;
  /** Show an optional end-date picker (driver block). */
  withDate?: { label: string; hint?: string };
  onSubmit: (v: { text: string; date: string }) => void;
  children?: ReactNode;
}

/** Small modal collecting a reason / note (and optionally a date) before an operational action. */
export function ReasonModal(p: ReasonModalProps) {
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (p.open) {
      setText('');
      setDate('');
      setTouched(false);
    }
  }, [p.open]);
  const invalid = p.required && touched && !text.trim();
  const submit = () => {
    setTouched(true);
    if (p.required && !text.trim()) return;
    p.onSubmit({ text: text.trim(), date });
  };
  return (
    <Modal
      open={p.open}
      onOpenChange={p.onOpenChange}
      title={p.title}
      size="sm"
      footer={
        <Button3D fullWidth variant={p.tone ?? 'primary'} loading={p.loading} onClick={submit}>
          {p.submitLabel}
        </Button3D>
      }
    >
      <div className="flex flex-col gap-space-md">
        {p.children}
        <Field label={p.required ? c.reason : c.note} htmlFor="reason-text" required={p.required} error={invalid ? c.required : undefined}>
          <Textarea id="reason-text" value={text} invalid={invalid} maxLength={500} onChange={(e) => setText(e.target.value)} />
        </Field>
        {p.withDate ? (
          <Field label={p.withDate.label} htmlFor="reason-date" hint={p.withDate.hint}>
            <JalaliDatePicker id="reason-date" value={date} onChange={setDate} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

/** Label/value pair for read-only detail grids. */
export function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-md text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body-md text-text-primary">{value ?? '—'}</dd>
    </div>
  );
}
