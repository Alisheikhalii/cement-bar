import { MasterDataView } from '@/components/carrier/MasterDataView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.carrier.masterData };

export default function Page() {
  return <MasterDataView />;
}
