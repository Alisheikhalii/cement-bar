import { DailyFilesPage } from '@/components/factory/DailyFilesPage';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.factory.dailyFiles };

export default function Page() {
  return <DailyFilesPage />;
}
