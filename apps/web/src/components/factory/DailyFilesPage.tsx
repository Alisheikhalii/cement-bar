'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import {
  DAILY_FILE_MAX_BYTES,
  FACTORY_DAILY_FILE_COLUMNS,
  dailyFileMetaSchema,
  localDate,
  type CarrierDto,
  type DailyFileDto,
} from '@cb/shared';
import { Alert, Button3D, Card, Field, FormSection, JalaliDatePicker, Select, TextInput } from '@cb/ui';
import { ServerTable, tableQueryKey } from '@/components/table/ServerTable';
import { faFactory as t } from '@/i18n/factory';
import { api, errorMessage } from '@/lib/api';
import { serverNow } from '@/lib/server-clock';
import { FactoryPageHeader, useFactoryMutation } from './common';

const ENDPOINT = '/factory/daily-files';
type CarrierOption = Pick<CarrierDto, 'id' | 'code' | 'name' | 'status'>;

function UploadForm() {
  const carriers = useQuery({
    queryKey: ['factory', 'carrier-options'],
    queryFn: ({ signal }) => api.get<CarrierOption[]>('/factory/carriers/options', { signal }),
  });
  const [carrierId, setCarrierId] = useState('');
  const [forDate, setForDate] = useState(() => localDate(new Date(serverNow())));
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const m = useFactoryMutation(
    (form: FormData) => api.upload<DailyFileDto>(ENDPOINT, form),
    {
      invalidate: [tableQueryKey(ENDPOINT)],
      success: t.files.uploaded,
      onSuccess: () => {
        setFile(null);
        setNote('');
        if (input.current) input.current.value = '';
      },
    },
  );

  const submit = () => {
    const meta = dailyFileMetaSchema.safeParse({ carrierId, forDate, ...(note.trim() ? { note: note.trim() } : {}) });
    if (!meta.success) return setError(meta.error.issues[0]?.path[0] === 'carrierId' ? t.files.carrier : t.files.forDate);
    if (!file) return setError(t.files.chooseFile);
    if (!file.name.toLowerCase().endsWith('.xlsx')) return setError(t.files.wrongType);
    if (file.size > DAILY_FILE_MAX_BYTES) return setError(t.files.tooLarge);
    setError(null);
    const fd = new FormData();
    fd.set('carrierId', meta.data.carrierId);
    fd.set('forDate', meta.data.forDate);
    if (meta.data.note) fd.set('note', meta.data.note);
    fd.set('file', file);
    m.mutate(fd);
  };

  return (
    <Card>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-space-md"
      >
        <FormSection title={t.files.upload}>
          <Field label={t.files.carrier} htmlFor="df-carrier" required error={carriers.isError ? errorMessage(carriers.error) : undefined}>
            <Select
              id="df-carrier"
              value={carrierId}
              onValueChange={setCarrierId}
              disabled={carriers.isPending}
              options={(carriers.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            />
          </Field>
          <Field label={t.files.forDate} htmlFor="df-date" required>
            <JalaliDatePicker id="df-date" value={forDate} onChange={setForDate} />
          </Field>
          <Field label={t.files.file} htmlFor="df-file" required>
            <input
              ref={input}
              id="df-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full min-w-0 text-body-md text-text-body file:me-space-sm file:min-h-11 file:rounded-xl file:border-0 file:bg-surface-container file:px-space-md file:text-primary-container"
            />
          </Field>
          <Field label={t.common.note} htmlFor="df-note">
            <TextInput id="df-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </FormSection>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex justify-end">
          <Button3D type="submit" icon={<Upload className="size-4" aria-hidden />} loading={m.isPending}>
            {t.files.upload}
          </Button3D>
        </div>
      </form>
    </Card>
  );
}

export function DailyFilesPage() {
  return (
    <div className="flex flex-col gap-space-md">
      <FactoryPageHeader title={t.files.title} description={t.files.description} />
      <UploadForm />
      <ServerTable
        endpoint={ENDPOINT}
        columns={FACTORY_DAILY_FILE_COLUMNS}
        storageKey="factory-daily-files"
        caption={t.files.title}
        rowTone={(r) => (r.seenAt ? 'success' : 'warning')}
      />
    </div>
  );
}
