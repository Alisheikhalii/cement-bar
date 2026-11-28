import { MonitorView } from '@/components/factory/queue/MonitorView';
import { fa } from '@/i18n/fa';

export const metadata = { title: fa.nav.factory.monitor };

export default function Page() {
  return <MonitorView />;
}
