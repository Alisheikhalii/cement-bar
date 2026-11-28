'use client';
import { useMemo, useState } from 'react';
import {
  ALLOCATION_LABELS_FA,
  UNIT_STATE_LABELS_FA,
  faDigits,
  type Allocation,
  type AllocationChangeResultDto,
  type AnnouncementDetailDto,
  type AnnouncementUnitDto,
  type UnitState,
} from '@cb/shared';
import { Badge, Button3D, Checkbox, EmptyState, useToast, type Tone } from '@cb/ui';
import { faAnnouncements as t } from '@/i18n/announcements';
import { api } from '@/lib/api';
import { ANN_ENDPOINT, useInvalidateAnnouncements } from './data';
import { ReasonModal } from './ReasonModal';

const STATE_TONE: Record<UnitState, Tone> = {
  OPEN: 'success',
  RESERVED: 'warning',
  CONSUMED: 'primary',
  CANCELLED: 'neutral',
  HELD: 'purple',
};
const ALLOC_TONE: Record<Allocation, Tone> = { GROUP: 'purple', TIMED: 'info', FREE: 'success' };

interface Pending {
  unitIds: string[];
  to: Allocation;
}

/** Load units of one announcement with BR-10 allocation changes (single + bulk), US-B4. */
export function UnitsPanel({ announcement }: { announcement: AnnouncementDetailDto }) {
  const toast = useToast();
  const invalidate = useInvalidateAnnouncements();
  const [units, setUnits] = useState<AnnouncementUnitDto[]>(announcement.units);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const readOnly = announcement.status !== 'ACTIVE';

  const changeable = useMemo(() => units.filter((u) => u.allowedTargets.length > 0), [units]);
  const selectedUnits = units.filter((u) => selected.includes(u.id));
  // Bulk target: all selected units must share the same single target.
  const bulkTarget = (() => {
    const targets = new Set(selectedUnits.map((u) => u.allowedTargets[0]));
    return selectedUnits.length && targets.size === 1 ? [...targets][0] : undefined;
  })();

  async function apply(reason: string) {
    if (!pending) return;
    const body = { to: pending.to, reason };
    const res =
      pending.unitIds.length === 1
        ? await api.patch<AllocationChangeResultDto>(`${ANN_ENDPOINT}/${announcement.id}/units/${pending.unitIds[0]}/allocation`, body)
        : await api.patch<AllocationChangeResultDto>(`${ANN_ENDPOINT}/${announcement.id}/units/allocation`, { ...body, unitIds: pending.unitIds });
    setUnits(res.units);
    setSelected([]);
    invalidate();
    toast.toast({ tone: 'success', title: t.details.changed(faDigits(res.changed)) });
  }

  if (units.length === 0) return <EmptyState title={t.details.units} />;

  const toggle = (id: string, on: boolean) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)));

  return (
    <section className="flex flex-col gap-space-sm" aria-label={t.details.units}>
      {!readOnly && changeable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-space-sm rounded-xl bg-surface-container-low p-space-sm">
          <Checkbox
            id="units-all"
            checked={selected.length === 0 ? false : selected.length === changeable.length ? true : 'indeterminate'}
            onCheckedChange={(on) => setSelected(on ? changeable.map((u) => u.id) : [])}
            label={t.details.selectAllOpen}
          />
          <span className="text-label-md text-text-secondary">{t.details.selected(faDigits(selected.length))}</span>
          <Button3D
            size="sm"
            variant={bulkTarget === 'FREE' ? 'success' : 'neutral'}
            disabled={!bulkTarget}
            onClick={() => bulkTarget && setPending({ unitIds: selected, to: bulkTarget })}
          >
            {bulkTarget && bulkTarget !== 'FREE' ? t.details.bulkRevert : t.details.bulkFree}
          </Button3D>
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-border-subtle rounded-xl border border-border-subtle">
        {units.map((u) => {
          const target = u.allowedTargets[0];
          return (
            <li key={u.id} className="flex flex-wrap items-center gap-space-sm px-space-sm py-space-xs">
              {!readOnly && target ? (
                <Checkbox
                  id={`unit-${u.id}`}
                  checked={selected.includes(u.id)}
                  onCheckedChange={(on) => toggle(u.id, on)}
                  aria-label={`${t.details.seq} ${faDigits(u.seq)}`}
                />
              ) : (
                <span className="size-5" aria-hidden />
              )}
              <span className="w-10 text-label-lg text-text-primary tabular-nums">{faDigits(u.seq)}</span>
              <Badge tone={ALLOC_TONE[u.allocation]}>{ALLOCATION_LABELS_FA[u.allocation]}</Badge>
              <Badge tone={STATE_TONE[u.state]}>{UNIT_STATE_LABELS_FA[u.state]}</Badge>
              {u.baseAllocation !== u.allocation ? (
                <span className="text-caption text-text-muted">
                  {t.details.base}: {ALLOCATION_LABELS_FA[u.baseAllocation]}
                </span>
              ) : null}
              <span className="ms-auto">
                {!readOnly && target ? (
                  <Button3D size="sm" variant="ghost" onClick={() => setPending({ unitIds: [u.id], to: target })}>
                    {t.details.changeTo} {ALLOCATION_LABELS_FA[target]}
                  </Button3D>
                ) : (
                  <span className="text-caption text-text-muted">{t.details.noChange}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <ReasonModal
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `${t.details.changeTitle}: ${ALLOCATION_LABELS_FA[pending.to]}` : t.details.changeTitle}
        description={pending ? t.details.selected(faDigits(pending.unitIds.length)) : undefined}
        label={t.details.changeReason}
        confirmLabel={t.details.changeConfirm}
        onConfirm={apply}
      />
    </section>
  );
}
