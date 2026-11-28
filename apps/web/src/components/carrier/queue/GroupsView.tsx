'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, PencilLine, Plus, PlusCircle, Power, Trash2, UsersRound } from 'lucide-react';
import { Alert, Badge, Button3D, Card, EmptyState, IconButton3D, Skeleton, useToast } from '@cb/ui';
import { faDigits, type CarrierBulkGroupDto } from '@cb/shared';
import { cq } from '@/i18n/carrier-queue';
import { ErrorState, PageHeader } from '@/components/StateViews';
import { api, errorMessage } from '@/lib/api';
import { GROUPS_KEY, LIVE_KEY, SETTINGS_KEY, moveInOrder } from './helpers';
import { BulkSettingsCard } from './BulkSettingsCard';
import { MembersModal } from './MembersModal';
import { ConfirmDialog, ReasonDialog, TextPromptDialog } from './dialogs';

function GroupRow(props: {
  group: CarrierBulkGroupDto;
  index: number;
  count: number;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onRename: (g: CarrierBulkGroupDto) => void;
  onToggle: (g: CarrierBulkGroupDto) => void;
  onDelete: (g: CarrierBulkGroupDto) => void;
  onMembers: (g: CarrierBulkGroupDto) => void;
}) {
  const { group, index, count, busy } = props;
  return (
    <li className="flex flex-wrap items-center gap-space-sm py-space-sm first:pt-0 last:pb-0">
      <div className="flex flex-col">
        <IconButton3D
          label={cq.groups.moveUp}
          icon={<ArrowUp className="size-4" aria-hidden />}
          variant="neutral"
          disabled={busy || index === 0}
          onClick={() => props.onMove(index, index - 1)}
        />
        <IconButton3D
          label={cq.groups.moveDown}
          icon={<ArrowDown className="size-4" aria-hidden />}
          variant="neutral"
          disabled={busy || index === count - 1}
          onClick={() => props.onMove(index, index + 1)}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-text-muted">{faDigits(index + 1)}</p>
        <h3 className="truncate text-headline-sm text-text-primary">{group.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-space-xs">
          <Badge tone={group.active ? 'success' : 'neutral'}>
            {group.active ? cq.groups.active : cq.groups.inactive}
          </Badge>
          <Badge tone="info">{cq.groups.memberCount(faDigits(group.memberCount))}</Badge>
          {group.memberCount === 0 ? <span className="text-caption text-text-muted">{cq.groups.noMembers}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-space-xs">
        <IconButton3D
          label={cq.groups.manageMembers}
          icon={<UsersRound className="size-4" aria-hidden />}
          variant="primary"
          disabled={busy}
          onClick={() => props.onMembers(group)}
        />
        <IconButton3D
          label={cq.groups.rename}
          icon={<PencilLine className="size-4" aria-hidden />}
          variant="neutral"
          disabled={busy}
          onClick={() => props.onRename(group)}
        />
        <IconButton3D
          label={group.active ? cq.groups.deactivate : cq.groups.activate}
          icon={<Power className="size-4" aria-hidden />}
          variant={group.active ? 'warning' : 'success'}
          disabled={busy}
          onClick={() => props.onToggle(group)}
        />
        <IconButton3D
          label={cq.common.delete}
          icon={<Trash2 className="size-4" aria-hidden />}
          variant="danger"
          disabled={busy}
          onClick={() => props.onDelete(group)}
        />
      </div>
    </li>
  );
}

interface ToggleVars {
  group: CarrierBulkGroupDto;
  active: boolean;
  reason: string;
  applyNow: boolean;
}

/** US-B6: bulk groups list — quick add, rename, activate/deactivate, delete, reorder, members, settings. */
export function GroupsView() {
  const qc = useQueryClient();
  const toast = useToast();
  const [order, setOrder] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CarrierBulkGroupDto | null>(null);
  const [toggleTarget, setToggleTarget] = useState<CarrierBulkGroupDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CarrierBulkGroupDto | null>(null);
  const [membersTarget, setMembersTarget] = useState<CarrierBulkGroupDto | null>(null);

  const q = useQuery({
    queryKey: GROUPS_KEY,
    queryFn: ({ signal }) => api.get<CarrierBulkGroupDto[]>('/carrier/groups', { signal }),
  });

  useEffect(() => {
    if (q.data) setOrder(q.data.map((g) => g.id));
  }, [q.data]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: GROUPS_KEY }),
      qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
      qc.invalidateQueries({ queryKey: LIVE_KEY }),
    ]);
  };

  const create = useMutation({
    mutationFn: (title: string) => api.post<CarrierBulkGroupDto>('/carrier/groups', { title }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.groups.created });
      setCreateOpen(false);
      await invalidateAll();
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.patch<CarrierBulkGroupDto[]>('/carrier/groups/reorder', { ids }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: GROUPS_KEY });
    },
    onError: (e) => {
      toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) });
      void qc.invalidateQueries({ queryKey: GROUPS_KEY });
    },
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; title: string }) =>
      api.patch<CarrierBulkGroupDto>(`/carrier/groups/${v.id}`, { title: v.title }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.groups.renamed });
      setRenameTarget(null);
      await invalidateAll();
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const toggle = useMutation({
    mutationFn: (v: ToggleVars) =>
      api.patch<CarrierBulkGroupDto>(`/carrier/groups/${v.group.id}`, {
        active: v.active,
        ...(v.applyNow ? { applyNow: true, reason: v.reason.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.groups.statusChanged });
      setToggleTarget(null);
      await invalidateAll();
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<void>(`/carrier/groups/${id}`),
    onSuccess: async () => {
      toast.toast({ tone: 'success', title: cq.groups.deleted });
      setDeleteTarget(null);
      await invalidateAll();
    },
    onError: (e) => toast.toast({ tone: 'danger', title: cq.common.failed, description: errorMessage(e) }),
  });

  const groups = useMemo(() => q.data ?? [], [q.data]);
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const orderedIds =
    order.length === groups.length && groups.every((g) => order.includes(g.id)) ? order : groups.map((g) => g.id);
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((g): g is CarrierBulkGroupDto => g !== undefined);
  const busy = create.isPending || reorder.isPending || rename.isPending || toggle.isPending || remove.isPending;

  const move = (from: number, to: number) => {
    const next = moveInOrder(orderedIds, from, to);
    setOrder(next);
    reorder.mutate(next);
  };

  const quickAdd = () => create.mutate(cq.groups.nextTitle(faDigits(groups.length + 1)));

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader title={cq.groups.title} description={cq.groups.description} />

      <BulkSettingsCard groups={groups} />

      <Card>
        <div className="mb-space-md flex flex-wrap items-center justify-between gap-space-sm">
          <h2 className="text-headline-md text-text-primary">{cq.groups.groupsHeading}</h2>
          <div className="flex flex-wrap gap-space-xs">
            <Button3D
              variant="primary"
              size="sm"
              icon={<Plus className="size-4" aria-hidden />}
              disabled={busy}
              onClick={() => setCreateOpen(true)}
            >
              {cq.groups.add}
            </Button3D>
            <Button3D
              variant="neutral"
              size="sm"
              icon={<PlusCircle className="size-4" aria-hidden />}
              loading={create.isPending}
              disabled={busy}
              onClick={quickAdd}
            >
              {cq.groups.addNext}
            </Button3D>
          </div>
        </div>

        <Alert tone="info" className="mb-space-md">
          {cq.common.tomorrowHint}
        </Alert>

        {q.isPending ? (
          <div className="flex flex-col gap-space-sm" role="status" aria-label={cq.groups.listLoading}>
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={<UsersRound className="size-7" />}
            title={cq.groups.empty}
            description={cq.groups.emptyDesc}
            action={
              <Button3D variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreateOpen(true)}>
                {cq.groups.add}
              </Button3D>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {ordered.map((g, i) => (
              <GroupRow
                key={g.id}
                group={g}
                index={i}
                count={ordered.length}
                busy={busy}
                onMove={move}
                onRename={setRenameTarget}
                onToggle={setToggleTarget}
                onDelete={setDeleteTarget}
                onMembers={setMembersTarget}
              />
            ))}
          </ul>
        )}
      </Card>

      <TextPromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={cq.groups.addTitle}
        label={cq.groups.titleLabel}
        placeholder={cq.groups.titlePlaceholder}
        submitLabel={cq.groups.add}
        loading={create.isPending}
        onSubmit={(title) => create.mutate(title)}
      />

      <TextPromptDialog
        open={renameTarget !== null}
        onOpenChange={(o) => !o && setRenameTarget(null)}
        title={cq.groups.renameTitle}
        label={cq.groups.titleLabel}
        initialValue={renameTarget?.title ?? ''}
        placeholder={cq.groups.titlePlaceholder}
        submitLabel={cq.common.save}
        loading={rename.isPending}
        onSubmit={(title) => renameTarget && rename.mutate({ id: renameTarget.id, title })}
      />

      <ReasonDialog
        open={toggleTarget !== null}
        onOpenChange={(o) => !o && setToggleTarget(null)}
        title={toggleTarget ? cq.groups.activeTitle(toggleTarget.title) : ''}
        message={cq.groups.activeConfirm}
        required={false}
        showApplyNow
        applyReasonLabel={cq.groups.applyReason}
        submitLabel={toggleTarget?.active ? cq.groups.deactivate : cq.groups.activate}
        variant={toggleTarget?.active ? 'warning' : 'success'}
        loading={toggle.isPending}
        onSubmit={({ reason, applyNow }) =>
          toggleTarget &&
          toggle.mutate({ group: toggleTarget, active: !toggleTarget.active, reason, applyNow })
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={cq.groups.deleteTitle}
        message={deleteTarget ? cq.groups.deleteConfirm(deleteTarget.title) : ''}
        confirmLabel={cq.common.delete}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />

      <MembersModal
        open={membersTarget !== null}
        onOpenChange={(o) => !o && setMembersTarget(null)}
        group={membersTarget}
        groups={groups}
      />
    </div>
  );
}
