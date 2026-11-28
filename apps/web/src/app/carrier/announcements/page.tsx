import { AnnouncementsPage } from '@/components/announcements/AnnouncementsPage';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.announcements };

export default function Page() {
  return <AnnouncementsPage />;
}
