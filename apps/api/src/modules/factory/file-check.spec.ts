import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkXlsxUpload, sanitizeOriginalName, XLSX_MIME } from './file-check';

let xlsx: Buffer;
beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('s').addRow(['a', 1]);
  xlsx = Buffer.from(await wb.xlsx.writeBuffer());
});

const file = (over: Partial<{ originalname: string; mimetype: string; buffer: Buffer }> = {}) => {
  const buffer = over.buffer ?? xlsx;
  return { originalname: 'روزانه.xlsx', mimetype: XLSX_MIME, ...over, buffer, size: buffer.length };
};

describe('checkXlsxUpload', () => {
  it('accepts a real xlsx and returns sha256 + clean name', () => {
    const r = checkXlsxUpload(file(), 1024 * 1024);
    expect(r.originalName).toBe('روزانه.xlsx');
    expect(r.sha256).toBe(createHash('sha256').update(xlsx).digest('hex'));
    expect(r.size).toBe(xlsx.length);
  });

  it.each([
    ['wrong extension', { originalname: 'a.xls' }],
    ['disallowed mime', { mimetype: 'text/html' }],
    ['bad magic bytes', { buffer: Buffer.from('<html>not a zip</html>') }],
    ['zip that is not OOXML', { buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('plain.txt')]) }],
    ['empty file', { buffer: Buffer.alloc(0) }],
  ])('rejects %s with FILE_INVALID', (_why, over) => {
    expect(() => checkXlsxUpload(file(over), 1024 * 1024)).toThrow(expect.objectContaining({ code: 'FILE_INVALID' }));
  });

  it('rejects missing file', () => {
    expect(() => checkXlsxUpload(undefined, 10)).toThrow(expect.objectContaining({ code: 'FILE_INVALID' }));
  });

  it('rejects oversize with FILE_TOO_LARGE', () => {
    expect(() => checkXlsxUpload(file(), 100)).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
  });
});

describe('sanitizeOriginalName', () => {
  it('drops path components and control chars', () => {
    expect(sanitizeOriginalName('..\\..\\evil/\u0000x.xlsx')).toBe('x.xlsx');
    expect(sanitizeOriginalName('')).toBe('file.xlsx');
  });
});
