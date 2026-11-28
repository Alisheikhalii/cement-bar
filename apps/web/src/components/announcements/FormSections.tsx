'use client';
import {
  ALLOCATION_LABELS_FA,
  FARE_CALC_LABELS_FA,
  FARE_CALCS,
  type AnnouncementLookupsDto,
  type Allocation,
  type LookupParty,
} from '@cb/shared';
import { Field, FormSection, Select, type ComboOption } from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { CityF, DateF, NumberF, SelectF, SwitchF, TextF, TimeF, type AnnForm } from './fields';

export type FormMode = 'create' | 'edit' | 'copy';

export interface SectionProps {
  form: AnnForm;
  lookups: AnnouncementLookupsDto;
  mode: FormMode;
  /** Labels of the current city ids (edit / copy prefill). */
  cityLabels: { origin: ComboOption | null; dest: ComboOption | null };
}

const opt = <T extends { id: string }>(list: T[], label: (x: T) => string) => list.map((x) => ({ value: x.id, label: label(x) }));
const sharedTag = (shared: boolean) => (shared ? ` (${t.shared})` : '');

export function InitialSection({ form, lookups, mode }: SectionProps) {
  const locked = mode === 'edit';
  return (
    <FormSection title={t.sections.initial} tone="primary">
      <DateF form={form} name="announceDate" required />
      <TimeF form={form} name="announceTime" required />
      <SelectF
        form={form}
        name="hallId"
        required
        disabled={locked}
        hint={locked ? t.hallLocked : undefined}
        options={opt(lookups.halls, (h) => h.title)}
        onPicked={() => form.setValue('allocation', undefined)}
      />
      <TextF form={form} name="orderCode" />
      <TextF form={form} name="contractNo" />
      <TextF form={form} name="unloadCode" />
    </FormSection>
  );
}

function fillFromParty(form: AnnForm, side: 'sender' | 'receiver', p: LookupParty | undefined): ComboOption | null {
  if (!p) return null;
  const a = p.addresses[0];
  form.setValue(`${side}Name`, p.name);
  if (p.nationalId) form.setValue(`${side}NationalId`, p.nationalId);
  if (a?.postalCode) form.setValue(`${side}Postal`, a.postalCode);
  if (a?.address) form.setValue(`${side}Address`, a.address);
  if (a?.cityId) {
    form.setValue(side === 'sender' ? 'originCityId' : 'destCityId', a.cityId);
    return { value: String(a.cityId), label: a.cityName ?? String(a.cityId) };
  }
  return null;
}

export function PartySection({ form, lookups, side, cityLabel, onCity }: SectionProps & {
  side: 'sender' | 'receiver';
  cityLabel: ComboOption | null;
  onCity: (c: ComboOption | null) => void;
}) {
  const sender = side === 'sender';
  return (
    <FormSection title={sender ? t.sections.sender : t.sections.receiver} tone={sender ? 'info' : 'purple'}>
      <SelectF
        form={form}
        name={sender ? 'senderPartyId' : 'receiverPartyId'}
        options={opt(lookups.parties, (p) => `${p.title} — ${p.name}`)}
        onPicked={(id) => {
          const c = fillFromParty(form, side, lookups.parties.find((p) => p.id === id));
          if (c) onCity(c);
        }}
      />
      <TextF form={form} name={sender ? 'senderName' : 'receiverName'} />
      <TextF form={form} name={sender ? 'senderNationalId' : 'receiverNationalId'} ltr digits />
      {sender ? null : (
        <SelectF
          form={form}
          name="destinationId"
          options={opt(lookups.destinations, (d) => `${d.title} (${d.cityName})`)}
          onPicked={(id) => {
            const d = lookups.destinations.find((x) => x.id === id);
            if (d) {
              form.setValue('destCityId', d.cityId);
              onCity({ value: String(d.cityId), label: d.cityName });
            }
          }}
        />
      )}
      <CityF key={cityLabel?.value ?? 'none'} form={form} name={sender ? 'originCityId' : 'destCityId'} initial={cityLabel} />
      <TextF form={form} name={sender ? 'senderPostal' : 'receiverPostal'} ltr digits />
      <TextF form={form} name={sender ? 'senderAddress' : 'receiverAddress'} multiline className="sm:col-span-2" />
    </FormSection>
  );
}

export function CargoSection({ form, lookups }: SectionProps) {
  const hall = lookups.halls.find((h) => h.id === form.watch('hallId'));
  const packaging = lookups.packagingTypes.filter((p) => !hall || p.category === hall.category);
  return (
    <FormSection title={t.sections.cargo} tone="success">
      <SelectF form={form} name="productId" required options={opt(lookups.products, (p) => p.title)} />
      <SelectF
        form={form}
        name="cargoDescriptionId"
        options={opt(lookups.cargoDescriptions, (c) => `${c.text}${sharedTag(c.shared)}`)}
      />
      <SelectF form={form} name="packagingTypeId" required options={opt(packaging, (p) => p.title)} />
      <NumberF form={form} name="cargoValue" required />
      <NumberF form={form} name="cargoCount" />
    </FormSection>
  );
}

