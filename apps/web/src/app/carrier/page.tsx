'use client';
import { ListChecks, Megaphone, UserCheck, XCircle } from 'lucide-react';
import { OperatorDashboard } from '@/components/dashboard/OperatorDashboard';
import { fa } from '@/i18n/fa';

const [k1, k2, k3, k4] = fa.dashboard.carrierKpis;

export default function CarrierDashboard() {
  return (
    <OperatorDashboard
      panelTitle={fa.roles.carrier}
      kpis={[
        { title: k1, icon: Megaphone, tone: 'primary' },
        { title: k2, icon: ListChecks, tone: 'success' },
        { title: k3, icon: UserCheck, tone: 'warning' },
        { title: k4, icon: XCircle, tone: 'danger' },
      ]}
    />
  );
}
