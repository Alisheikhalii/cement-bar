'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { reasonSchema, type ReasonInput } from '@cb/shared';
import { Alert, Button3D, Field, Modal, Textarea, fieldDescribedBy } from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';

export interface ReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  confirmLabel: string;
  danger?: boolean;
  /** Throws on failure; the modal shows the Persian error. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Small modal that collects a mandatory reason (cancel announcement, change unit allocation). */
export function ReasonModal({ open, onOpenChange, title, description, label, confirmLabel, danger, onConfirm }: ReasonModalProps) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ReasonInput>({ resolver: zodResolver(reasonSchema, { error: faErrorMap }), defaultValues: { reason: '' } });
  const e = form.formState.errors.reason?.message;
  const submit = form.handleSubmit(async ({ reason }) => {
    setError(null);
    try {
      await onConfirm(reason);
      form.reset();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset();
          setError(null);
        }
        onOpenChange(o);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button3D variant="neutral" type="button" onClick={() => onOpenChange(false)}>
            {t.actions.close}
          </Button3D>
          <Button3D variant={danger ? 'danger' : 'primary'} type="submit" form="reason-form" loading={form.formState.isSubmitting}>
            {confirmLabel}
          </Button3D>
        </>
      }
    >
      <form id="reason-form" noValidate onSubmit={(ev) => void submit(ev)} className="flex flex-col gap-space-md">
        {description ? <p className="text-body-md text-text-secondary">{description}</p> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={label} htmlFor="reason" required error={e}>
          <Textarea id="reason" invalid={!!e} aria-describedby={fieldDescribedBy('reason', e)} {...form.register('reason')} />
        </Field>
      </form>
    </Modal>
  );
}
