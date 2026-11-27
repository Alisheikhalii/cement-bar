import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Card, EmptyState, button3DClasses } from '@cb/ui';
import { fa } from '@/i18n/fa';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-margin-mobile">
      <Card className="w-full max-w-md">
        <EmptyState
          icon={<SearchX className="size-7" />}
          title={fa.common.notFoundTitle}
          action={
            <Link href="/" className={button3DClasses({ variant: 'primary' })}>
              {fa.common.goHome}
            </Link>
          }
        />
      </Card>
    </main>
  );
}
