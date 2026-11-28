import { createHash } from 'node:crypto';
import { DomainError } from '../../common/errors/domain-error';

/** Pure upload checks for daily files (SPEC §6: xlsx only, magic bytes, random server-side name). */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Browsers/OSes report xlsx with any of these. */
export const ALLOWED_MIME = new Set([XLSX_MIME, 'application/octet-stream', 'application/zip', 'application/x-zip-compressed']);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Every OOXML package has this part; its name is stored in clear in the zip headers. */
const OOXML_MARKER = Buffer.from('[Content_Types].xml', 'ascii');
const MAX_NAME = 200;

/** Display name only (never used in a path): basename, no control chars, bounded length. */
export function sanitizeOriginalName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- strip control characters from user-supplied filenames
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean.slice(-MAX_NAME) || 'file.xlsx';
}

export interface CheckedFile {
  originalName: string;
  size: number;
  sha256: string;
}

/** Throws FILE_INVALID / FILE_TOO_LARGE; returns metadata for a valid xlsx. */
export function checkXlsxUpload(
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  maxBytes: number,
): CheckedFile {
  if (!file || !file.buffer || file.size === 0) throw new DomainError('FILE_INVALID');
  if (file.size > maxBytes || file.buffer.length > maxBytes) throw new DomainError('FILE_TOO_LARGE');
  const originalName = sanitizeOriginalName(file.originalname);
  if (!originalName.toLowerCase().endsWith('.xlsx')) throw new DomainError('FILE_INVALID', { reason: 'extension' });
  if (!ALLOWED_MIME.has(file.mimetype.toLowerCase())) throw new DomainError('FILE_INVALID', { reason: 'mime' });
  if (!file.buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) throw new DomainError('FILE_INVALID', { reason: 'magic' });
  if (!file.buffer.includes(OOXML_MARKER)) throw new DomainError('FILE_INVALID', { reason: 'not_ooxml' });
  return { originalName, size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') };
}
