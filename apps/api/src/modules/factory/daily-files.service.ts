import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { DailyFile, Prisma } from '@prisma/client';
import { DAILY_FILE_MAX_BYTES, type DailyFileDto, type TableRow } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedTenant } from '../../common/auth/scoped';
import type { ParsedList } from '../../common/list/list-query';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { checkXlsxUpload } from './file-check';
import { ci, isoOrNull } from './factory.util';

const DEFAULT_UPLOAD_DIR = './uploads';

/**
 * Storage contract shared with the carrier slice (downloads):
 *   bytes at  path.join(UPLOAD_DIR, 'daily-files', fileKey)   with fileKey = randomUUID()
 * No user input is ever part of the path; `originalName` is metadata only.
 */
export function dailyFilesDir(): string {
  return resolve(join(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR, 'daily-files'));
}

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const toDto = (f: DailyFile): DailyFileDto => ({
  id: f.id,
  carrierId: f.carrierId,
  forDate: f.forDate,
  originalName: f.originalName,
  size: f.size,
  sha256: f.sha256,
  note: f.note,
  createdAt: f.createdAt.toISOString(),
});

@Injectable()
export class DailyFilesService {
  private readonly logger = new Logger(DailyFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const where: Prisma.DailyFileWhereInput = {
      ...scopedTenant(user),
      deletedAt: null,
      AND: p.where as Prisma.DailyFileWhereInput[],
      ...(p.q ? { OR: [{ originalName: ci(p.q) }, { note: ci(p.q) }, { carrier: { name: ci(p.q) } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.dailyFile.findMany({
        where,
        orderBy: [...(p.orderBy as Prisma.DailyFileOrderByWithRelationInput[]), { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: { carrier: { select: { name: true } } },
      }),
      this.prisma.dailyFile.count({ where }),
    ]);
    const rows = items.map((f) => ({
      id: f.id,
      forDate: f.forDate,
      carrierName: f.carrier.name,
      originalName: f.originalName,
      size: f.size,
      note: f.note,
      createdAt: f.createdAt.toISOString(),
      seenAt: isoOrNull(f.seenAt),
    }));
    return { rows, total };
  }

  /**
   * Validates (extension, MIME, magic bytes, size), writes the bytes under a random key, then records the
   * row + audit in one transaction. If the DB write fails the stored bytes are removed again.
   * `carrierId` is the TARGET carrier chosen by the factory and must belong to the caller's tenant.
   */
  async upload(
    user: AuthUser,
    meta: { carrierId: string; forDate: string; note?: string },
    file: UploadedFileLike | undefined,
  ): Promise<DailyFileDto> {
    const checked = checkXlsxUpload(file, DAILY_FILE_MAX_BYTES);
    const carrier = await this.prisma.carrier.findFirst({ where: { id: meta.carrierId, ...scopedTenant(user), deletedAt: null } });
    if (!carrier) throw new DomainError('NOT_FOUND');

    const dir = dailyFilesDir();
    const fileKey = randomUUID();
    const target = join(dir, fileKey);
    // Path = configured dir + server-generated UUID only (no user input).
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(dir, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(target, file!.buffer, { flag: 'wx', mode: 0o640 });
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          const f = await tx.dailyFile.create({
            data: {
              tenantId: carrier.tenantId,
              carrierId: carrier.id,
              forDate: meta.forDate,
              fileKey,
              originalName: checked.originalName,
              size: checked.size,
              sha256: checked.sha256,
              note: meta.note ?? null,
              uploadedBy: user.id,
            },
          });
          await this.audit.log(
            { action: 'daily_file.uploaded', entity: 'DailyFile', entityId: f.id, after: { ...toDto(f), carrierName: carrier.name } },
            tx,
          );
          return f;
        },
        { timeout: TX_TIMEOUT_MS },
      );
      return toDto(row);
    } catch (e) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await unlink(target).catch((err: unknown) => this.logger.warn(`orphan upload ${fileKey}: ${(err as Error).message}`));
      throw e;
    }
  }
}
