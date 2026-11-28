import {
  cargoDescriptionSchema,
  goodsOwnerSchema,
  loadingConditionSchema,
  loadingLocationSchema,
  partySchema,
  type CarrierMasterKind,
} from '@cb/shared';
import type { ZodType } from 'zod';
import { faCarrier } from '@/i18n/carrier';

const f = faCarrier.master.fields;

export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'city' | 'digits';
  required?: boolean;
  ltr?: boolean;
}

export interface MasterFormDef {
  schema: ZodType;
  fields: FieldDef[];
  /** Parties carry an address list. */
  addresses?: boolean;
  empty: Record<string, unknown>;
}

/** Form layout per master table; validation is the SAME shared schema the API uses. */
export const MASTER_FORMS: Record<CarrierMasterKind, MasterFormDef> = {
  parties: {
    schema: partySchema,
    fields: [
      { name: 'nationalId', label: f.nationalId, type: 'digits', required: true, ltr: true },
      { name: 'title', label: f.title, type: 'text', required: true },
      { name: 'name', label: f.name, type: 'text', required: true },
      { name: 'economicCode', label: f.economicCode, type: 'digits', ltr: true },
    ],
    addresses: true,
    empty: { nationalId: '', title: '', name: '', economicCode: '', addresses: [] },
  },
  'goods-owners': {
    schema: goodsOwnerSchema,
    fields: [
      { name: 'name', label: f.name, type: 'text', required: true },
      { name: 'nationalId', label: f.nationalId, type: 'digits', required: true, ltr: true },
      { name: 'phone', label: f.phone, type: 'digits', ltr: true },
      { name: 'mobile', label: f.mobile, type: 'digits', ltr: true },
      { name: 'otherInfo', label: f.otherInfo, type: 'textarea' },
    ],
    empty: { name: '', nationalId: '', phone: '', mobile: '', otherInfo: '' },
  },
  'loading-locations': {
    schema: loadingLocationSchema,
    fields: [
      { name: 'warehouseType', label: f.warehouseType, type: 'text', required: true },
      { name: 'name', label: f.warehouseName, type: 'text', required: true },
      { name: 'nationalCode', label: f.nationalCode, type: 'digits', ltr: true },
      { name: 'cityId', label: f.cityId, type: 'city' },
      { name: 'address', label: f.address, type: 'text' },
      { name: 'nature', label: f.nature, type: 'text' },
      { name: 'phone', label: f.phone, type: 'digits', ltr: true },
    ],
    empty: { warehouseType: '', name: '', nationalCode: '', address: '', nature: '', phone: '' },
  },
  'cargo-descriptions': {
    schema: cargoDescriptionSchema,
    fields: [{ name: 'text', label: f.text, type: 'text', required: true }],
    empty: { text: '' },
  },
  'loading-conditions': {
    schema: loadingConditionSchema,
    fields: [
      { name: 'name', label: f.conditionName, type: 'text' },
      { name: 'condition', label: f.condition, type: 'textarea', required: true },
    ],
    empty: { name: '', condition: '' },
  },
};

/** Drops empty strings / nulls so optional fields are omitted (the API schemas are strict). */
export function cleanValues(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === '' || val === null || val === undefined) continue;
    if (Array.isArray(val)) out[k] = val.map((x) => (x && typeof x === 'object' ? cleanValues(x as Record<string, unknown>) : x));
    else out[k] = val;
  }
  return out;
}
