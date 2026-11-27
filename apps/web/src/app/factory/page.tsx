'use client';
import { Building2, ListChecks, Megaphone, Users } from 'lucide-react';
import { OperatorDashboard } from '@/components/dashboard/OperatorDashboard';
import { fa } from '@/i18n/fa';

const [k1, k2, k3, k4] = fa.dashboard.factoryKpis;

export default function FactoryDashboard() {
  return (
    <OperatorDashboard
      panelTitle={fa.roles.factory}
      kpis={[
        { title: k1, icon: Megaphone, tone: 'primary' },
        { title: k2, icon: ListChecks, tone: 'success' },
        { title: k3, icon: Building2, tone: 'info' },
        { title: k4, icon: Users, tone: 'purple' },
      ]}
    />
  );
}
