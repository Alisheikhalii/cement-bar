import { ReservationsView } from '@/components/driver/queue/ReservationsView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.reservations };

export default function Page() {
  return <ReservationsView />;
}
