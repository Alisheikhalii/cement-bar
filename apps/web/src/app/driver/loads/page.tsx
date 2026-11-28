import { LoadsView } from '@/components/driver/queue/LoadsView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.loads };

export default function Page() {
  return <LoadsView />;
}
