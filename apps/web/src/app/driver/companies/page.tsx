import { CompaniesView } from '@/components/driver/CompaniesView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.companies };

export default function Page() {
  return <CompaniesView />;
}
