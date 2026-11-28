import { PermitsView } from '@/components/carrier/PermitsView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.permits };

export default function Page() {
  return <PermitsView />;
}
