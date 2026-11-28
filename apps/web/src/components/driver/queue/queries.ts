'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Allocation,
  BagHallDto,
  BagPriorityDto,
  BagTurnDto,
  DriverBulkStateDto,
  DriverHistoryDto,
  DriverLoadCityDto,
  DriverLoadDto,
  DriverReservationDto,
  HallCategory,
  QueueHallDayDto,
} from '@cb/shared';
import { api, type ApiError } from '@/lib/api';

export type ReservationView = 'active' | 'history';

export interface LoadFilters {
  cityId?: number;
  hallCategory?: HallCategory;
}

export interface ReserveInput {
  announcementId?: string;
  unitId?: string;
}

/** Query keys of the driver queue slice (all under `['driver']`, invalidated by prefix). */
export const queueKeys = {
  bag: ['driver', 'bag'] as const,
  bulk: ['driver', 'bulk'] as const,
  loadsRoot: ['driver', 'loads'] as const,
  cities: (hallCategory?: HallCategory) => ['driver', 'loads', 'cities', hallCategory ?? 'ALL'] as const,
  loads: (f: LoadFilters) => ['driver', 'loads', 'list', f.cityId ?? 'all', f.hallCategory ?? 'ALL'] as const,
  load: (announcementId: string) => ['driver', 'loads', 'detail', announcementId] as const,
  reservationsRoot: ['driver', 'reservations'] as const,
  reservations: (view: ReservationView) => ['driver', 'reservations', view] as const,
  history: ['driver', 'history'] as const,
};

function isOpenDay(day: QueueHallDayDto | null | undefined): boolean {
  return !!day && day.status !== 'CLOSED' && day.status !== 'CANCELLED';
}

// ───────── reads ─────────

export function useBagHall() {
  return useQuery<BagHallDto, ApiError>({
    queryKey: queueKeys.bag,
    queryFn: ({ signal }) => api.get<BagHallDto>('/driver/bag', { signal }),
    // Poll while a day exists so the turn number, window and allocation result appear without a reload.
    refetchInterval: (query) => (isOpenDay(query.state.data?.day) ? 4_000 : false),
  });
}

export function useBulkHall() {
  return useQuery<DriverBulkStateDto, ApiError>({
    queryKey: queueKeys.bulk,
    queryFn: ({ signal }) => api.get<DriverBulkStateDto>('/driver/bulk', { signal }),
    refetchInterval: (query) => (isOpenDay(query.state.data?.day) ? 5_000 : false),
  });
}

export function useLoadCities(hallCategory?: HallCategory) {
  return useQuery<DriverLoadCityDto[], ApiError>({
    queryKey: queueKeys.cities(hallCategory),
    queryFn: ({ signal }) =>
      api.get<DriverLoadCityDto[]>('/driver/loads/cities', { signal, query: { hallCategory } }),
    staleTime: 30_000,
  });
}

export function useLoads(filters: LoadFilters, enabled = true) {
  return useQuery<DriverLoadDto[], ApiError>({
    queryKey: queueKeys.loads(filters),
    queryFn: ({ signal }) =>
      api.get<DriverLoadDto[]>('/driver/loads', {
        signal,
        query: { cityId: filters.cityId, hallCategory: filters.hallCategory },
      }),
    enabled,
    refetchInterval: enabled ? 5_000 : false,
  });
}

export function useLoadDetail(announcementId: string | null) {
  return useQuery<DriverLoadDto, ApiError>({
    queryKey: queueKeys.load(announcementId ?? ''),
    queryFn: ({ signal }) => api.get<DriverLoadDto>(`/driver/loads/${announcementId}`, { signal }),
    enabled: !!announcementId,
    refetchInterval: announcementId ? 5_000 : false,
    staleTime: 0,
  });
}

export function useMyReservations(view: ReservationView) {
  return useQuery<DriverReservationDto[], ApiError>({
    queryKey: queueKeys.reservations(view),
    queryFn: ({ signal }) => api.get<DriverReservationDto[]>('/driver/reservations', { signal, query: { view } }),
    refetchInterval: view === 'active' ? 15_000 : false,
  });
}

export function useDriverHistory() {
  return useQuery<DriverHistoryDto, ApiError>({
    queryKey: queueKeys.history,
    queryFn: ({ signal }) => api.get<DriverHistoryDto>('/driver/history', { signal }),
    staleTime: 60_000,
  });
}

// ───────── writes ─────────

/** Client-generated idempotency key: uuid when available, url-safe hex otherwise. */
function idempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `cb-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function useRegisterBagTurn() {
  const qc = useQueryClient();
  return useMutation<{ turn: BagTurnDto }, ApiError, void>({
    mutationFn: () => api.post<{ turn: BagTurnDto }>('/driver/bag/turn', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: queueKeys.bag }),
  });
}

export function useSetBagPriorities() {
  const qc = useQueryClient();
  return useMutation<{ priorities: BagPriorityDto[] }, ApiError, string[]>({
    mutationFn: (announcementIds) =>
      api.put<{ priorities: BagPriorityDto[] }>('/driver/bag/priorities', { announcementIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queueKeys.bag }),
  });
}

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation<DriverReservationDto, ApiError, ReserveInput>({
    mutationFn: (input) =>
      api.post<DriverReservationDto>('/driver/reservations', { ...input, idempotencyKey: idempotencyKey() }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queueKeys.loadsRoot }),
        qc.invalidateQueries({ queryKey: queueKeys.reservationsRoot }),
        qc.invalidateQueries({ queryKey: queueKeys.bulk }),
        qc.invalidateQueries({ queryKey: queueKeys.bag }),
      ]);
    },
  });
}

export function useRequestCancel() {
  const qc = useQueryClient();
  return useMutation<DriverReservationDto, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<DriverReservationDto>(`/driver/reservations/${id}/cancel-request`, { reason }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queueKeys.reservationsRoot });
    },
  });
}

/** Allocation options for the loads filter (kept next to the DTO types to avoid `any` casts in views). */
export const LOAD_ALLOCATION_OPTIONS: readonly Allocation[] = ['TIMED', 'GROUP', 'FREE'];
