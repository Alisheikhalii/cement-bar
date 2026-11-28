import { HallDetail } from '@/components/factory/HallDetail';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.factory.halls };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HallDetail id={id} />;
}
