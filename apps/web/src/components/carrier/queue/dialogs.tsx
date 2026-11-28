'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button3D, Checkbox, Field, Modal, TextInput, Textarea, type ButtonVariant } from '@cb/ui';
import { cq } from '@/i18n/carrier-queue';

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message?: ReactNode;
  /** Reason is mandatory (true) or an optional note (false). */
  required: boolean;
  submitLabel: string;
  variant?: ButtonVariant;
  loading?: boolean;
  /** Membership/order/status changes: offer «اعمال فوری» (reason then required). */
  showApplyNow?: boolean;
  applyNowLabel?: string;
  applyReasonLabel?: string;
  onSubmit: (v: { reason: string; applyNow: boolean }) => void;
}

/** Modal collecting a reason and optionally the apply-now switch for membership/order changes. */
export function ReasonDialog(p: ReasonDialogProps) {
  const [text, setText] = useState('');
  const [applyNow, setApplyNow] = useState(false);

  useEffect(() => {
    if (p.open) {
      setText('');
      setApplyNow(false);
    }
  }, [p.open]);

  const reasonNeeded = p.required || (p.showApplyNow && applyNow);
  const missing = reasonNeeded && !text.trim();

  return (
    <Modal
      open={p.open}
      onOpenChange={p.onOpenChange}
      title={p.title}
      size="sm"
      footer={
        <>
          <Button3D variant="neutral" onClick={() => p.onOpenChange(false)}>
            {cq.common.cancel}
          </Button3D>
          <Button3D
            variant={p.variant ?? 'primary'}
            loading={p.loading}
            disabled={missing}
            onClick={() => p.onSubmit({ reason: text.trim(), applyNow })}
          >
            {p.submitLabel}
          </Button3D>
        </>
      }
    >
      <div className="flex flex-col gap-space-md">
        {p.message ? <p className="text-body-md text-text-body">{p.message}</p> : null}
        {p.showApplyNow ? (
          <Alert tone="info">
            <div className="flex flex-col gap-space-xs">
              <p>{cq.common.tomorrowHint}</p>
              <Checkbox
                id="reason-apply-now"
                checked={applyNow}
                onCheckedChange={setApplyNow}
                label={p.applyNowLabel ?? cq.common.applyNow}
              />
              <p className="text-caption text-text-muted">{cq.common.applyNowHint}</p>
            </div>
          </Alert>
        ) : null}
        <Field
          label={
            p.showApplyNow && applyNow
              ? (p.applyReasonLabel ?? cq.common.reason)
              : p.required
                ? cq.common.reason
                : cq.common.noteOptional
          }
          htmlFor="reason-text"
          required={reasonNeeded}
          hint={reasonNeeded ? cq.common.reasonHint : undefined}
        >
          <Textarea id="reason-text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog(p: ConfirmDialogProps) {
  return (
    <Modal
      open={p.open}
      onOpenChange={p.onOpenChange}
      title={p.title}
      size="sm"
      footer={
        <>
          <Button3D variant="neutral" onClick={() => p.onOpenChange(false)}>
            {cq.common.cancel}
          </Button3D>
          <Button3D variant={p.variant ?? 'primary'} loading={p.loading} onClick={p.onConfirm}>
            {p.confirmLabel ?? cq.common.confirm}
          </Button3D>
        </>
      }
    >
      {p.message ? <p className="text-body-md text-text-body">{p.message}</p> : null}
    </Modal>
  );
}

export interface TextPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  loading?: boolean;
  onSubmit: (value: string) => void;
}

/** Small single-field dialog used for create/rename of bulk groups. */
export function TextPromptDialog(p: TextPromptDialogProps) {
  const [value, setValue] = useState(p.initialValue ?? '');

  useEffect(() => {
    if (p.open) setValue(p.initialValue ?? '');
  }, [p.open, p.initialValue]);

  const empty = !value.trim();
  return (
    <Modal
      open={p.open}
      onOpenChange={p.onOpenChange}
      title={p.title}
      size="sm"
      footer={
        <>
          <Button3D variant="neutral" onClick={() => p.onOpenChange(false)}>
            {cq.common.cancel}
          </Button3D>
          <Button3D loading={p.loading} disabled={empty} onClick={() => p.onSubmit(value.trim())}>
            {p.submitLabel}
          </Button3D>
        </>
      }
    >
      <Field label={p.label} htmlFor="prompt-text" required>
        <TextInput
          id="prompt-text"
          value={value}
          maxLength={80}
          placeholder={p.placeholder}
          invalid={empty}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
