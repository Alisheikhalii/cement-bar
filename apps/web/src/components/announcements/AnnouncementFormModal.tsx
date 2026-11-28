'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Megaphone } from 'lucide-react';
import {
  announcementInputSchema,
  faDigits,
  formatTon,
  type AnnouncementDetailDto,
  type AnnouncementFormValues,
  type AnnouncementInput,
  type AnnouncementLookupsDto,
} from '@cb/shared';
import { Alert, Button3D, Modal, Skeleton, useToast, type ComboOption } from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { api, ApiError, errorMessage } from '@/lib/api';
import { faErrorMap } from '@/lib/zod-fa';
import { ErrorState } from '@/components/StateViews';
import { ANN_ENDPOINT, useInvalidateAnnouncements, useLookups } from './data';
import type { AnnForm, AnnPath } from './fields';
import {
  CargoSection,
  InitialSection,
  LoadingSection,
  OtherSection,
  PartySection,
  WeightSection,
  type FormMode,
} from './FormSections';

const FORM_ID = 'announcement-form';

function defaults(mode: FormMode, lookups: AnnouncementLookupsDto, source?: AnnouncementDetailDto): AnnouncementFormValues {
  if (source && mode !== 'create') {
    return mode === 'copy' ? { ...source.form, announceDate: lookups.today, announceTime: lookups.nowTime } : source.form;
  }
  return {
    announceDate: lookups.today,
    announceTime: lookups.nowTime,
    hallId: lookups.halls[0]?.id ?? '',
    productId: '',
    packagingTypeId: '',
    loadingLocationId: '',
    loaderTypeId: '',
    cargoValue: undefined as unknown as number,
    truckCount: 1,
    weightFromKg: undefined as unknown as number,
    weightToKg: undefined as unknown as number,
    destFareType: t.destFareTypes[0],
    fareCalc: 'PER_TRUCK',
    description: '',
    isFreeOutsideDestinations: false,
    extra: {},
  };
}

/** Maps server VALIDATION_FAILED issues onto form fields; returns true when at least one was placed. */
function applyServerIssues(form: AnnForm, e: unknown): boolean {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_FAILED') return false;
  const issues = (e.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
  for (const i of issues) form.setError(i.path as AnnPath, { type: 'server', message: i.message });
  return issues.length > 0;
}

interface InnerProps {
  mode: FormMode;
  lookups: AnnouncementLookupsDto;
  source?: AnnouncementDetailDto;
  onDone: (a: AnnouncementDetailDto) => void;
  onCancel: () => void;
}

function AnnouncementFormBody({ mode, lookups, source, onDone, onCancel }: InnerProps) {
  const toast = useToast();
  const invalidate = useInvalidateAnnouncements();
  const [serverError, setServerError] = useState<string | null>(null);
  const form: AnnForm = useForm<AnnouncementFormValues, unknown, AnnouncementInput>({
    resolver: zodResolver(announcementInputSchema, { error: faErrorMap }),
    mode: 'onTouched',
    defaultValues: defaults(mode, lookups, source),
  });
  const city = (id: number | undefined, name: string | null | undefined): ComboOption | null =>
    id && name ? { value: String(id), label: name } : null;
  const [origin, setOrigin] = useState(city(source?.form.originCityId, source?.labels.originCity));
  const [dest, setDest] = useState(city(source?.form.destCityId, source?.labels.destCity));

  const submit = form.handleSubmit(async (data) => {
    setServerError(null);
    try {
      const res =
        mode === 'edit'
          ? await api.put<AnnouncementDetailDto>(`${ANN_ENDPOINT}/${source!.id}`, data)
          : mode === 'copy'
            ? await api.post<AnnouncementDetailDto>(`${ANN_ENDPOINT}/${source!.id}/copy`, data)
            : await api.post<AnnouncementDetailDto>(ANN_ENDPOINT, data);
      invalidate();
      toast.toast({ tone: 'success', title: mode === 'edit' ? t.updated : mode === 'copy' ? t.copied : t.saved });
      onDone(res);
    } catch (e) {
      if (!applyServerIssues(form, e)) setServerError(errorMessage(e));
    }
  });

  const truckCount = form.watch('truckCount');
  const weightTo = form.watch('weightToKg');
  const kg = typeof truckCount === 'number' && typeof weightTo === 'number' ? truckCount * weightTo : null;
  const props = { form, lookups, mode, cityLabels: { origin, dest } };

  return (
    <>
      <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-space-lg">
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        {source && mode === 'edit' && !source.editable && source.editBlockedReason ? (
          <Alert tone="warning">{t.details.editBlocked[source.editBlockedReason]}</Alert>
        ) : null}
        <InitialSection {...props} />
        <PartySection {...props} side="sender" cityLabel={origin} onCity={setOrigin} />
        <PartySection {...props} side="receiver" cityLabel={dest} onCity={setDest} />
        <CargoSection {...props} />
        <LoadingSection {...props} />
        <WeightSection {...props} />
        {kg !== null ? <p className="text-body-sm text-text-secondary">{t.quotaHint(formatTon(kg))}</p> : null}
        <OtherSection {...props} />
      </form>
      <div className="sticky bottom-0 -mx-space-lg -mb-space-md mt-space-lg flex flex-wrap justify-end gap-space-sm border-t border-border-subtle bg-surface-card px-space-lg py-space-md">
        <Button3D variant="neutral" type="button" onClick={onCancel}>
          {t.actions.close}
        </Button3D>
        <Button3D type="submit" form={FORM_ID} loading={form.formState.isSubmitting}>
          {mode === 'edit' ? t.actions.saveEdit : mode === 'copy' ? t.actions.saveCopy : t.actions.save}
        </Button3D>
      </div>
    </>
  );
}

export interface AnnouncementFormModalProps {
  open: boolean;
  mode: FormMode;
  source?: AnnouncementDetailDto;
  onOpenChange: (open: boolean) => void;
  onDone?: (a: AnnouncementDetailDto) => void;
}

/** 7-section announcement form (US-B3) for create / edit / copy. */
export function AnnouncementFormModal({ open, mode, source, onOpenChange, onDone }: AnnouncementFormModalProps) {
  const lookups = useLookups(open);
  const n = source ? faDigits(source.number) : '';
  const title = mode === 'edit' ? t.modal.edit(n) : mode === 'copy' ? t.modal.copy(n) : t.modal.create;
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} subtitle={t.modal.subtitle} icon={<Megaphone className="size-5" />} size="xl">
      {lookups.isPending ? (
        <div className="flex flex-col gap-space-md" role="status">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : lookups.isError ? (
        <ErrorState message={errorMessage(lookups.error)} onRetry={() => void lookups.refetch()} />
      ) : (
        <AnnouncementFormBody
          key={`${mode}:${source?.id ?? 'new'}`}
          mode={mode}
          lookups={lookups.data}
          source={source}
          onCancel={() => onOpenChange(false)}
          onDone={(a) => {
            onOpenChange(false);
            onDone?.(a);
          }}
        />
      )}
    </Modal>
  );
}
