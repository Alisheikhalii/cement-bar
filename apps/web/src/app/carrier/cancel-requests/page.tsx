import { CancelRequestsView } from '@/components/carrier/queue/CancelRequestsView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.cancelRequests };

export default function Page() {
  return <CancelRequestsView />;
}
