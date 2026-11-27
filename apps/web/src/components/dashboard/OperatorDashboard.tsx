'use client';
import type { LucideIcon } from 'lucide-react';
import { KpiCard, type Tone } from '@cb/ui';
import { fa } from '@/i18n/fa';
import { useMe } from '@/lib/auth';

export interface KpiDef {
  title: string;
  icon: LucideIcon;
  tone: Tone;
}

/** Shared factory/carrier dashboard skeleton: welcome line + up to 4 KPIs (values arrive in later phases). */
export function OperatorDashboard({ panelTitle, kpis }: { panelTitle: string; kpis: KpiDef[] }) {
  const me = useMe();
  const name = me.data?.carrier ? `${me.data.displayName} (${me.data.carrier.name})` : me.data?.displayName;
  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <p className="text-label-md text-text-muted">{panelTitle}</p>
        <h1 className="text-headline-lg-mobile text-text-primary md:text-headline-lg">
          {name ? fa.dashboard.welcome(name) : fa.dashboard.welcomeFallback}
        </h1>
      </div>
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        {kpis.slice(0, 4).map((k) => (
          <KpiCard
            key={k.title}
            title={k.title}
            value="—"
            caption={fa.common.kpiPending}
            tone={k.tone}
            icon={<k.icon className="size-5" />}
          />
        ))}
      </div>
    </div>
  );
}
