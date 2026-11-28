'use client';
import { useState } from 'react';
import { Controller, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Save } from 'lucide-react';
import type { z } from 'zod';
import { driverProfileUpdateSchema, enDigits, faDigits, type DriverProfileDto } from '@cb/shared';
import {
  Alert,
  Button3D,
  Card,
  Field,
  FormSection,
  JalaliDatePicker,
  TextInput,
  fieldDescribedBy,
  useToast,
} from '@cb/ui';
import { faDriver } from '@/i18n/driver';
import { ApiError, api, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { CityPicker } from './CityPicker';
import { errorField } from './format';
import { driverKeys } from './queries';

const p = faDriver.profile;
type Form = z.input<typeof driverProfileUpdateSchema>;
type Name = FieldPath<Form>;

const emptyToUndef = (v: unknown) => {
  const s = enDigits(String(v ?? '')).trim();
  return s === '' ? undefined : s;
};

function defaults(d: DriverProfileDto): Form {
  return {
    licenseNo: d.licenseNo,
    licenseIssueDate: d.licenseIssueDate,
    birthCityId: d.birthCity?.id as number,
    healthCardExpiry: d.healthCardExpiry,
    residenceCityId: d.residenceCity?.id,
    address: d.address ?? '',
    postalCode: d.postalCode ?? undefined,
    phone: d.phone ?? '',
    bankName: d.bankName ?? '',
    accountNo: d.accountNo ?? '',
    birthDate: d.birthDate ?? undefined,
    sheba: d.sheba ?? undefined,
  };
}

function ReadOnly({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-md text-text-secondary">{label}</span>
      <span
        className="flex min-h-11 items-center gap-space-xs rounded-xl bg-surface-container-low px-space-sm text-body-md text-text-primary"
        dir={ltr ? 'ltr' : undefined}
      >
        <Lock className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className={ltr ? 'flex-1 text-end' : undefined}>{value}</span>
      </span>
    </div>
  );
}

export function DriverInfoForm({ profile }: { profile: DriverProfileDto }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(driverProfileUpdateSchema, { error: faErrorMap }, { raw: true }),
    mode: 'onTouched',
    defaultValues: defaults(profile),
  });
  const err = (n: Name) => form.getFieldState(n, form.formState).error?.message;

  const save = useMutation({
    mutationFn: (body: Form) => api.patch<DriverProfileDto>('/driver/profile', body),
    onSuccess: (data) => {
      qc.setQueryData(driverKeys.profile, data);
      void qc.invalidateQueries({ queryKey: driverKeys.dashboard });
      form.reset(defaults(data));
      toast({ tone: 'success', title: p.saved });
    },
    onError: (e) => {
      const f = e instanceof ApiError ? errorField(e.details) : undefined;
      if (f && f in form.getValues()) form.setError(f as Name, { message: e.message });
      setServerError(errorMessage(e));
    },
  });

  const text = (
    name: Name,
    label: string,
    o: { ltr?: boolean; numeric?: boolean; optional?: boolean; hint?: string } = {},
  ) => {
    const e = err(name);
    const id = `prof-${name}`;
    return (
      <Field label={label} htmlFor={id} required={!o.optional} error={e} hint={o.hint}>
        <TextInput
          id={id}
          dir={o.ltr ? 'ltr' : undefined}
          className={o.ltr ? 'text-end' : undefined}
          inputMode={o.numeric ? 'numeric' : undefined}
          invalid={!!e}
          aria-describedby={fieldDescribedBy(id, e, o.hint)}
          {...form.register(
            name,
            o.numeric || o.ltr
              ? { setValueAs: o.optional ? emptyToUndef : (v: unknown) => enDigits(String(v ?? '')) }
              : undefined,
          )}
        />
      </Field>
    );
  };

  const date = (
    name: 'licenseIssueDate' | 'healthCardExpiry' | 'birthDate',
    label: string,
    optional = false,
    hint?: string,
  ) => {
    const e = err(name);
    const id = `prof-${name}`;
    return (
      <Field label={label} htmlFor={id} required={!optional} error={e} hint={hint}>
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <JalaliDatePicker
              id={id}
              value={field.value ?? ''}
              onChange={(iso) => field.onChange(optional && !iso ? undefined : iso)}
              invalid={!!e}
              aria-describedby={fieldDescribedBy(id, e, hint)}
            />
          )}
        />
      </Field>
    );
  };

  const city = (name: 'birthCityId' | 'residenceCityId', label: string, optional: boolean) => {
    const e = err(name);
    const id = `prof-${name}`;
    const initial = name === 'birthCityId' ? profile.birthCity : profile.residenceCity;
    return (
      <Field label={label} htmlFor={id} required={!optional} error={e}>
        <CityPicker
          id={id}
          initial={initial}
          onSelect={(cityId) => form.setValue(name, cityId, { shouldValidate: true, shouldDirty: true })}
          invalid={!!e}
          aria-describedby={fieldDescribedBy(id, e)}
        />
      </Field>
    );
  };

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((v) => {
        setServerError(null);
        save.mutate(v);
      })}
      className="flex flex-col gap-space-lg"
    >
      <Card className="flex flex-col gap-space-md">
        <FormSection title={p.identityTitle} description={p.identityHint} tone="neutral">
          <ReadOnly label={p.fullName} value={`${profile.firstName} ${profile.lastName}`} />
          <ReadOnly label={p.mobile} value={faDigits(profile.mobile ?? '')} ltr />
          <ReadOnly label={p.nationalId} value={faDigits(profile.nationalId)} ltr />
        </FormSection>
      </Card>

      <Card className="flex flex-col gap-space-lg">
        <FormSection title={p.licenseTitle} description={p.expiryHint}>
          {text('licenseNo', p.licenseNo, { ltr: true })}
          {date('licenseIssueDate', p.licenseIssueDate)}
          {date('healthCardExpiry', p.healthCardExpiry)}
          {city('birthCityId', p.birthCity, false)}
        </FormSection>

        <FormSection title={p.personalTitle} description={p.optionalNote} tone="info">
          {date('birthDate', p.birthDate, true)}
          {city('residenceCityId', p.residenceCity, true)}
          {text('address', p.address, { optional: true })}
          {text('postalCode', p.postalCode, { optional: true, numeric: true, ltr: true })}
          {text('phone', p.phone, { optional: true, ltr: true })}
        </FormSection>

        <FormSection title={p.bankTitle} tone="purple">
          {text('bankName', p.bankName, { optional: true })}
          {text('accountNo', p.accountNo, { optional: true, ltr: true })}
          {text('sheba', p.sheba, { optional: true, ltr: true, hint: p.shebaHint })}
        </FormSection>

        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

        <Button3D
          type="submit"
          fullWidth
          loading={save.isPending}
          icon={<Save className="size-4" aria-hidden />}
        >
          {p.save}
        </Button3D>
      </Card>
    </form>
  );
}
