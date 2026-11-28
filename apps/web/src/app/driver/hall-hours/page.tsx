import { HallHoursView } from '@/components/driver/HallHoursView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.hallHours };

export default function Page() {
  return <HallHoursView />;
}
