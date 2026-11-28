import { BulkLiveView } from '@/components/carrier/queue/BulkLiveView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.bulkLive };

export default function Page() {
  return <BulkLiveView />;
}
