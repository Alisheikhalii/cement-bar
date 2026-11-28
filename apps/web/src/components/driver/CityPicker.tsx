'use client';
import { useState } from 'react';
import { Combobox, type ComboOption } from '@cb/ui';
import type { DriverCityRef } from '@cb/shared';
import { useCitySearch } from '@/components/auth/register-data';
import { faDriver } from '@/i18n/driver';

const p = faDriver.profile;

export interface CityPickerProps {
  id: string;
  initial: DriverCityRef | null;
  onSelect: (cityId: number) => void;
  invalid?: boolean;
  'aria-describedby'?: string;
}

/** Searchable city select backed by the public city lookup (same as sign-up). */
export function CityPicker({ id, initial, onSelect, invalid, ...aria }: CityPickerProps) {
  const initialOption = initial
    ? { value: String(initial.id), label: initial.name, hint: initial.province }
    : null;
  const [query, setQuery] = useState(initial?.name ?? '');
  const [selected, setSelected] = useState<ComboOption | null>(initialOption);
  const cities = useCitySearch(query);
  const options: ComboOption[] = (cities.data ?? []).map((c) => ({
    value: String(c.id),
    label: c.name,
    hint: c.province,
  }));
  return (
    <Combobox
      id={id}
      query={query}
      onQueryChange={setQuery}
      options={options}
      selected={selected}
      onSelect={(o) => {
        setSelected(o);
        setQuery(o.label);
        onSelect(Number(o.value));
      }}
      loading={cities.isFetching}
      placeholder={p.citySearch}
      emptyText={cities.tooShort ? p.cityMinChars : p.cityNoResult}
      invalid={invalid}
      aria-describedby={aria['aria-describedby']}
    />
  );
}
