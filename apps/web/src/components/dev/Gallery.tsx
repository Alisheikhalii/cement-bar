'use client';
import { useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { Package, Plus, Scale, ShoppingBag, Truck, Trash2 } from 'lucide-react';
import type { PlateParts } from '@cb/shared';
import {
  Badge,
  Button3D,
  Card,
  Checkbox,
  Countdown,
  CredentialCard,
  DataTable,
  EmptyState,
  Field,
  FormSection,
  IconButton3D,
  KpiCard,
  LoadCard,
  Modal,
  NumberInput,
  PlateInput,
  Select,
  Skeleton,
  Switch,
  Tabs,
  TextInput,
  Textarea,
  useToast,
  JalaliDatePicker,
} from '@cb/ui';
import { useServerClock } from '@/lib/server-clock';
import { DEMO_ROWS, DEMO_STATUS, demoColumns, type DemoRow } from './fixtures';

const PAGE_SIZE = 8;
const COUNTDOWN_MS = 5 * 60_000;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-space-sm">
      <h2 className="text-headline-md text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function TableDemo() {
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const columns = useMemo<ColumnDef<DemoRow, unknown>[]>(
    () => [
      ...demoColumns,
      {
        accessorKey: 'status',
        header: 'وضعیت',
        cell: (c) => {
          const s = DEMO_STATUS[c.getValue() as DemoRow['status']];
          return <Badge tone={s.tone}>{s.label}</Badge>;
        },
        meta: { filter: <p className="text-body-sm text-text-secondary">فیلتر نمونه</p> },
      },
    ],
    [],
  );
  const rows = empty ? [] : DEMO_ROWS.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      loading={loading}
      sorting={sorting}
      onSortingChange={setSorting}
      selectable
      selectedIds={selected}
      onSelectedIdsChange={setSelected}
      rowTone={(r) => DEMO_STATUS[r.status].tone}
      pagination={{ page, pageSize: PAGE_SIZE, total: empty ? 0 : DEMO_ROWS.length, onPageChange: setPage }}
      toolbar={
        <div className="flex flex-wrap gap-space-xs">
          <Switch id="t-loading" checked={loading} onCheckedChange={setLoading} label="loading" />
          <Switch id="t-empty" checked={empty} onCheckedChange={setEmpty} label="empty" />
        </div>
      }
    />
  );
}

