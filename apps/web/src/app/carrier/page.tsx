import { CarrierDashboard } from '@/components/carrier/CarrierDashboard';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.dashboard };

export default function Page() {
  return <CarrierDashboard />;
}
