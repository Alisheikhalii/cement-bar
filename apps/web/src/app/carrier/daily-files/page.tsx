import { DailyFilesView } from '@/components/carrier/DailyFilesView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.dailyFiles };

export default function Page() {
  return <DailyFilesView />;
}
