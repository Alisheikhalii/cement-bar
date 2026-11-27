'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ERRORS } from '@cb/shared';
import { ToastProvider, useToast } from '@cb/ui';
import { ApiError, setAuthFailureHandler } from '@/lib/api';
import { fa } from '@/i18n/fa';

const PUBLIC_PATHS = ['/login', '/register'];
const MAX_QUERY_RETRIES = 2;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors (4xx) are final; retry only network/5xx.
        retry: (count, err) =>
          count < MAX_QUERY_RETRIES && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      },
      mutations: { retry: false },
    },
  });
}

/** Bridges the plain API client to React: Persian toast + redirect when the session is gone. */
function AuthEvents() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setAuthFailureHandler((reason) => {
      qc.clear();
      if (reason === 'SESSION_REVOKED') {
        toast({ tone: 'danger', title: fa.auth.sessionRevoked, description: ERRORS.SESSION_REVOKED.fa });
      }
      if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
        if (reason === 'UNAUTHENTICATED') toast({ tone: 'info', title: fa.auth.sessionExpired });
        router.replace('/login');
      }
    });
    return () => setAuthFailureHandler(null);
  }, [router, pathname, qc, toast]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthEvents />
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
