'use client';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, Role } from '@cb/shared';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { ApiError, api, errorMessage } from './api';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export const ROLE_HOME: Record<Role, string> = {
  FACTORY_OPERATOR: '/factory',
  CARRIER_OPERATOR: '/carrier',
  DRIVER: '/driver',
};

export function useMe() {
  return useQuery<MeResponse, ApiError>({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => api.get<MeResponse>('/auth/me', { signal }),
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });
}

/**
 * UX-only guard: sends users to their own panel. Real authorization is enforced by the API on every
 * request (CLAUDE.md golden rule #2).
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter();
  const me = useMe();
  const wrongRole = me.data && me.data.role !== role;
  const unauth = me.error?.code === 'UNAUTHENTICATED' || me.error?.code === 'SESSION_REVOKED';

  useEffect(() => {
    if (wrongRole && me.data) router.replace(ROLE_HOME[me.data.role]);
    else if (unauth) router.replace('/login');
  }, [wrongRole, unauth, me.data, router]);

  if (me.data && !wrongRole) return <>{children}</>;
  if (me.error && !unauth)
    return (
      <div className="p-margin-mobile md:p-margin">
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
      </div>
    );
  return (
    <div className="p-margin-mobile md:p-margin">
      <PageSkeleton />
    </div>
  );
}
