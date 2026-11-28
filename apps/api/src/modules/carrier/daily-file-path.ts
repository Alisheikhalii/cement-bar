import { isAbsolute, join, relative, resolve } from 'node:path';
import { DomainError } from '../../common/errors/domain-error';
import { isUuid } from './ids';

/** Sub-directory of UPLOAD_DIR shared with the factory upload (agent D storage contract). */
export const DAILY_FILES_SUBDIR = 'daily-files';

/** Absolute directory holding daily files. */
export function dailyFilesDir(uploadDir: string): string {
  return resolve(uploadDir, DAILY_FILES_SUBDIR);
}

/**
 * Resolves `fileKey` (server-generated UUID) under the daily-files directory and guarantees the
 * result stays inside it. Anything else is treated as a missing file (404), never as a path.
 */
export function resolveDailyFilePath(uploadDir: string, fileKey: string): string {
  if (!isUuid(fileKey)) throw new DomainError('NOT_FOUND');
  const base = dailyFilesDir(uploadDir);
  const full = resolve(join(base, fileKey));
  const rel = relative(base, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes('/') || rel.includes('\\')) {
    throw new DomainError('NOT_FOUND');
  }
  return full;
}

const CONTROL_AND_UNSAFE = /[\u0000-\u001f\u007f"\\/]/g; // eslint-disable-line no-control-regex

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback and the UTF-8 (Persian) original name. */
export function contentDisposition(originalName: string, fallback = 'daily-file.xlsx'): string {
  const clean = originalName.replace(CONTROL_AND_UNSAFE, '').trim() || fallback;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(clean)?.[0] ?? '';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '').replace(/[;%]/g, '').trim();
  const asciiName = ascii && ascii !== ext ? ascii : `${fallback.replace(/\.[^.]+$/, '')}${ext || '.xlsx'}`;
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}
