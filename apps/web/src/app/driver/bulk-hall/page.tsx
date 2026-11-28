import { BulkHallView } from '@/components/driver/queue/BulkHallView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.bulkHall };

export default function Page() {
  return <BulkHallView />;
}
