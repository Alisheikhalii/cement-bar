import { Construction } from 'lucide-react';
import { Card, EmptyState } from '@cb/ui';
import { fa } from '@/i18n/fa';

/** Server component placeholder for sections built in later phases. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="mb-space-lg text-headline-lg-mobile text-text-primary md:text-headline-lg">{title}</h1>
      <Card>
        <EmptyState icon={<Construction className="size-7" />} title={fa.common.comingSoon} />
      </Card>
    </div>
  );
}
