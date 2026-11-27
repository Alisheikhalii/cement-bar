'use client';
import { PLATE_LETTERS, faDigits, type PlateParts } from '@cb/shared';
import { cn } from '../cn';
import { sanitizePlateDigits, type PlateDigitPart } from '../helpers/plate';
import { uiStrings } from '../strings';

export interface PlateInputProps {
  id: string;
  value: PlateParts;
  onChange: (value: PlateParts) => void;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
}

const partInput =
  'h-11 min-w-0 rounded-lg bg-transparent text-center text-headline-sm tabular-nums text-text-primary focus:bg-surface-container-low focus:outline-none';

/**
 * Iranian plate styled input, laid out LTR like the physical plate:
 * [IR strip] [2 digits] [letter] [3 digits] | [ایران 2 digits].
 */
export function PlateInput({ id, value, onChange, invalid, disabled, ...aria }: PlateInputProps) {
  const setDigits = (part: PlateDigitPart, raw: string) => onChange({ ...value, [part]: sanitizePlateDigits(raw, part) });

  return (
    <div
      dir="ltr"
      role="group"
      aria-describedby={aria['aria-describedby']}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-[3.25rem] w-full max-w-sm items-stretch overflow-hidden rounded-xl border-2 border-text-primary bg-surface-card',
        invalid && 'border-danger',
        disabled && 'opacity-60',
      )}
    >
      <span aria-hidden className="flex w-6 shrink-0 flex-col items-center justify-center bg-primary-container text-[0.5rem] font-bold leading-tight text-on-primary">
        I.R.
        <br />
        IRAN
      </span>
      <input
        id={id}
        aria-label={uiStrings.plate.two}
        inputMode="numeric"
        maxLength={2}
        disabled={disabled}
        value={faDigits(value.two)}
        onChange={(e) => setDigits('two', e.target.value)}
        className={cn(partInput, 'w-12 flex-[2]')}
      />
      <select
        aria-label={uiStrings.plate.letter}
        disabled={disabled}
        value={value.letter}
        onChange={(e) => onChange({ ...value, letter: e.target.value })}
        className={cn(partInput, 'w-14 flex-[2] cursor-pointer appearance-none')}
        dir="rtl"
      >
        <option value="">—</option>
        {PLATE_LETTERS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <input
        aria-label={uiStrings.plate.three}
        inputMode="numeric"
        maxLength={3}
        disabled={disabled}
        value={faDigits(value.three)}
        onChange={(e) => setDigits('three', e.target.value)}
        className={cn(partInput, 'w-16 flex-[3]')}
      />
      <div className="flex w-14 flex-[2] shrink-0 flex-col items-center justify-center border-s-2 border-text-primary">
        <span aria-hidden className="text-[0.625rem] leading-none text-text-secondary">
          {uiStrings.plate.iran}
        </span>
        <input
          aria-label={uiStrings.plate.iran}
          inputMode="numeric"
          maxLength={2}
          disabled={disabled}
          value={faDigits(value.iran)}
          onChange={(e) => setDigits('iran', e.target.value)}
          className={cn(partInput, 'h-8 w-full text-label-lg')}
        />
      </div>
    </div>
  );
}
