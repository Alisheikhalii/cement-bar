'use client';
import { useState } from 'react';
import { Controller, type FieldPath, type UseFormReturn } from 'react-hook-form';
import type { AnnouncementFormValues, AnnouncementInput } from '@cb/shared';
import { enDigits, faDigits } from '@cb/shared';
import {
  Combobox,
  Field,
  JalaliDatePicker,
  NumberInput,
  Select,
  Switch,
  TextInput,
  Textarea,
  fieldDescribedBy,
  type ComboOption,
  type SelectOption,
} from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { useCitySearch } from '@/components/auth/register-data';

export type AnnForm = UseFormReturn<AnnouncementFormValues, unknown, AnnouncementInput>;
export type AnnPath = FieldPath<AnnouncementFormValues>;

const NONE = '__none';

const label = (name: AnnPath): string => (t.fields as Record<string, string>)[name.replace('extra.', '')] ?? name;
const idOf = (name: AnnPath) => `ann-${name.replace(/\./g, '-')}`;

function errOf(form: AnnForm, name: AnnPath): string | undefined {
  return form.getFieldState(name, form.formState).error?.message;
}

interface BaseProps {
  form: AnnForm;
  name: AnnPath;
  required?: boolean;
  hint?: string;
  className?: string;
  disabled?: boolean;
}

export function TextF({ form, name, required, hint, className, disabled, ltr, digits, multiline }: BaseProps & {
  ltr?: boolean;
  digits?: boolean;
  multiline?: boolean;
}) {
  const e = errOf(form, name);
  const id = idOf(name);
  // Empty → undefined so optional fields (e.g. national id with a digit rule) are simply omitted.
  const reg = form.register(name, {
    setValueAs: (v: unknown) => {
      const s = String(v ?? '');
      const out = digits ? enDigits(s).trim() : s;
      return out === '' ? undefined : out;
    },
  });
  const common = { id, invalid: !!e, disabled, 'aria-describedby': fieldDescribedBy(id, e, hint) };
  return (
    <Field label={label(name)} htmlFor={id} required={required} error={e} hint={hint} className={className}>
      {multiline ? (
        <Textarea {...common} {...reg} />
      ) : (
        <TextInput {...common} {...reg} dir={ltr ? 'ltr' : undefined} className={ltr ? 'text-end' : undefined} inputMode={digits ? 'numeric' : undefined} />
      )}
    </Field>
  );
}

/** Integer input (Persian/Latin digits) stored as number | undefined. */
export function NumberF({ form, name, required, hint, className, disabled }: BaseProps) {
  const e = errOf(form, name);
  const id = idOf(name);
  return (
    <Field label={label(name)} htmlFor={id} required={required} error={e} hint={hint} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <NumberInput
            id={id}
            value={typeof field.value === 'number' ? faDigits(String(field.value)) : ''}
            onValueChange={(v) => field.onChange(v === '' ? undefined : Number(v))}
            onBlur={field.onBlur}
            invalid={!!e}
            disabled={disabled}
            aria-describedby={fieldDescribedBy(id, e, hint)}
          />
        )}
      />
    </Field>
  );
}

export function SelectF({ form, name, required, hint, className, disabled, options, onPicked }: BaseProps & {
  options: SelectOption[];
  onPicked?: (value: string | undefined) => void;
}) {
  const e = errOf(form, name);
  const id = idOf(name);
  const opts = required ? options : [{ value: NONE, label: t.none }, ...options];
  return (
    <Field label={label(name)} htmlFor={id} required={required} error={e} hint={hint} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select
            id={id}
            value={typeof field.value === 'string' && field.value ? field.value : required ? undefined : NONE}
            onValueChange={(v) => {
              const val = v === NONE ? undefined : v;
              field.onChange(val);
              onPicked?.(val);
            }}
            options={opts}
            invalid={!!e}
            disabled={disabled}
            aria-describedby={fieldDescribedBy(id, e, hint)}
          />
        )}
      />
    </Field>
  );
}

export function DateF({ form, name, required, className }: BaseProps) {
  const e = errOf(form, name);
  const id = idOf(name);
  return (
    <Field label={label(name)} htmlFor={id} required={required} error={e} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <JalaliDatePicker
            id={id}
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={(v) => field.onChange(v || undefined)}
            invalid={!!e}
            aria-describedby={fieldDescribedBy(id, e)}
          />
        )}
      />
    </Field>
  );
}

export function TimeF({ form, name, required, className }: BaseProps) {
  const e = errOf(form, name);
  const id = idOf(name);
  return (
    <Field label={label(name)} htmlFor={id} required={required} error={e} className={className}>
      <TextInput
        id={id}
        type="time"
        dir="ltr"
        className="text-end"
        invalid={!!e}
        aria-describedby={fieldDescribedBy(id, e)}
        {...form.register(name, { setValueAs: (v: unknown) => (v ? String(v) : undefined) })}
      />
    </Field>
  );
}

export function SwitchF({ form, name, disabled }: BaseProps) {
  const id = idOf(name);
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Switch id={id} checked={field.value === true} onCheckedChange={field.onChange} label={label(name)} disabled={disabled} />
      )}
    />
  );
}

/** City search (public cities endpoint) stored as numeric id; `initial` is the label of the current id. */
export function CityF({ form, name, initial, className }: BaseProps & { initial?: ComboOption | null }) {
  const e = errOf(form, name);
  const id = idOf(name);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ComboOption | null>(initial ?? null);
  const search = useCitySearch(query);
  const options = (search.data ?? []).map((c) => ({ value: String(c.id), label: c.name, hint: c.province }));
  const current = form.watch(name);
  const selected = picked && picked.value === String(current) ? picked : (initial && initial.value === String(current) ? initial : null);
  return (
    <Field label={label(name)} htmlFor={id} error={e} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Combobox
            id={id}
            query={query}
            onQueryChange={(q) => {
              setQuery(q);
              if (!q) field.onChange(undefined);
            }}
            options={options}
            selected={selected}
            onSelect={(o) => {
              setPicked(o);
              setQuery(o.label);
              field.onChange(Number(o.value));
            }}
            loading={search.isFetching}
            placeholder={t.cityPlaceholder}
            invalid={!!e}
            aria-describedby={fieldDescribedBy(id, e)}
          />
        )}
      />
    </Field>
  );
}
