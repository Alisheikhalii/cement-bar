'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnnouncementDetailDto,
  AnnouncementLookupsDto,
  AnnouncementSummaryDto,
  AnnouncementView,
} from '@cb/shared';
import { api } from '@/lib/api';
import { tableQueryKey } from '@/components/table/ServerTable';

export const ANN_ENDPOINT = '/carrier/announcements';
const LOOKUP_STALE_MS = 60_000;

export const annKeys = {
  all: ['announcements'] as const,
  lookups: ['announcements', 'lookups'] as const,
  summary: (view: AnnouncementView) => ['announcements', 'summary', view] as const,
  detail: (id: string) => ['announcements', 'detail', id] as const,
};

export function useLookups(enabled = true) {
  return useQuery({
    queryKey: annKeys.lookups,
    queryFn: ({ signal }) => api.get<AnnouncementLookupsDto>(`${ANN_ENDPOINT}/lookups`, { signal }),
    staleTime: LOOKUP_STALE_MS,
    enabled,
  });
}

export function useSummary(view: AnnouncementView) {
  return useQuery({
    queryKey: annKeys.summary(view),
    queryFn: ({ signal }) => api.get<AnnouncementSummaryDto>(`${ANN_ENDPOINT}/summary`, { query: { view }, signal }),
  });
}

export function useAnnouncement(id: string | null) {
  return useQuery({
    queryKey: annKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api.get<AnnouncementDetailDto>(`${ANN_ENDPOINT}/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Refresh table, summary badges and cached details after any write. */
export function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: tableQueryKey(ANN_ENDPOINT) });
    void qc.invalidateQueries({ queryKey: annKeys.all });
  };
}
