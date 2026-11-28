import type { z } from 'zod';
import { faDigits } from '@cb/shared';
import { fa } from '@/i18n/fa';

const v = fa.validation;

/**
 * Persian fallback messages for Zod issues that have no custom message in the shared schemas
 * (schema-level messages take precedence over this map in zod 4).
 * Passed to zodResolver(schema, { error: faErrorMap }).
 */
export const faErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined || issue.input === null ? v.required : v.invalid;
    case 'too_small':
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1 ? v.required : v.minChars(faDigits(Number(issue.minimum)));
      }
      return v.tooSmall;
    case 'too_big':
      if (issue.origin === 'string') return v.maxChars(faDigits(Number(issue.maximum)));
      return v.tooBig;
    case 'invalid_format':
      return v.badFormat;
    case 'invalid_value':
      return v.chooseOne;
    default:
      return v.invalid;
  }
};
