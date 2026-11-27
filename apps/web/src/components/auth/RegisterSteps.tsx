'use client';
import { useState } from 'react';
import { Controller, type FieldPath, type UseFormReturn } from 'react-hook-form';
import { enDigits } from '@cb/shared';
import {
  Alert,
  Combobox,
  Field,
  FormSection,
  PlateInput,
  Select,
  TextInput,
  fieldDescribedBy,
  type ComboOption,
  JalaliDatePicker,
} from '@cb/ui';
import { fa } from '@/i18n/fa';
import { errorMessage } from '@/lib/api';
import { useCarriers, useCitySearch, useLoaderTypes, type RegisterForm } from './register-data';

type Form = UseFormReturn<RegisterForm>;
const r = fa.register;

/** Read a (possibly nested) field error message. */
function err(form: Form, name: FieldPath<RegisterForm>): string | undefined {
  const state = form.getFieldState(name, form.formState);
  return state.error?.message;
}

function Text({ form, name, label, ltr, type = 'text', autoComplete, inputMode, hint }: {
  form: Form;
  name: FieldPath<RegisterForm>;
  label: string;
  ltr?: boolean;
  type?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'tel';
  hint?: string;
}) {
  const e = err(form, name);
  const id = name.replace(/\./g, '-');
  const digits = inputMode === 'numeric' || inputMode === 'tel';
  return (
    <Field label={label} htmlFor={id} required error={e} hint={hint}>
      <TextInput
        id={id}
        type={type}
        dir={ltr ? 'ltr' : undefined}
        className={ltr ? 'text-end' : undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        invalid={!!e}
        aria-describedby={fieldDescribedBy(id, e, hint)}
        {...form.register(name, digits ? { setValueAs: (v: unknown) => enDigits(String(v ?? '')) } : undefined)}
      />
    </Field>
  );
}

function DateField({ form, name, label }: { form: Form; name: FieldPath<RegisterForm>; label: string }) {
  const e = err(form, name);
  const id = name.replace(/\./g, '-');
  return (
    <Field label={label} htmlFor={id} required error={e}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <JalaliDatePicker
            id={id}
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={field.onChange}
            invalid={!!e}
            aria-describedby={fieldDescribedBy(id, e)}
          />
        )}
      />
    </Field>
  );
}

export function AccountStep({ form }: { form: Form }) {
  return (
    <FormSection title={r.steps[0]}>
      <Text form={form} name="mobile" label={fa.auth.mobile} ltr inputMode="tel" autoComplete="tel" />
      <div className="hidden sm:block" />
      <Text form={form} name="password" label={fa.auth.password} type="password" autoComplete="new-password" hint={r.passwordHint} />
      <Text form={form} name="confirmPassword" label={r.confirmPassword} type="password" autoComplete="new-password" />
    </FormSection>
  );
}

function BirthCityField({ form }: { form: Form }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ComboOption | null>(null);
  const cities = useCitySearch(query);
  const e = err(form, 'birthCityId');
  const options: ComboOption[] = (cities.data ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.province }));
  return (
    <Field label={r.birthCity} htmlFor="birthCityId" required error={e ?? (cities.error ? errorMessage(cities.error) : undefined)}>
      <Combobox
        id="birthCityId"
        query={query}
        onQueryChange={setQuery}
        options={options}
        selected={selected}
        onSelect={(o) => {
          setSelected(o);
          setQuery(o.label);
          form.setValue('birthCityId', Number(o.value), { shouldValidate: true });
        }}
        loading={cities.isFetching}
        placeholder={r.birthCitySearch}
        emptyText={cities.tooShort ? r.birthCityMinChars : r.birthCityNoResult}
        invalid={!!e}
        aria-describedby={fieldDescribedBy('birthCityId', e)}
      />
    </Field>
  );
}

export function ProfileStep({ form }: { form: Form }) {
  return (
    <FormSection title={r.steps[1]}>
      <Text form={form} name="firstName" label={r.firstName} autoComplete="given-name" />
      <Text form={form} name="lastName" label={r.lastName} autoComplete="family-name" />
      <Text form={form} name="nationalId" label={r.nationalId} ltr inputMode="numeric" />
      <Text form={form} name="licenseNo" label={r.licenseNo} ltr inputMode="numeric" />
      <DateField form={form} name="licenseIssueDate" label={r.licenseIssueDate} />
      <BirthCityField form={form} />
      <DateField form={form} name="healthCardExpiry" label={r.healthCardExpiry} />
    </FormSection>
  );
}

export function VehicleStep({ form }: { form: Form }) {
  const loaders = useLoaderTypes();
  const plateErr =
    err(form, 'vehicle.plate') ??
    err(form, 'vehicle.plate.two') ??
    err(form, 'vehicle.plate.letter') ??
    err(form, 'vehicle.plate.three') ??
    err(form, 'vehicle.plate.iran');
  const loaderErr = err(form, 'vehicle.loaderTypeId');
  return (
    <FormSection title={r.steps[2]}>
      <Text form={form} name="vehicle.smartCardNo" label={r.smartCardNo} ltr inputMode="numeric" />
      <Field label={r.plate} htmlFor="vehicle-plate" required error={plateErr ? r.invalidPlate : undefined}>
        <Controller
          control={form.control}
          name="vehicle.plate"
          render={({ field }) => (
            <PlateInput
              id="vehicle-plate"
              value={field.value ?? { two: '', letter: '', three: '', iran: '' }}
              onChange={field.onChange}
              invalid={!!plateErr}
              aria-describedby={fieldDescribedBy('vehicle-plate', plateErr)}
            />
          )}
        />
      </Field>
      <Field
        label={r.loaderType}
        htmlFor="vehicle-loaderTypeId"
        required
        error={loaderErr ?? (loaders.error ? r.listLoadError : undefined)}
      >
        <Controller
          control={form.control}
          name="vehicle.loaderTypeId"
          render={({ field }) => (
            <Select
              id="vehicle-loaderTypeId"
              value={field.value}
              onValueChange={field.onChange}
              disabled={loaders.isLoading}
              invalid={!!loaderErr}
              options={(loaders.data ?? []).map((l) => ({ value: l.id, label: l.title }))}
            />
          )}
        />
      </Field>
      <DateField form={form} name="vehicle.smartCardExpiry" label={r.smartCardExpiry} />
      <DateField form={form} name="vehicle.inspectionExpiry" label={r.inspectionExpiry} />
    </FormSection>
  );
}

export function CarrierStep({ form }: { form: Form }) {
  const carriers = useCarriers();
  const e = err(form, 'carrierId');
  return (
    <FormSection title={r.steps[3]}>
      <Field label={r.carrier} htmlFor="carrierId" required error={e} hint={r.carrierHint} className="sm:col-span-2">
        <Controller
          control={form.control}
          name="carrierId"
          render={({ field }) => (
            <Select
              id="carrierId"
              value={field.value}
              onValueChange={field.onChange}
              disabled={carriers.isLoading}
              invalid={!!e}
              aria-describedby={fieldDescribedBy('carrierId', e, r.carrierHint)}
              options={(carriers.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
        />
      </Field>
      {carriers.error ? (
        <Alert tone="danger" className="sm:col-span-2">
          {r.listLoadError}
        </Alert>
      ) : null}
    </FormSection>
  );
}
