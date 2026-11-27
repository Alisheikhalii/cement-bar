'use client';
import * as RSelect from '@radix-ui/react-select';
import * as RSwitch from '@radix-ui/react-switch';
import * as RCheckbox from '@radix-ui/react-checkbox';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { uiStrings } from '../strings';
import { controlClasses } from './inputs';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

export function Select({
  id,
  value,
  onValueChange,
  options,
  placeholder = uiStrings.selectPlaceholder,
  disabled,
  invalid,
  className,
  ...aria
}: SelectProps) {
  return (
    <RSelect.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled} dir="rtl">
      <RSelect.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(controlClasses, 'flex items-center justify-between gap-space-xs text-start', className)}
        {...aria}
      >
        <RSelect.Value placeholder={<span className="text-text-muted">{placeholder}</span>} />
        <RSelect.Icon>
          <ChevronDown className="size-4 text-text-secondary" aria-hidden />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl bg-surface-card shadow-elevation-3 animate-fade-in"
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex min-h-11 cursor-pointer select-none items-center rounded-lg pe-8 ps-space-sm text-body-md text-text-primary outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-container-low"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute end-2">
                  <Check className="size-4 text-primary-container" aria-hidden />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Switch({ id, checked, onCheckedChange, label, disabled }: SwitchProps) {
  return (
    <span className="inline-flex min-h-11 items-center gap-space-xs">
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-6 w-11 shrink-0 rounded-full bg-outline-variant shadow-inner transition-colors data-[state=checked]:bg-success disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-5 translate-x-[-2px] rounded-full bg-surface-card shadow-elevation-2 transition-transform data-[state=checked]:translate-x-[-22px]" />
      </RSwitch.Root>
      {label ? (
        <label htmlFor={id} className="text-body-md text-text-body">
          {label}
        </label>
      ) : null}
    </span>
  );
}

export interface CheckboxProps {
  id?: string;
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
}

export function Checkbox({ id, checked, onCheckedChange, label, disabled, ...aria }: CheckboxProps) {
  return (
    <span className="inline-flex items-center gap-space-xs">
      <RCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(c) => onCheckedChange(c === true)}
        disabled={disabled}
        className="flex size-5 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-surface-card transition-colors data-[state=checked]:border-primary-container data-[state=checked]:bg-primary-container data-[state=indeterminate]:border-primary-container data-[state=indeterminate]:bg-primary-container disabled:opacity-50"
        {...aria}
      >
        <RCheckbox.Indicator className="text-on-primary">
          {checked === 'indeterminate' ? (
            <span className="block h-0.5 w-2.5 rounded bg-on-primary" />
          ) : (
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          )}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label ? (
        <label htmlFor={id} className="text-body-md text-text-body">
          {label}
        </label>
      ) : null}
    </span>
  );
}
