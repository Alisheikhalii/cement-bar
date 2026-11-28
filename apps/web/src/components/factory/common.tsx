'use client';
import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Alert, Button3D, Field, Modal, Textarea, useToast, type ButtonVariant } from '@cb/ui';
import { faFactory as t } from '@/i18n/factory';
import { errorMessage } from '@/lib/api';

/** Page title + description + primary action(s); wraps on 360px. */
export function FactoryPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-space-lg flex flex-wrap items-end justify-between gap-space-sm">
      <div className="min-w-0">
        <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">{title}</h1>
        {description ? <p className="mt-1 text-body-md text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-space-sm">{actions}</div> : null}
    </div>
  );
}

/**
 * Mutation with standard UX: success toast, error toast with the server's Persian message,
 * and invalidation of the given query keys (prefix match).
 */
export function useFactoryMutation<TVars, TRes>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { invalidate?: QueryKey[]; success?: string; onSuccess?: (r: TRes) => void } = {},
) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.success) toast({ tone: 'success', title: opts.success });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast({ tone: 'danger', title: t.common.failed, description: errorMessage(e) }),
  });
}

/** Confirmation dialog; with `reasonLabel` it also collects a required reason (halt, block …). */
export function ConfirmModal(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  message?: ReactNode;
  reasonLabel?: string;
  reasonOptional?: boolean;
  confirmLabel?: string;
  variant?: ButtonVariant;
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const needReason = !!props.reasonLabel && !props.reasonOptional;
  return (
    <Modal
      open={props.open}
      onOpenChange={(o) => {
        if (!o) setReason('');
        props.onOpenChange(o);
      }}
      title={props.title}
      size="sm"
      footer={
        <>
          <Button3D variant="neutral" onClick={() => props.onOpenChange(false)}>
            {t.common.cancel}
          </Button3D>
          <Button3D
            variant={props.variant ?? 'primary'}
            loading={props.loading}
            disabled={needReason && reason.trim().length === 0}
            onClick={() => props.onConfirm(reason.trim())}
          >
            {props.confirmLabel ?? t.common.confirm}
          </Button3D>
        </>
      }
    >
      <div className="flex flex-col gap-space-md">
        {props.message ? <p className="text-body-md text-text-body">{props.message}</p> : null}
        {props.error ? <Alert tone="danger">{props.error}</Alert> : null}
        {props.children}
        {props.reasonLabel ? (
          <Field label={props.reasonLabel} htmlFor="confirm-reason" required={needReason}>
            <Textarea id="confirm-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

/** Field error text from react-hook-form's nested error objects. */
export function errText(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return undefined;
}
