import { CarrierDetail } from '@/components/factory/CarrierDetail';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.factory.carriers };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CarrierDetail id={id} />;
}
