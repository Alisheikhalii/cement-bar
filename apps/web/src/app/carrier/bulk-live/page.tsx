import { ComingSoon } from '@/components/ComingSoon';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.bulkLive };

export default function Page() {
  return <ComingSoon title={fa.nav.carrier.bulkLive} />;
}