export function LoadingSection({ form, lookups }: SectionProps) {
  return (
    <FormSection title={t.sections.loading} tone="warning">
      <SelectF
        form={form}
        name="loadingLocationId"
        required
        options={opt(lookups.loadingLocations, (l) => `${l.name}${l.cityName ? ` — ${l.cityName}` : ''}${sharedTag(l.shared)}`)}
        onPicked={(id) => {
          const l = lookups.loadingLocations.find((x) => x.id === id);
          if (l && !form.getValues('warehouseName')) form.setValue('warehouseName', l.name);
        }}
      />
      <TextF form={form} name="warehouseName" />
      <DateF form={form} name="loadingDate" />
      <DateF form={form} name="loadingEndDate" />
      <TimeF form={form} name="loadingFrom" />
      <TimeF form={form} name="loadingTo" />
      <TextF form={form} name="loadingPlaceText" className="sm:col-span-2" />
    </FormSection>
  );
}

function FareCalcRadio({ form }: { form: AnnForm }) {
  const value = form.watch('fareCalc') ?? 'PER_TRUCK';
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <legend className="mb-1.5 text-label-lg text-text-body">{t.fields.fareCalc}</legend>
      <div className="flex flex-wrap gap-space-md">
        {FARE_CALCS.map((f) => (
          <label key={f} className="inline-flex min-h-11 cursor-pointer items-center gap-space-xs text-body-md text-text-body">
            <input
              type="radio"
              name="fareCalc"
              value={f}
              checked={value === f}
              onChange={() => form.setValue('fareCalc', f, { shouldValidate: form.formState.isSubmitted })}
              className="size-4 accent-primary-container"
            />
            {FARE_CALC_LABELS_FA[f]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function WeightSection({ form, lookups }: SectionProps) {
  const loaders = opt(lookups.loaderTypes, (l) => l.title);
  return (
    <FormSection title={t.sections.weight} tone="danger">
      <FareCalcRadio form={form} />
      <SelectF form={form} name="loaderTypeId" required options={loaders} />
      <SelectF form={form} name="loaderType2Id" options={loaders} />
      <NumberF form={form} name="truckCount" required />
      <NumberF form={form} name="loaderLength" />
      <TextF form={form} name="requestedTruckType" />
      <SelectF
        form={form}
        name="destFareType"
        required
        options={t.destFareTypes.map((v) => ({ value: v, label: v }))}
      />
      <NumberF form={form} name="weightFromKg" required />
      <NumberF form={form} name="weightToKg" required />
      <NumberF form={form} name="farePerTruck" required={form.watch('fareCalc') !== 'PER_TON'} />
      <NumberF form={form} name="ratePerTon" required={form.watch('fareCalc') === 'PER_TON'} />
    </FormSection>
  );
}

function allocationOptions(category: string | undefined): Allocation[] {
  if (category === 'BAG') return ['TIMED', 'FREE'];
  if (category === 'BULK') return ['GROUP', 'FREE'];
  return ['FREE'];
}

export function OtherSection({ form, lookups, mode }: SectionProps) {
  const hall = lookups.halls.find((h) => h.id === form.watch('hallId'));
  const locked = mode === 'edit';
  const isFree = form.watch('isFreeOutsideDestinations') === true;
  const allocation = form.watch('allocation') ?? hall?.defaultAllocation;
  return (
    <FormSection title={t.sections.other} tone="neutral">
      <SelectF form={form} name="goodsOwnerId" options={opt(lookups.goodsOwners, (o) => o.name)} />
      <TextF form={form} name="waybillNote" />
      <TextF form={form} name="description" required multiline className="sm:col-span-2" />
      {lookups.loadingConditions.length ? (
        <Field label={t.fields.loadingCondition} htmlFor="ann-condition" className="sm:col-span-2">
          <Select
            id="ann-condition"
            value={undefined}
            onValueChange={(id) => {
              const c = lookups.loadingConditions.find((x) => x.id === id);
              if (!c) return;
              const cur = form.getValues('description') ?? '';
              form.setValue('description', cur ? `${cur}\n${c.condition}` : c.condition, { shouldDirty: true });
            }}
            options={lookups.loadingConditions.map((c) => ({ value: c.id, label: `${c.name ?? c.condition}${sharedTag(c.shared)}` }))}
          />
        </Field>
      ) : null}
      <Field label={t.fields.allocation} htmlFor="ann-allocation" hint={locked ? t.allocationLocked : t.allocationHint}>
        <Select
          id="ann-allocation"
          value={isFree ? 'FREE' : allocation}
          disabled={locked || isFree || !hall}
          onValueChange={(v) => form.setValue('allocation', v as Allocation)}
          options={allocationOptions(hall?.category).map((a) => ({ value: a, label: ALLOCATION_LABELS_FA[a] }))}
        />
      </Field>
      <div className="flex flex-col justify-end">
        <SwitchF form={form} name="isFreeOutsideDestinations" disabled={locked} />
      </div>
      <TextF form={form} name="extra.loadingType" />
      <div className="flex flex-wrap items-end gap-space-md">
        <SwitchF form={form} name="extra.shared" />
        <SwitchF form={form} name="extra.aggregated" />
        <SwitchF form={form} name="extra.native" />
      </div>
    </FormSection>
  );
}
