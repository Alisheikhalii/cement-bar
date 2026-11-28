import { BulkFairnessView } from '@/components/factory/queue/BulkFairnessView';
import { fq } from '@/i18n/factory-queue';

export const metadata = { title: fq.fairness.title };

export default function Page() {
  return <BulkFairnessView />;
}
