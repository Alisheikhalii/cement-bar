import type { Prisma } from '@prisma/client';
import {
  CARRIER_MASTER_COLUMNS,
  cargoDescriptionSchema,
  goodsOwnerSchema,
  loadingConditionSchema,
  loadingLocationSchema,
  partySchema,
  type CarrierMasterKind,
  type CellValue,
  type ColumnSpec,
} from '@cb/shared';
import type { ZodType } from 'zod';
import type { FieldCrypto } from '../../common/crypto/field-crypto';

/** Loose row shape shared by the five master tables. */
export type MasterRow = { id: string; carrierId: string | null; createdAt: Date } & Record<string, unknown>;

export interface MasterKindDef {
  kind: CarrierMasterKind;
  entity: string;
  columns: readonly ColumnSpec[];
  schema: ZodType<Record<string, unknown>>;
  /** Factory rows (carrierId = null) exist for this table and are visible read-only (P2-5). */
  hasShared: boolean;
  /** Columns searched by `q`. */
  search: string[];
  /** Input → Prisma data (encrypts national ids). */
  toData: (input: Record<string, unknown>, crypto: FieldCrypto) => Record<string, unknown>;
  /** Entity → editable values (decrypted). */
  toRecord: (row: MasterRow, decrypt: (enc: unknown) => string | null) => Record<string, unknown>;
  /** Entity → table cells (except rowNo / shared / createdAt). */
  toCells: (row: MasterRow, ctx: { decrypt: (enc: unknown) => string | null; cities: Map<number, string> }) => Record<string, CellValue>;
  label: (row: MasterRow) => string;
  /** Values safe to write into audit logs (no PII). */
  auditView: (data: Record<string, unknown>) => Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const opt = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const withoutPii = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('nationalId')));

const encId = (input: Record<string, unknown>, crypto: FieldCrypto) => {
  const nid = String(input.nationalId);
  return { nationalIdEnc: crypto.encrypt(nid), nationalIdHash: crypto.hash(nid) };
};

export const MASTER_KINDS: Record<CarrierMasterKind, MasterKindDef> = {
  parties: {
    kind: 'parties',
    entity: 'Party',
    columns: CARRIER_MASTER_COLUMNS.parties,
    schema: partySchema as unknown as ZodType<Record<string, unknown>>,
    hasShared: false,
    search: ['title', 'name', 'economicCode'],
    toData: (i, c) => ({
      title: i.title,
      name: i.name,
      ...encId(i, c),
      economicCode: opt(i.economicCode),
      addresses: (i.addresses ?? []) as Prisma.InputJsonValue,
    }),
    toRecord: (r, dec) => ({
      title: r.title,
      name: r.name,
      nationalId: dec(r.nationalIdEnc),
      economicCode: r.economicCode,
      addresses: r.addresses,
    }),
    toCells: (r, { decrypt }) => ({
      title: str(r.title),
      name: str(r.name),
      nationalId: decrypt(r.nationalIdEnc),
      economicCode: str(r.economicCode),
      addressCount: Array.isArray(r.addresses) ? r.addresses.length : 0,
    }),
    label: (r) => `${String(r.title)} — ${String(r.name)}`,
    auditView: withoutPii,
  },
  'goods-owners': {
    kind: 'goods-owners',
    entity: 'GoodsOwner',
    columns: CARRIER_MASTER_COLUMNS['goods-owners'],
    schema: goodsOwnerSchema as unknown as ZodType<Record<string, unknown>>,
    hasShared: false,
    search: ['name', 'phone', 'mobile'],
    toData: (i, c) => ({
      name: i.name,
      ...encId(i, c),
      phone: opt(i.phone),
      mobile: opt(i.mobile),
      otherInfo: opt(i.otherInfo),
    }),
    toRecord: (r, dec) => ({ name: r.name, nationalId: dec(r.nationalIdEnc), phone: r.phone, mobile: r.mobile, otherInfo: r.otherInfo }),
    toCells: (r, { decrypt }) => ({
      name: str(r.name),
      nationalId: decrypt(r.nationalIdEnc),
      phone: str(r.phone),
      mobile: str(r.mobile),
      otherInfo: str(r.otherInfo),
    }),
    label: (r) => String(r.name),
    auditView: (d) => withoutPii({ ...d, mobile: d.mobile ? '***' : null }),
  },
  'loading-locations': {
    kind: 'loading-locations',
    entity: 'LoadingLocation',
    columns: CARRIER_MASTER_COLUMNS['loading-locations'],
    schema: loadingLocationSchema as unknown as ZodType<Record<string, unknown>>,
    hasShared: true,
    search: ['name', 'warehouseType', 'address'],
    toData: (i) => ({
      warehouseType: i.warehouseType,
      name: i.name,
      nationalCode: opt(i.nationalCode),
      nature: opt(i.nature),
      cityId: typeof i.cityId === 'number' ? i.cityId : null,
      address: opt(i.address),
      phone: opt(i.phone),
    }),
    toRecord: (r) => ({
      warehouseType: r.warehouseType,
      name: r.name,
      nationalCode: r.nationalCode,
      nature: r.nature,
      cityId: r.cityId,
      address: r.address,
      phone: r.phone,
    }),
    toCells: (r, { cities }) => ({
      warehouseType: str(r.warehouseType),
      name: str(r.name),
      nationalCode: str(r.nationalCode),
      nature: str(r.nature),
      city: typeof r.cityId === 'number' ? (cities.get(r.cityId) ?? null) : null,
      address: str(r.address),
      phone: str(r.phone),
    }),
    label: (r) => String(r.name),
    auditView: (d) => d,
  },
  'cargo-descriptions': {
    kind: 'cargo-descriptions',
    entity: 'CargoDescription',
    columns: CARRIER_MASTER_COLUMNS['cargo-descriptions'],
    schema: cargoDescriptionSchema as unknown as ZodType<Record<string, unknown>>,
    hasShared: true,
    search: ['text'],
    toData: (i) => ({ text: i.text }),
    toRecord: (r) => ({ text: r.text }),
    toCells: (r) => ({ text: str(r.text) }),
    label: (r) => String(r.text),
    auditView: (d) => d,
  },
  'loading-conditions': {
    kind: 'loading-conditions',
    entity: 'LoadingCondition',
    columns: CARRIER_MASTER_COLUMNS['loading-conditions'],
    schema: loadingConditionSchema as unknown as ZodType<Record<string, unknown>>,
    hasShared: true,
    search: ['name', 'condition'],
    toData: (i) => ({ name: opt(i.name), condition: i.condition }),
    toRecord: (r) => ({ name: r.name, condition: r.condition }),
    toCells: (r) => ({ name: str(r.name), condition: str(r.condition) }),
    label: (r) => (opt(r.name) ? `${String(r.name)} — ${String(r.condition)}` : String(r.condition)),
    auditView: (d) => d,
  },
};
