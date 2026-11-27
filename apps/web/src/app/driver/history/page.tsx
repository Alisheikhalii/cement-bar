import { ComingSoon } from '@/components/ComingSoon';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.history };

export default function Page() {
  return <ComingSoon title={fa.nav.driver.history} />;
}
