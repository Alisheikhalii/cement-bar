'use client';
import { useId, useState, type KeyboardEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';
import { controlClasses } from './inputs';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

export interface ComboboxProps {
  id: string;
  /** Text in the search box (controlled so the app can debounce + fetch). */
  query: string;
  onQueryChange: (q: string) => void;
  options: ComboOption[];
  /** Currently selected option (shown when the box is not being edited). */
  selected: ComboOption | null;
  onSelect: (o: ComboOption) => void;
  loading?: boolean;
  placeholder?: string;
  emptyText?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
}

/** Searchable single-select (ARIA combobox + listbox). Options are supplied by the caller (async search). */
export function Combobox({
  id,
  query,
  onQueryChange,
  options,
  selected,
  onSelect,
  loading,
  placeholder,
  emptyText = uiStrings.empty,
  invalid,
  ...aria
}: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const display = open ? query : (selected?.label ?? query);

  const choose = (o: ComboOption) => {
    onSelect(o);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={aria['aria-describedby']}
        autoComplete="off"
        placeholder={placeholder}
        value={display}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        className={cn(controlClasses, 'ps-9')}
      />
      {loading ? (
        <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-text-muted" aria-hidden />
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-64 overflow-y-auto rounded-xl bg-surface-card p-1 shadow-elevation-3 animate-fade-in"
        >
          {options.length === 0 && !loading ? (
            <li className="px-space-sm py-space-xs text-body-sm text-text-muted">{emptyText}</li>
          ) : null}
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={selected?.value === o.value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-between gap-space-xs rounded-lg px-space-sm text-body-md text-text-primary',
                i === active && 'bg-surface-container-low',
              )}
            >
              <span>{o.label}</span>
              {o.hint ? <span className="text-caption text-text-muted">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
