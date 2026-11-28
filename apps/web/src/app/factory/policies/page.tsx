import { PoliciesPage } from '@/components/factory/PoliciesPage';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.factory.policies };

export default function Page() {
  return <PoliciesPage />;
}
