'use client';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Clock, Send, Truck, Undo2 } from 'lucide-react';
import type { z } from 'zod';
import {
  VEHICLE_STATUS_LABELS_FA,
  enDigits,
  faDigits,
  formatDateTimeFa,
  vehicleUpdateSchema,
  type DriverVehicleDto,
  type PlateParts,
} from '@cb/shared';
import {
  Alert,
  Badge,
  Button3D,
  Card,
  Field,
  FormSection,
  JalaliDatePicker,
  Modal,
  PlateInput,
  Select,
  TextInput,
  fieldDescribedBy,
  useToast,
} from '@cb/ui';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { useLoaderTypes } from '@/components/auth/register-data';
import { fa } from '@/i18n/fa';
import { faDriver } from '@/i18n/driver';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { faErrorMap } from '@/lib/zod-fa';
import { plateFa } from './format';
import { driverKeys, useDriverVehicle } from './queries';

const v = faDriver.vehicle;
type ExpiryForm = z.input<typeof vehicleUpdateSchema>;

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-container-low p-space-sm">
      <span className="text-label-md text-text-secondary">{label}</span>
      <span className="text-body-lg text-text-primary">{children}</span>
    </div>
  );
}

function ExpiryForm({ vehicle }: { vehicle: DriverVehicleDto }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useForm<ExpiryForm>({
    resolver: zodResolver(vehicleUpdateSchema, { error: faErrorMap }),
    defaultValues: { smartCardExpiry: vehicle.smartCardExpiry, inspectionExpiry: vehicle.inspectionExpiry },
  });
  const save = useMutation({
    mutationFn: (body: ExpiryForm) => api.patch<DriverVehicleDto>('/driver/profile/vehicle', body),
    onSuccess: (data) => {
      qc.setQueryData(driverKeys.vehicle, data);
      void qc.invalidateQueries({ queryKey: driverKeys.dashboard });
      form.reset({ smartCardExpiry: data.smartCardExpiry, inspectionExpiry: data.inspectionExpiry });
      toast({ tone: 'success', title: v.savedExpiry });
    },
  });
  const dateField = (name: keyof ExpiryForm, label: string) => {
    const e = form.formState.errors[name]?.message;
    const id = `veh-${name}`;
    return (
      <Field label={label} htmlFor={id} required error={e}>
        <Controller
          control={form.control}
          name={name}
          render={({ field }) => (
            <JalaliDatePicker
              id={id}
              value={field.value}
              onChange={field.onChange}
              invalid={!!e}
              aria-describedby={fieldDescribedBy(id, e)}
            />
          )}
        />
      </Field>
    );
  };
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((b) => save.mutate(b))}
      className="flex flex-col gap-space-md"
    >
      <FormSection title={v.expiryTitle} description={faDriver.profile.expiryHint}>
        {dateField('smartCardExpiry', v.smartCardExpiry)}
        {dateField('inspectionExpiry', v.inspectionExpiry)}
      </FormSection>
      {save.error ? <Alert tone="danger">{errorMessage(save.error)}</Alert> : null}
      <Button3D
        type="submit"
        variant="neutral"
        loading={save.isPending}
        icon={<CalendarCheck className="size-4" aria-hidden />}
      >
        {v.saveExpiry}
      </Button3D>
    </form>
  );
}

const EMPTY_PLATE = { two: '', letter: '', three: '', iran: '' } as PlateParts;

