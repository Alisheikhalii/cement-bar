import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RegisterDriverInput } from '@cb/shared';
import { FieldCrypto } from '../../common/crypto/field-crypto';
import { DomainError } from '../../common/errors/domain-error';
import { uniqueViolationField } from '../../common/errors/error-mapping';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './password.service';

/** Maps unique-constraint targets (column list or constraint name) to API field names. */
const UNIQUE_FIELD_MAP: [RegExp, string][] = [
  [/mobile/i, 'mobile'],
  [/nationalIdHash/i, 'nationalId'],
  [/smartCardNo/i, 'vehicle.smartCardNo'],
  [/plate/i, 'vehicle.plate'],
  [/username/i, 'username'],
];

export function conflictField(target: string | undefined): string | undefined {
  if (!target) return undefined;
  return UNIQUE_FIELD_MAP.find(([re]) => re.test(target))?.[1];
}

const isoToDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

@Injectable()
export class RegisterDriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterDriverInput): Promise<{ id: string; status: 'PENDING' }> {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id: input.carrierId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!carrier) throw new DomainError('VALIDATION_FAILED', { field: 'carrierId' });
    const tenantId = carrier.tenantId;
    await this.assertReferences(tenantId, input);

    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.create({
            data: {
              tenantId,
              role: 'DRIVER',
              mobile: input.mobile,
              displayName: `${input.firstName} ${input.lastName}`,
              passwordHash,
            },
          });
          const driver = await tx.driver.create({
            data: {
              tenantId,
              userId: user.id,
              carrierId: carrier.id,
              status: 'PENDING',
              firstName: input.firstName,
              lastName: input.lastName,
              nationalIdEnc: this.crypto.encrypt(input.nationalId),
              nationalIdHash: this.crypto.hash(input.nationalId),
              licenseNo: input.licenseNo,
              licenseIssueDate: isoToDate(input.licenseIssueDate),
              birthCityId: input.birthCityId,
              healthCardExpiry: isoToDate(input.healthCardExpiry),
              createdBy: user.id,
            },
          });
          const vehicle = await tx.vehicle.create({
            data: {
              tenantId,
              driverId: driver.id,
              smartCardNo: input.vehicle.smartCardNo,
              plate: input.vehicle.plate,
              loaderTypeId: input.vehicle.loaderTypeId,
              smartCardExpiry: isoToDate(input.vehicle.smartCardExpiry),
              inspectionExpiry: isoToDate(input.vehicle.inspectionExpiry),
              active: true,
              createdBy: user.id,
            },
          });
          await this.audit.log(
            {
              action: 'driver.register',
              entity: 'Driver',
              entityId: driver.id,
              tenantId,
              actor: { id: user.id, role: 'DRIVER', tenantId },
              // PII (mobile, national id) deliberately excluded from audit payload.
              after: { carrierId: carrier.id, vehicleId: vehicle.id, plate: vehicle.plate, status: 'PENDING' },
            },
            tx,
          );
          return { id: driver.id, status: 'PENDING' as const };
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DomainError('CONFLICT', { field: conflictField(uniqueViolationField(e)) ?? 'unknown' });
      }
      throw e;
    }
  }

  private async assertReferences(tenantId: string, input: RegisterDriverInput): Promise<void> {
    const [loader, city] = await Promise.all([
      this.prisma.loaderType.findFirst({
        where: { id: input.vehicle.loaderTypeId, tenantId, active: true, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.city.findUnique({ where: { id: input.birthCityId }, select: { id: true } }),
    ]);
    if (!loader) throw new DomainError('VALIDATION_FAILED', { field: 'vehicle.loaderTypeId' });
    if (!city) throw new DomainError('VALIDATION_FAILED', { field: 'birthCityId' });
  }
}
