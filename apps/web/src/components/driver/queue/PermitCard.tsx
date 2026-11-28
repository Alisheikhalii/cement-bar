'use client';
import { Ban, Ticket } from 'lucide-react';
import { Badge, Button3D } from '@cb/ui';
import {
  RESERVATION_STATUS_LABELS_FA,
  faDigits,
  formatDateTimeFa,
  type DriverReservationDto,
} from '@cb/shared';
import { faDriverQueue } from '@/i18n/driver-queue';
import { RESERVATION_TONE } from './helpers';

const r = faDriverQueue.reservations;

export interface PermitCardProps {
  reservation: DriverReservationDto;
  onCancelRequest: (reservation: DriverReservationDto) => void;
}

/** One permit (active or archived) with its cancel-request state. */
export function PermitCard({ reservation, onCancelRequest }: PermitCardProps) {
  const req = reservation.cancelRequest;

  return (
    <article className="flex flex-col gap-space-sm rounded-2xl bg-surface-card p-space-md shadow-elevation-1">
      <header className="flex flex-wrap items-center justify-between gap-space-xs">
        <span className="inline-flex items-center gap-1.5 text-label-lg text-text-primary">
          <Ticket className="size-4 text-primary-container" aria-hidden />
          {r.permitNo} <span className="text-headline-md">{faDigits(reservation.permitNo)}</span>
        </span>
        <Badge tone={RESERVATION_TONE[reservation.status]}>
          {RESERVATION_STATUS_LABELS_FA[reservation.status]}
        </Badge>
      </header>

      <p className="min-w-0 text-headline-sm text-text-primary">
        #{faDigits(reservation.announcementNumber)} — {reservation.title}
      </p>

      <dl className="grid grid-cols-2 gap-x-space-sm gap-y-space-xs text-body-sm">
        <div className="min-w-0">
          <dt className="text-caption text-text-muted">{r.destination}</dt>
          <dd className="truncate text-text-body">{reservation.destinationTitle}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-text-muted">{r.hall}</dt>
          <dd className="truncate text-text-body">{reservation.hallTitle}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-text-muted">{r.reservedAt}</dt>
          <dd className="text-text-body">{formatDateTimeFa(reservation.reservedAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-text-muted">{r.source}</dt>
          <dd className="text-text-body">{r.sourceLabels[reservation.source]}</dd>
        </div>
      </dl>

      {req ? (
        <div className="flex flex-col gap-1 rounded-xl bg-surface-container-low p-space-sm">
          <span className="flex flex-wrap items-center gap-space-xs">
            <Badge tone={req.status === 'PENDING' ? 'warning' : req.status === 'APPROVED' ? 'success' : 'danger'}>
              {r.cancelStatus[req.status]}
            </Badge>
            <span className="text-caption text-text-muted">
              {r.requestedAt}: {formatDateTimeFa(req.createdAt)}
            </span>
          </span>
          <p className="text-body-sm text-text-body">
            {r.requestReason}: {req.reason}
          </p>
          {req.decisionNote ? (
            <p className="text-body-sm text-text-secondary">
              {r.decisionNote}: {req.decisionNote}
            </p>
          ) : null}
          {req.status === 'PENDING' ? (
            <p className="text-caption text-text-muted">{r.pendingBody}</p>
          ) : null}
        </div>
      ) : null}

      {reservation.canRequestCancel ? (
        <div className="flex flex-col gap-1">
          <Button3D
            variant="warning"
            icon={<Ban className="size-4" aria-hidden />}
            onClick={() => onCancelRequest(reservation)}
          >
            {r.cancelButton}
          </Button3D>
          <p className="text-caption text-text-muted">{r.penaltyHint}</p>
        </div>
      ) : null}
    </article>
  );
}
