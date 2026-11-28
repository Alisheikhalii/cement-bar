import { HistoryView } from '@/components/driver/queue/HistoryView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.history };

export default function Page() {
  return <HistoryView />;
}