function ChangeModal({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vehicle: DriverVehicleDto;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const loaders = useLoaderTypes();
  const [plate, setPlate] = useState<PlateParts>(EMPTY_PLATE);
  const [loaderTypeId, setLoaderTypeId] = useState('');
  const [smartCardNo, setSmartCardNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const plateTouched = plate.two !== '' || plate.three !== '' || plate.iran !== '' || plate.letter !== '';

  const submit = useMutation({
    mutationFn: (body: object) => api.post<DriverVehicleDto>('/driver/profile/vehicle/change', body),
    onSuccess: (data) => {
      qc.setQueryData(driverKeys.vehicle, data);
      void qc.invalidateQueries({ queryKey: driverKeys.dashboard });
      toast({ tone: 'success', title: v.changeSent });
      onOpenChange(false);
    },
    onError: (e) => {
      const field =
        e instanceof ApiError && typeof e.details === 'object' && e.details
          ? (e.details as { field?: string }).field
          : undefined;
      const label = field === 'plate' ? v.newPlate : field === 'smartCardNo' ? v.newSmartCardNo : null;
      setError(label ? `${label}: ${errorMessage(e)}` : errorMessage(e));
    },
  });

  const send = () => {
    setError(null);
    const body: Record<string, unknown> = {};
    if (plateTouched) body.plate = plate;
    if (loaderTypeId && loaderTypeId !== vehicle.loaderType?.id) body.loaderTypeId = loaderTypeId;
    const sc = enDigits(smartCardNo).trim();
    if (sc) body.smartCardNo = sc;
    if (Object.keys(body).length === 0) {
      setError(v.atLeastOne);
      return;
    }
    submit.mutate(body);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={v.changeTitle}
      subtitle={v.changeHint}
      icon={<Truck className="size-5" />}
      footer={
        <div className="flex flex-col-reverse gap-space-sm sm:flex-row sm:justify-end">
          <Button3D variant="neutral" onClick={() => onOpenChange(false)}>
            {v.cancel}
          </Button3D>
          <Button3D
            variant="danger"
            loading={submit.isPending}
            onClick={send}
            icon={<Send className="size-4" aria-hidden />}
          >
            {v.changeSubmit}
          </Button3D>
        </div>
      }
    >
      <div className="flex flex-col gap-space-md">
        <Field label={v.newPlate} htmlFor="chg-plate" hint={`${v.plate}: ${plateFa(vehicle.plate)}`}>
          <PlateInput id="chg-plate" value={plate} onChange={setPlate} />
        </Field>
        <Field
          label={v.newLoaderType}
          htmlFor="chg-loader"
          error={loaders.error ? fa.register.listLoadError : undefined}
        >
          <Select
            id="chg-loader"
            value={loaderTypeId || undefined}
            onValueChange={setLoaderTypeId}
            placeholder={vehicle.loaderType?.title ?? v.changeKeep}
            disabled={loaders.isLoading}
            options={(loaders.data ?? []).map((l) => ({ value: l.id, label: l.title }))}
          />
        </Field>
        <Field label={v.newSmartCardNo} htmlFor="chg-smart">
          <TextInput
            id="chg-smart"
            dir="ltr"
            className="text-end"
            inputMode="numeric"
            placeholder={faDigits(vehicle.smartCardNo)}
            value={smartCardNo}
            onChange={(e) => setSmartCardNo(e.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function PendingChange({ vehicle }: { vehicle: DriverVehicleDto }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const withdraw = useMutation({
    mutationFn: () => api.del<DriverVehicleDto>('/driver/profile/vehicle/change'),
    onSuccess: (data) => {
      qc.setQueryData(driverKeys.vehicle, data);
      void qc.invalidateQueries({ queryKey: driverKeys.dashboard });
      toast({ tone: 'info', title: v.withdrawn });
    },
  });
  const pc = vehicle.pendingChange;
  if (!pc) return null;
  return (
    <Alert
      tone="warning"
      icon={<Clock className="size-5 shrink-0" aria-hidden />}
      title={v.pendingTitle}
      action={
        <Button3D
          size="sm"
          variant="neutral"
          loading={withdraw.isPending}
          onClick={() => withdraw.mutate()}
          icon={<Undo2 className="size-4" aria-hidden />}
        >
          {v.withdraw}
        </Button3D>
      }
    >
      <ul className="mt-1 flex flex-col gap-0.5 text-body-sm">
        {pc.plate ? (
          <li>
            {v.newPlate}: {plateFa(pc.plate)}
          </li>
        ) : null}
        {pc.loaderType !== undefined ? (
          <li>
            {v.newLoaderType}: {pc.loaderType?.title ?? '—'}
          </li>
        ) : null}
        {pc.smartCardNo ? (
          <li>
            {v.newSmartCardNo}: {faDigits(pc.smartCardNo)}
          </li>
        ) : null}
        {pc.requestedAt ? (
          <li>
            {v.requestedAt}: {formatDateTimeFa(pc.requestedAt)}
          </li>
        ) : null}
      </ul>
      {withdraw.error ? <p className="mt-1 text-danger">{errorMessage(withdraw.error)}</p> : null}
    </Alert>
  );
}

export function VehiclePanel() {
  const q = useDriverVehicle();
  const me = useMe();
  const [open, setOpen] = useState(false);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) {
    if (q.error.code === 'NOT_FOUND') return <Alert tone="warning">{v.noVehicle}</Alert>;
    return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  }
  const vehicle = q.data;
  // UX hint only; the API refuses change requests from non-approved drivers.
  const approved = me.data?.driver?.status === 'APPROVED';

  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="flex flex-col gap-space-md">
        <FormSection title={v.infoTitle}>
          <Info label={v.smartCardNo}>
            <span dir="ltr">{faDigits(vehicle.smartCardNo)}</span>
          </Info>
          <Info label={v.plate}>{plateFa(vehicle.plate)}</Info>
          <Info label={v.loaderType}>{vehicle.loaderType?.title ?? '—'}</Info>
          <Info label={v.status}>
            <Badge tone={vehicle.status === 'APPROVED' ? 'success' : 'warning'}>
              {VEHICLE_STATUS_LABELS_FA[vehicle.status]}
            </Badge>
          </Info>
        </FormSection>
        <PendingChange vehicle={vehicle} />
        {vehicle.status === 'APPROVED' ? (
          <div className="flex flex-col gap-space-xs">
            <p className="text-body-sm text-text-secondary">{approved ? v.changeHint : v.notApproved}</p>
            <Button3D
              variant="danger"
              disabled={!approved}
              onClick={() => setOpen(true)}
              icon={<Truck className="size-4" aria-hidden />}
            >
              {v.changeOpen}
            </Button3D>
          </div>
        ) : null}
      </Card>

      <Card>
        <ExpiryForm key={`${vehicle.smartCardExpiry}-${vehicle.inspectionExpiry}`} vehicle={vehicle} />
      </Card>

      {open ? <ChangeModal open={open} onOpenChange={setOpen} vehicle={vehicle} /> : null}
    </div>
  );
}