export function Gallery() {
  const { toast } = useToast();
  const { now } = useServerClock();
  const [modal, setModal] = useState(false);
  const [num, setNum] = useState('');
  const [sel, setSel] = useState<string>('');
  const [chk, setChk] = useState(false);
  const [date, setDate] = useState('');
  const [plate, setPlate] = useState<PlateParts>({ two: '', letter: '', three: '', iran: '' });
  const [target] = useState(() => new Date(now() + COUNTDOWN_MS));

  return (
    <main id="main" className="mx-auto flex max-w-6xl flex-col gap-space-xl p-margin-mobile md:p-margin">
      <h1 className="text-display-hero text-text-primary">UI Gallery</h1>

      <Section title="Button3D / IconButton3D">
        <div className="flex flex-wrap items-center gap-space-sm">
          {(['primary', 'success', 'danger', 'warning', 'neutral', 'ghost'] as const).map((v) => (
            <Button3D key={v} variant={v}>
              {v}
            </Button3D>
          ))}
          <Button3D loading>loading</Button3D>
          <Button3D disabled>disabled</Button3D>
          <Button3D size="sm">sm</Button3D>
          <Button3D size="lg" icon={<Plus className="size-5" aria-hidden />}>
            lg
          </Button3D>
          <IconButton3D label="افزودن" icon={<Plus className="size-5" aria-hidden />} variant="primary" />
          <IconButton3D label="حذف" icon={<Trash2 className="size-5" aria-hidden />} variant="danger" />
        </div>
        <Button3D fullWidth variant="success">
          fullWidth
        </Button3D>
      </Section>

      <Section title="KpiCard / Card / Badge">
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="اعلام بار امروز" value="۱۲۸" caption="نمونه" icon={<Package className="size-5" />} />
          <KpiCard title="رزرو فعال" value="۴۲" tone="success" icon={<Truck className="size-5" />} />
          <KpiCard title="در انتظار" value="۷" tone="warning" />
          <KpiCard title="لغو" value="۲" tone="danger" />
        </div>
        <Card interactive>Card (interactive)</Card>
        <div className="flex flex-wrap gap-space-xs">
          {(['primary', 'success', 'warning', 'danger', 'info', 'purple', 'neutral'] as const).map((t) => (
            <Badge key={t} tone={t}>
              {t}
            </Badge>
          ))}
          <Badge tone="danger" solid>
            solid
          </Badge>
        </div>
      </Section>

      <Section title="Form controls">
        <Card>
          <FormSection title="بخش نمونه" description="توضیح کوتاه">
            <Field label="متن" htmlFor="g-text" required hint="راهنما">
              <TextInput id="g-text" />
            </Field>
            <Field label="عدد (ارقام فارسی مجاز)" htmlFor="g-num" error={num === '0' ? 'خطای نمونه' : undefined}>
              <NumberInput id="g-num" value={num} onValueChange={setNum} />
            </Field>
            <Field label="انتخاب" htmlFor="g-sel">
              <Select
                id="g-sel"
                value={sel}
                onValueChange={setSel}
                options={[
                  { value: 'a', label: 'تریلی کفی' },
                  { value: 'b', label: 'تریلی بغل‌دار' },
                ]}
              />
            </Field>
            <Field label="تاریخ شمسی" htmlFor="g-date" hint={date || '—'}>
              <JalaliDatePicker id="g-date" value={date} onChange={setDate} />
            </Field>
            <Field label="پلاک" htmlFor="g-plate">
              <PlateInput id="g-plate" value={plate} onChange={setPlate} />
            </Field>
            <Field label="توضیحات" htmlFor="g-ta">
              <Textarea id="g-ta" />
            </Field>
            <div className="flex flex-wrap gap-space-md">
              <Switch id="g-sw" checked={chk} onCheckedChange={setChk} label="سوییچ" />
              <Checkbox id="g-cb" checked={chk} onCheckedChange={setChk} label="چک‌باکس" />
            </div>
          </FormSection>
        </Card>
      </Section>

      <Section title="Tabs / Modal / Toast">
        <Tabs
          items={[
            { value: 'a', label: 'تب اول', content: <Card>محتوای اول</Card> },
            { value: 'b', label: 'تب دوم', content: <Card>محتوای دوم</Card> },
          ]}
        />
        <div className="flex flex-wrap gap-space-sm">
          <Button3D onClick={() => setModal(true)}>Modal</Button3D>
          <Button3D variant="success" onClick={() => toast({ tone: 'success', title: 'انجام شد' })}>
            Toast
          </Button3D>
          <Button3D variant="danger" onClick={() => toast({ tone: 'danger', title: 'خطا', description: 'توضیح خطا' })}>
            Toast error
          </Button3D>
        </div>
        <Modal
          open={modal}
          onOpenChange={setModal}
          title="مودال نمونه"
          subtitle="زیرعنوان"
          icon={<Package className="size-5" />}
          footer={<Button3D onClick={() => setModal(false)}>تأیید</Button3D>}
        >
          <p className="text-body-md">بدنه قابل اسکرول.</p>
        </Modal>
      </Section>

      <Section title="Countdown / Skeleton / EmptyState">
        <Card className="flex flex-wrap items-center gap-space-lg">
          <Countdown target={target} now={now} />
          <div className="flex-1">
            <Skeleton className="mb-2 w-1/2" />
            <Skeleton />
          </div>
        </Card>
        <Card>
          <EmptyState />
        </Card>
      </Section>

      <Section title="LoadCard / CredentialCard">
        <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 lg:grid-cols-3">
          <LoadCard
            status={{ label: 'آزاد', tone: 'success' }}
            reference="NY-9821"
            origin="سیمان نی‌ریز"
            destination="شیراز"
            specs={[
              { icon: <Package className="size-4" />, label: 'محموله', value: 'سیمان تیپ ۲' },
              { icon: <Scale className="size-4" />, label: 'وزن', value: '۲۵ تن' },
              { icon: <ShoppingBag className="size-4" />, label: 'بسته‌بندی', value: 'پاکتی' },
              { icon: <Truck className="size-4" />, label: 'بارگیر', value: 'تریلی کفی' },
            ]}
            fareRial={36_500_000n}
            ctaLabel="رزرو بار"
            onCta={() => toast({ title: 'رزرو' })}
          />
          <LoadCard
            status={{ label: 'آزاد', tone: 'success' }}
            origin="سیمان نی‌ریز"
            destination="سیرجان"
            specs={[{ label: 'وزن', value: '۲۴ تن' }]}
            fareRial="41000000"
            ctaLabel="رزرو بار"
            reserved
          />
        </div>
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-5">
          <CredentialCard title="بیش از ۶۰ روز" expiryIso="2027-06-01" daysLeft={186} />
          <CredentialCard title="۱۵ تا ۶۰ روز" expiryIso="2027-01-10" daysLeft={44} />
          <CredentialCard title="کمتر از ۱۵" expiryIso="2026-12-05" daysLeft={8} />
          <CredentialCard title="منقضی" expiryIso="2026-11-01" daysLeft={-26} />
          <CredentialCard title="نامشخص" />
        </div>
      </Section>

      <Section title="DataTable">
        <TableDemo />
      </Section>
    </main>
  );
}
