import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TableRow } from '@cb/shared';
import type { AuthUser } from '../../common/auth/auth.decorators';
import { scopedCarrier } from '../../common/auth/scoped';
import { ClockService } from '../../common/clock/clock.service';
import { DomainError } from '../../common/errors/domain-error';
import type { ParsedList } from '../../common/list/list-query';
import { PrismaService, TX_TIMEOUT_MS } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { contentDisposition, resolveDailyFilePath } from './daily-file-path';
import { assertUuid } from './ids';

const KB = 1024;

export interface DailyFileDownload {
  stream: ReadStream;
  size: number;
  disposition: string;
}

/** Storage root shared with the factory upload: <UPLOAD_DIR>/daily-files/<fileKey>. */
export function uploadDir(): string {
  return process.env.UPLOAD_DIR || './uploads';
}

@Injectable()
export class CarrierDailyFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, p: ParsedList): Promise<{ rows: TableRow[]; total: number }> {
    const scope = scopedCarrier(user);
    const and: Prisma.DailyFileWhereInput[] = [{ ...scope, deletedAt: null }, ...(p.where as Prisma.DailyFileWhereInput[])];
    if (p.q) and.push({ OR: [{ originalName: { contains: p.q, mode: 'insensitive' } }, { note: { contains: p.q, mode: 'insensitive' } }] });
    const where: Prisma.DailyFileWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.dailyFile.findMany({
        where,
        orderBy: p.orderBy.length ? (p.orderBy as Prisma.DailyFileOrderByWithRelationInput[]) : [{ forDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.dailyFile.count({ where }),
    ]);
    const rows = items.map<TableRow>((f) => ({
      id: f.id,
      forDate: f.forDate,
      originalName: f.originalName,
      sizeKb: Math.max(1, Math.ceil(f.size / KB)),
      note: f.note,
      createdAt: f.createdAt.toISOString(),
      seen: f.seenAt !== null,
      seenAt: f.seenAt?.toISOString() ?? null,
    }));
    return { rows, total };
  }

  /**
   * Opens the file for download (D6 / US-B2). The FIRST successful download records seenAt/seenBy
   * atomically (conditional update), with an audit entry; later downloads change nothing.
   */
  async download(user: AuthUser, id: string): Promise<DailyFileDownload> {
    const scope = scopedCarrier(user);
    const file = await this.prisma.dailyFile.findFirst({ where: { id: assertUuid(id), ...scope, deletedAt: null } });
    if (!file) throw new DomainError('NOT_FOUND');
    const path = resolveDailyFilePath(uploadDir(), file.fileKey);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path confined by resolveDailyFilePath
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new DomainError('NOT_FOUND');

    if (!file.seenAt) {
      await this.prisma.$transaction(
        async (tx) => {
          const at = this.clock.now();
          const res = await tx.dailyFile.updateMany({ where: { id: file.id, ...scope, seenAt: null }, data: { seenAt: at, seenBy: user.id } });
          if (res.count === 1) {
            await this.audit.log({ action: 'dailyFile.seen', entity: 'DailyFile', entityId: file.id, after: { seenAt: at } }, tx);
          }
        },
        { timeout: TX_TIMEOUT_MS },
      );
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path confined by resolveDailyFilePath
    return { stream: createReadStream(path), size: info.size, disposition: contentDisposition(file.originalName) };
  }
}
