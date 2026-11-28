'use client';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { z } from 'zod';
import { changePasswordSchema } from '@cb/shared';
import { Alert, Button3D, Card, Field, FormSection, TextInput, fieldDescribedBy, useToast } from '@cb/ui';
import { faDriver } from '@/i18n/driver';
import { ApiError, api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';

const p = faDriver.password;

const passwordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: p.mismatch });
type Form = z.input<typeof passwordFormSchema>;

/** Uses the existing POST /auth/change-password (other sessions are revoked server-side; this one stays). */
export function PasswordForm() {
  const { toast } = useToast();
  const form = useForm<Form>({
    resolver: zodResolver(passwordFormSchema, { error: faErrorMap }),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: Form) =>
      api.post<void>('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      form.reset();
      toast({ tone: 'success', title: p.done });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS')
        form.setError('currentPassword', { message: e.message });
    },
  });

  const field = (name: FieldPath<Form>, label: string, autoComplete: string, hint?: string) => {
    const e = form.formState.errors[name]?.message;
    const id = `pwd-${name}`;
    return (
      <Field label={label} htmlFor={id} required error={e} hint={hint}>
        <TextInput
          id={id}
          type="password"
          dir="ltr"
          autoComplete={autoComplete}
          invalid={!!e}
          aria-describedby={fieldDescribedBy(id, e, hint)}
          {...form.register(name)}
        />
      </Field>
    );
  };

  return (
    <Card>
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => change.mutate(v))}
        className="flex flex-col gap-space-lg"
      >
        <FormSection title={p.title}>
          {field('currentPassword', p.current, 'current-password')}
          <div className="hidden sm:block" />
          {field('newPassword', p.next, 'new-password', p.hint)}
          {field('confirmPassword', p.confirm, 'new-password')}
        </FormSection>
        {change.error &&
        !(change.error instanceof ApiError && change.error.code === 'INVALID_CREDENTIALS') ? (
          <Alert tone="danger">{errorMessage(change.error)}</Alert>
        ) : null}
        <Button3D
          type="submit"
          variant="danger"
          fullWidth
          loading={change.isPending}
          icon={<KeyRound className="size-4" aria-hidden />}
        >
          {p.submit}
        </Button3D>
      </form>
    </Card>
  );
}
