'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState, PageSkeleton } from '@/components/StateViews';
import { errorMessage } from '@/lib/api';
import { ROLE_HOME, useMe } from '@/lib/auth';

/** Entry: send the user to their panel, or to /login when there is no session. */
export default function HomePage() {
  const router = useRouter();
  const me = useMe();
  const unauth = me.error?.code === 'UNAUTHENTICATED' || me.error?.code === 'SESSION_REVOKED';

  useEffect(() => {
    if (me.data) router.replace(ROLE_HOME[me.data.role]);
    else if (unauth) router.replace('/login');
  }, [me.data, unauth, router]);

  return (
    <main id="main" className="mx-auto max-w-5xl p-margin-mobile md:p-margin">
      {me.error && !unauth ? (
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
      ) : (
        <PageSkeleton />
      )}
    </main>
  );
}
