import { ReportsView } from '@/components/carrier/ReportsView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.factory.reports };

export default function Page() {
  return <ReportsView panel="factory" />;
}
