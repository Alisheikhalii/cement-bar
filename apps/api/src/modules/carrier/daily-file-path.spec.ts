import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentDisposition, resolveDailyFilePath } from './daily-file-path';

const KEY = '3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b';

describe('resolveDailyFilePath', () => {
  it('resolves a UUID key inside <UPLOAD_DIR>/daily-files', () => {
    expect(resolveDailyFilePath('./uploads', KEY)).toBe(resolve(join('./uploads', 'daily-files', KEY)));
  });

  it.each(['../secret', '..\\..\\etc\\passwd', `${KEY}/../../x`, '/etc/passwd', 'C:\\Windows\\win.ini', '', 'not-a-uuid'])(
    'rejects %s with NOT_FOUND',
    (key) => {
      expect(() => resolveDailyFilePath('./uploads', key)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    },
  );
});

describe('contentDisposition', () => {
  it('encodes a Persian name per RFC 5987 with an ASCII fallback', () => {
    const v = contentDisposition('بار روزانه ۱۴۰۵.xlsx');
    expect(v).toMatch(/^attachment; filename="daily-file\.xlsx"; filename\*=UTF-8''/);
    expect(decodeURIComponent(v.split("UTF-8''")[1]!)).toBe('بار روزانه ۱۴۰۵.xlsx');
  });

  it('keeps ASCII names and strips quotes, separators and control characters', () => {
    const v = contentDisposition('../re"port\r\n.xlsx');
    expect(v).toContain('filename="..report.xlsx"');
    expect(v).not.toMatch(/[\r\n]/);
    expect(v.split(';')[1]).not.toContain('/');
  });
});
