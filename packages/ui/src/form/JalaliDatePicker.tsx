'use client';
import DatePicker, { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import { cn } from '../cn';
import { controlClasses } from './inputs';

/**
 * Jalali date picker. Value in/out is a Gregorian local ISO date "YYYY-MM-DD" (API contract);
 * the user sees and picks Shamsi dates with Persian digits.
 */
export interface JalaliDatePickerProps {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
}

/** Noon avoids day shifts from DST/timezone when converting a calendar date. */
const NOON = 'T12:00:00';

export function isoToPersian(iso: string): DateObject | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new DateObject({ date: new Date(`${iso}${NOON}`), calendar: persian, locale: persian_fa });
}

export function persianToIso(d: DateObject): string {
  return new DateObject(d).convert(gregorian, gregorian_en).format('YYYY-MM-DD');
}

export function JalaliDatePicker({ id, value, onChange, placeholder, invalid, disabled, ...aria }: JalaliDatePickerProps) {
  return (
    <div className="w-full" aria-describedby={aria['aria-describedby']}>
      <DatePicker
        id={id}
        value={isoToPersian(value)}
        onChange={(d) => onChange(d instanceof DateObject ? persianToIso(d) : '')}
        calendar={persian}
        locale={persian_fa}
        format="YYYY/MM/DD"
        calendarPosition="bottom-right"
        placeholder={placeholder ?? '۱۴۰۵/۰۱/۰۱'}
        disabled={disabled}
        editable={false}
        containerClassName="w-full"
        inputClass={cn(controlClasses, invalid && 'border-danger bg-danger-surface')}
      />
    </div>
  );
}
