import type { ZodErrorMap } from 'zod';
import { ZodIssueCode } from 'zod';
import { faDigits } from '@cb/shared';
import { fa } from '@/i18n/fa';

const v = fa.validation;

/**
 * Persian fallback messages for Zod issues that have no custom message in the shared schemas.
 * Passed to zodResolver(schema, { errorMap: faErrorMap }).
 */
export const faErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      return { message: issue.received === 'undefined' || issue.received === 'null' ? v.required : v.invalid };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: Number(issue.minimum) <= 1 ? v.required : v.minChars(faDigits(Number(issue.minimum))) };
      }
      return { message: v.tooSmall };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: v.maxChars(faDigits(Number(issue.maximum))) };
      return { message: v.tooBig };
    case ZodIssueCode.invalid_string:
      return { message: v.badFormat };
    case ZodIssueCode.invalid_enum_value:
      return { message: v.chooseOne };
    default:
      return { message: ctx.defaultError === 'Required' ? v.required : v.invalid };
  }
};
