import { BagHallView } from '@/components/driver/queue/BagHallView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.bagHall };

export default function Page() {
  return <BagHallView />;
}
