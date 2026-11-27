import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CalendarClock,
  ClipboardList,
  Database,
  FileText,
  FolderOpen,
  Gauge,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  PackageSearch,
  Radio,
  RefreshCcw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Ticket,
  Truck,
  UserCircle,
  Users,
  UsersRound,
  Warehouse,
  XCircle,
} from 'lucide-react';
import type { Role } from '@cb/shared';
import { fa } from '@/i18n/fa';

export type Panel = 'factory' | 'carrier' | 'driver';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const PANEL_ROLE: Record<Panel, Role> = {
  factory: 'FACTORY_OPERATOR',
  carrier: 'CARRIER_OPERATOR',
  driver: 'DRIVER',
};

const g = fa.nav.groups;
const f = fa.nav.factory;
const c = fa.nav.carrier;
const d = fa.nav.driver;

export const NAV: Record<Panel, NavGroup[]> = {
  factory: [
    { title: g.overview, items: [{ href: '/factory', label: fa.nav.dashboard, icon: LayoutDashboard }] },
    {
      title: g.operations,
      items: [
        { href: '/factory/daily-files', label: f.dailyFiles, icon: FolderOpen },
        { href: '/factory/halls', label: f.halls, icon: Warehouse },
        { href: '/factory/monitor', label: f.monitor, icon: Radio },
      ],
    },
    {
      title: g.people,
      items: [
        { href: '/factory/carriers', label: f.carriers, icon: Building2 },
        { href: '/factory/drivers', label: f.drivers, icon: Users },
      ],
    },
    {
      title: g.settings,
      items: [
        { href: '/factory/policies', label: f.policies, icon: Settings2 },
        { href: '/factory/master-data', label: f.masterData, icon: Database },
        { href: '/factory/reports', label: f.reports, icon: FileText },
        { href: '/factory/audit', label: f.audit, icon: ShieldCheck },
      ],
    },
  ],
  carrier: [
    { title: g.overview, items: [{ href: '/carrier', label: fa.nav.dashboard, icon: LayoutDashboard }] },
    {
      title: g.operations,
      items: [
        { href: '/carrier/daily-files', label: c.dailyFiles, icon: FolderOpen },
        { href: '/carrier/announcements', label: c.announcements, icon: Megaphone },
        { href: '/carrier/bulk-live', label: c.bulkLive, icon: Gauge },
        { href: '/carrier/cancel-requests', label: c.cancelRequests, icon: XCircle },
        { href: '/carrier/permits', label: c.permits, icon: ScrollText },
      ],
    },
    {
      title: g.people,
      items: [
        { href: '/carrier/drivers', label: c.drivers, icon: Users },
        { href: '/carrier/groups', label: c.groups, icon: UsersRound },
      ],
    },
    {
      title: g.settings,
      items: [
        { href: '/carrier/master-data', label: c.masterData, icon: Database },
        { href: '/carrier/reports', label: c.reports, icon: FileText },
      ],
    },
  ],
  driver: [
    { title: g.overview, items: [{ href: '/driver', label: fa.nav.dashboard, icon: LayoutDashboard }] },
    {
      title: g.hall,
      items: [
        { href: '/driver/bag-hall', label: d.bagHall, icon: Ticket },
        { href: '/driver/bulk-hall', label: d.bulkHall, icon: RefreshCcw },
        { href: '/driver/loads', label: d.loads, icon: PackageSearch },
        { href: '/driver/reservations', label: d.reservations, icon: ListChecks },
        { href: '/driver/halls', label: d.halls, icon: Warehouse },
        { href: '/driver/hall-hours', label: d.hallHours, icon: CalendarClock },
        { href: '/driver/history', label: d.history, icon: History },
      ],
    },
    {
      title: g.account,
      items: [
        { href: '/driver/profile', label: d.profile, icon: UserCircle },
        { href: '/driver/companies', label: d.companies, icon: Landmark },
      ],
    },
  ],
};

/** Driver mobile bottom navigation (PRD US-D11), visual order right→left in RTL. */
export const DRIVER_BOTTOM_NAV: NavItem[] = [
  { href: '/driver/history', label: d.history, icon: ClipboardList },
  { href: '/driver/loads', label: d.loads, icon: Truck },
  { href: '/driver/halls', label: d.halls, icon: Warehouse },
  { href: '/driver/bag-hall', label: d.bagHall, icon: Ticket },
];

/** Exact match for panel roots, prefix match otherwise. */
export function isActive(pathname: string, href: string): boolean {
  const isRoot = href.split('/').filter(Boolean).length === 1;
  return isRoot ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
