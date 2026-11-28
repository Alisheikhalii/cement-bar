import { randomBytes, randomInt } from 'node:crypto';
import type { DriverStatus } from '@prisma/client';
import { hashPassword } from '../../src/modules/auth/password.service';
import type { TestApp } from './app';
import { randomMobile, validNationalId, type Fixture } from './fixtures';

const isoDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Random structured plate (body form) + its normalised DB form. */
export function randomPlate(): {
  body: { two: string; letter: 'ع'; three: string; iran: string };
  normalized: string;
} {
  const two = String(randomInt(10, 100));
  const three = String(randomInt(100, 1000));
  const iran = String(randomInt(10, 100));
  return { body: { two, letter: 'ع', three, iran }, normalized: `${two}ع${three}-${iran}` };
}

export function randomSmartCard(): string {
  return `SC${randomBytes(5).toString('hex')}`;
}

export interface VehicleOpts {
  smartCardExpiry: string;
  inspectionExpiry: string;
}

export async function addVehicle(
  t: TestApp,
  fx: Fixture,
  driverId: string,
  o: VehicleOpts,
): Promise<{ id: string; plate: string; smartCardNo: string }> {
  const plate = randomPlate().normalized;
  const smartCardNo = randomSmartCard();
  const v = await t.prisma.vehicle.create({
    data: {
      tenantId: fx.tenantId,
      driverId,
      smartCardNo,
      plate,
      loaderTypeId: fx.loaderTypeId,
      smartCardExpiry: isoDate(o.smartCardExpiry),
      inspectionExpiry: isoDate(o.inspectionExpiry),
    },
  });
  return { id: v.id, plate, smartCardNo };
}

export interface ExtraDriverOpts {
  status?: DriverStatus;
  carrierId?: string;
  healthCardExpiry?: string;
  decisionNote?: string;
  blockReason?: string;
}

/** Another driver in the fixture tenant (password = fixtures PASSWORD). */
export async function addDriver(
  t: TestApp,
  fx: Fixture,
  password: string,
  o: ExtraDriverOpts = {},
): Promise<{ id: string; userId: string; mobile: string; nationalId: string }> {
  const mobile = randomMobile();
  const nationalId = validNationalId();
  const user = await t.prisma.user.create({
    data: {
      tenantId: fx.tenantId,
      role: 'DRIVER',
      mobile,
      displayName: 'راننده دوم',
      passwordHash: await hashPassword(password),
    },
  });
  const d = await t.prisma.driver.create({
    data: {
      tenantId: fx.tenantId,
      userId: user.id,
      carrierId: o.carrierId ?? fx.carrierId,
      status: o.status ?? 'APPROVED',
      firstName: 'ب',
      lastName: 'راننده',
      nationalIdEnc: t.crypto.encrypt(nationalId),
      nationalIdHash: t.crypto.hash(`${nationalId}-${randomBytes(4).toString('hex')}`),
      licenseNo: `L${randomBytes(3).toString('hex')}`,
      licenseIssueDate: isoDate('2016-01-01'),
      birthCityId: fx.cityId,
      healthCardExpiry: isoDate(o.healthCardExpiry ?? '2030-01-01'),
      decisionNote: o.decisionNote ?? null,
      blockReason: o.blockReason ?? null,
    },
  });
  return { id: d.id, userId: user.id, mobile, nationalId };
}
