import { ProfileView } from '@/components/driver/ProfileView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.driver.profile };

export default function Page() {
  return <ProfileView />;
}
