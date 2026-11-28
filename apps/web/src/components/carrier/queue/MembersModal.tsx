'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserMinus, X } from 'lucide-react';
import { Alert, Badge, Button3D, Checkbox, Field, IconButton3D, Modal, Skeleton, Textarea, TextInput, useToast } from '@cb/ui';
import {
  faDigits,
  type CarrierBulkGroupDto,
  type CarrierBulkGroupDriverDto,
  type Paginated,
  type TableRow,
} from '@cb/shared';
import { cq } from '@/i18n/carrier-queue';
import { api, errorMessage } from '@/lib/api';
import { APPROVED_DRIVERS_KEY, GROUPS_KEY, LIVE_KEY, otherGroupTitle } from './helpers';

interface DriverRow extends TableRow {
  fullName: string | null;
  plate: string | null;
  loaderType: string | null;
}

interface Option {
  id: string;
  name: string;
  plate: string | null;
  loader: string | null;
}

function memberOption(m: CarrierBulkGroupDriverDto): Option {
  return {
    id: m.driverId,
    name: `${m.firstName} ${m.lastName}`.trim(),
    plate: m.plate,
    loader: m.loaderTitle,
  };
}

function rowOption(r: DriverRow): Option {
  return {
    id: r.id,
    name: (r.fullName ?? '').trim() || r.id,
    plate: r.plate ?? null,
    loader: r.loaderType ?? null,
  };
}

function matches(o: Option, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim();
  return o.name.includes(needle) || (o.plate ?? '').includes(needle);
}

export interface MembersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: CarrierBulkGroupDto | null;
  groups: readonly CarrierBulkGroupDto[];
}

/** US-B6: pick members of one bulk group from this carrier's APPROVED drivers; tomorrow by default, apply-now needs a reason. */
export function MembersModal({ open, onOpenChange, group, groups }: MembersModalProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [applyNow, setApplyNow] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && group) {
      setSelected(group.members.map((m) => m.driverId));
      setSearch('');
      setApplyNow(false);
      setReason('');
    }
  }, [open, group]);

  const driversQ = useQuery({
    queryKey: APPROVED_DRIVERS_KEY,
    queryFn: ({ signal }) =>
      api.get<Paginated<DriverRow>>('/carrier/drivers', {
        query: { pageSize: 200, f_status: 'APPROVED' },
        signal,
      }),
    enabled: open,
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: () => {
      if (!group) throw new Error('no group');
      return api.put<CarrierBulkGroupDto>(`/carrier/groups/${group.id}/members`, {
        driverIds: selected,
        ...(applyNow ? { applyNow: true, reason: reason.trim() } : {}),
      });
    },
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.members.saved });
      onOpenChange(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: GROUPS_KEY }),
        qc.invalidateQueries({ queryKey: LIVE_KEY }),
      ]);
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const approved = useMemo<Option[]>(() => (driversQ.data?.items ?? []).map(rowOption), [driversQ.data]);
  const memberOptions = useMemo<Option[]>(() => (group?.members ?? []).map(memberOption), [group]);

  const byId = useMemo(() => {
    const map = new Map<string, Option>();
    for (const o of [...memberOptions, ...approved]) map.set(o.id, o);
    return map;
  }, [memberOptions, approved]);

  const available = useMemo(
    () => approved.filter((o) => !selected.includes(o.id) && matches(o, search)),
    [approved, selected, search],
  );

  if (!group) return null;

  const reasonMissing = applyNow && !reason.trim();
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={cq.members.title(group.title)}
      size="lg"
      footer={
        <>
          <Button3D variant="neutral" onClick={() => onOpenChange(false)}>
            {cq.common.cancel}
          </Button3D>
          <Button3D loading={save.isPending} disabled={reasonMissing} onClick={() => save.mutate()}>
            {cq.members.save}
          </Button3D>
        </>
      }
    >
      <div className="flex flex-col gap-space-lg">
        <p className="text-body-sm text-text-secondary">{cq.members.onlyApproved}</p>

        <section className="flex flex-col gap-space-xs">
          <h3 className="text-headline-sm text-text-primary">
            {cq.members.current}{' '}
            <span className="text-label-md text-text-muted">({cq.members.selectedCount(faDigits(selected.length))})</span>
          </h3>
          {selected.length === 0 ? (
            <p className="rounded-xl bg-surface-container-low px-space-md py-space-sm text-body-sm text-text-muted">
              {cq.members.emptyMembers}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle rounded-xl bg-surface-container-low">
              {selected.map((id) => {
                const o = byId.get(id);
                return (
                  <li key={id} className="flex min-h-11 items-center justify-between gap-space-sm px-space-sm py-space-xs">
                    <div className="min-w-0">
                      <p className="truncate text-body-md text-text-primary">{o?.name ?? id}</p>
                      <p className="text-caption text-text-muted">
                        {o?.plate ? faDigits(o.plate) : cq.common.none}
                        {o?.loader ? ` · ${o.loader}` : ''}
                      </p>
                    </div>
                    <IconButton3D
                      label={cq.members.remove}
                      icon={<X className="size-4" aria-hidden />}
                      variant="neutral"
                      onClick={() => setSelected((xs) => xs.filter((x) => x !== id))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-space-xs">
          <h3 className="text-headline-sm text-text-primary">{cq.members.available}</h3>
          <Field label={cq.members.search} htmlFor="member-search">
            <TextInput
              id="member-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={cq.members.search}
              autoComplete="off"
            />
          </Field>
          {driversQ.isPending ? (
            <div className="flex flex-col gap-space-xs" role="status" aria-label={cq.members.membersLoading}>
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-11 rounded-xl" />
              ))}
            </div>
          ) : driversQ.isError ? (
            <Alert tone="danger" title={cq.members.driversError}>
              {errorMessage(driversQ.error)}
            </Alert>
          ) : available.length === 0 ? (
            <p className="rounded-xl bg-surface-container-low px-space-md py-space-sm text-body-sm text-text-muted">
              {cq.members.noDrivers}
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto rounded-xl border border-border-subtle">
              {available.map((o) => {
                const other = otherGroupTitle(groups, o.id, group.id);
                return (
                  <li
                    key={o.id}
                    className="flex min-h-11 items-center justify-between gap-space-sm border-b border-border-subtle px-space-sm py-space-xs last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body-md text-text-primary">{o.name}</p>
                      <p className="text-caption text-text-muted">
                        {o.plate ? faDigits(o.plate) : cq.common.none}
                        {o.loader ? ` · ${o.loader}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-space-xs">
                      {other ? <Badge tone="warning">{cq.members.inOtherGroup(other)}</Badge> : null}
                      <IconButton3D
                        label={cq.members.add}
                        icon={<Plus className="size-4" aria-hidden />}
                        variant="primary"
                        disabled={!!other}
                        onClick={() => setSelected((xs) => [...xs, o.id])}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Alert tone="info">
          <div className="flex flex-col gap-space-xs">
            <p>{cq.common.tomorrowHint}</p>
            <Checkbox
              id="members-apply-now"
              checked={applyNow}
              onCheckedChange={setApplyNow}
              label={cq.common.applyNow}
            />
          </div>
        </Alert>
        {applyNow ? (
          <Field label={cq.members.applyReason} htmlFor="members-reason" required hint={cq.common.reasonHint}>
            <Textarea
              id="members-reason"
              value={reason}
              maxLength={500}
              invalid={reasonMissing}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : null}

        <p className="flex items-center gap-space-xs text-caption text-text-muted">
          <UserMinus className="size-4" aria-hidden />
          {cq.common.applyNowHint}
        </p>
      </div>
    </Modal>
  );
}
