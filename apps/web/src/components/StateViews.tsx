'use client';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { Button3D, Card, EmptyState, Skeleton } from '@cb/ui';
import { fa } from '@/i18n/fa';

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<ServerCrash className="size-7 text-danger" />}
        title={fa.common.errorTitle}
        description={message ?? fa.common.unknownError}
        action={
          onRetry ? (
            <Button3D variant="neutral" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRetry}>
              {fa.common.retry}
            </Button3D>
          ) : null
        }
      />
    </Card>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-space-md" role="status" aria-label={fa.common.loading}>
      <Skeleton className="h-8 w-1/2 max-w-xs" />
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-space-lg">
      <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">{title}</h1>
      {description ? <p className="mt-1 text-body-md text-text-secondary">{description}</p> : null}
    </div>
  );
}
