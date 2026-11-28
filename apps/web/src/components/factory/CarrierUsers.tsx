'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Plus, UserRound } from 'lucide-react';
import {
  carrierUserCreateSchema,
  formatDateTimeFa,
  resetPasswordSchema,
  type CarrierUserCreateInput,
  type CarrierUserDto,
} from '@cb/shared';
import { Badge, Button3D, Card, EmptyState, Field, Modal, Switch, TextInput } from '@cb/ui';
import { faFactory as t } from '@/i18n/factory';
import { api } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { useFactoryMutation } from './common';

const usersPath = (carrierId: string) => `/factory/carriers/${carrierId}/users`;
const detailKey = (carrierId: string) => ['factory', 'carrier', carrierId];

function CreateUserModal({ carrierId, open, onOpenChange }: { carrierId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<CarrierUserCreateInput>({
    resolver: zodResolver(carrierUserCreateSchema, { error: faErrorMap }),
    defaultValues: { username: '', displayName: '', password: '' },
  });
  const m = useFactoryMutation((v: CarrierUserCreateInput) => api.post<CarrierUserDto>(usersPath(carrierId), v), {
    invalidate: [detailKey(carrierId)],
    success: t.common.created,
    onSuccess: () => {
      form.reset();
      onOpenChange(false);
    },
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t.users.add}
      size="sm"
      footer={
        <>
          <Button3D variant="neutral" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button3D>
          <Button3D type="submit" form="user-create" loading={m.isPending}>
            {t.common.create}
          </Button3D>
        </>
      }
    >
      <form id="user-create" noValidate className="flex flex-col gap-space-md" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label={t.users.username} htmlFor="u-username" required error={e.username?.message} hint={t.users.usernameHint}>
          <TextInput id="u-username" dir="ltr" autoComplete="off" invalid={!!e.username} {...form.register('username')} />
        </Field>
        <Field label={t.users.displayName} htmlFor="u-display" required error={e.displayName?.message}>
          <TextInput id="u-display" invalid={!!e.displayName} {...form.register('displayName')} />
        </Field>
        <Field label={t.users.password} htmlFor="u-password" required error={e.password?.message} hint={t.users.passwordHint}>
          <TextInput id="u-password" type="password" dir="ltr" autoComplete="new-password" invalid={!!e.password} {...form.register('password')} />
        </Field>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ carrierId, user, onClose }: { carrierId: string; user: CarrierUserDto | null; onClose: () => void }) {
  const form = useForm<{ newPassword: string }>({
    resolver: zodResolver(resetPasswordSchema, { error: faErrorMap }),
    defaultValues: { newPassword: '' },
  });
  const m = useFactoryMutation(
    (v: { newPassword: string }) => api.post<void>(`${usersPath(carrierId)}/${user!.id}/reset-password`, v),
    { invalidate: [detailKey(carrierId)], success: t.users.resetDone, onSuccess: () => { form.reset(); onClose(); } },
  );
  const err = form.formState.errors.newPassword?.message;
  return (
    <Modal
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      title={t.users.resetPassword}
      subtitle={user?.displayName}
      size="sm"
      footer={
        <Button3D type="submit" form="user-reset" variant="warning" loading={m.isPending}>
          {t.users.resetPassword}
        </Button3D>
      }
    >
      <form id="user-reset" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label={t.users.newPassword} htmlFor="u-new" required error={err} hint={t.users.passwordHint}>
          <TextInput id="u-new" type="password" dir="ltr" autoComplete="new-password" invalid={!!err} {...form.register('newPassword')} />
        </Field>
      </form>
    </Modal>
  );
}

export function CarrierUsers({ carrierId, users }: { carrierId: string; users: CarrierUserDto[] }) {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<CarrierUserDto | null>(null);
  const toggle = useFactoryMutation(
    (v: { id: string; active: boolean }) => api.patch<CarrierUserDto>(`${usersPath(carrierId)}/${v.id}/status`, { active: v.active }),
    { invalidate: [detailKey(carrierId)], success: t.common.saved },
  );
  return (
    <Card className="flex flex-col gap-space-md">
      <div className="flex justify-end">
        <Button3D size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
          {t.users.add}
        </Button3D>
      </div>
      {users.length === 0 ? (
        <EmptyState icon={<UserRound className="size-7" />} title={t.users.empty} />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-space-sm py-space-sm">
              <div className="min-w-0">
                <p className="text-headline-sm text-text-primary">{u.displayName}</p>
                <p className="text-body-sm text-text-secondary">
                  <span dir="ltr">{u.username}</span>
                  {' · '}
                  {t.users.lastLogin}: {u.lastLoginAt ? formatDateTimeFa(u.lastLoginAt) : t.common.none}
                </p>
                {u.mustChangePassword ? <Badge tone="warning" className="mt-1">{t.users.mustChange}</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-space-sm">
                <Switch
                  id={`active-${u.id}`}
                  checked={u.active}
                  disabled={toggle.isPending}
                  onCheckedChange={(active) => toggle.mutate({ id: u.id, active })}
                  label={u.active ? t.common.active : t.common.inactive}
                />
                <Button3D size="sm" variant="neutral" icon={<KeyRound className="size-4" aria-hidden />} onClick={() => setResetting(u)}>
                  {t.users.resetPassword}
                </Button3D>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CreateUserModal carrierId={carrierId} open={creating} onOpenChange={setCreating} />
      <ResetPasswordModal carrierId={carrierId} user={resetting} onClose={() => setResetting(null)} />
    </Card>
  );
}
