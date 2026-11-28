import { DriversView } from '@/components/carrier/DriversView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.drivers };

export default function Page() {
  return <DriversView />;
}
