import { GroupsView } from '@/components/carrier/queue/GroupsView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.groups };

export default function Page() {
  return <GroupsView />;
}
