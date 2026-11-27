'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../cn';
import { uiStrings } from '../strings';

export type ToastTone = 'success' | 'danger' | 'warning' | 'info';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; default 5000. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, 'description'>> {
  id: number;
  description?: string;
}

interface ToastApi {
  toast: (t: ToastInput) => void;
  dismiss: (id: number) => void;
}

const DEFAULT_DURATION_MS = 5000;
const MAX_VISIBLE = 4;

const ToastContext = createContext<ToastApi | null>(null);

const toneStyle: Record<ToastTone, { strip: string; icon: ReactNode }> = {
  success: { strip: 'bg-success', icon: <CheckCircle2 className="size-5 text-success" aria-hidden /> },
  danger: { strip: 'bg-danger', icon: <XCircle className="size-5 text-danger" aria-hidden /> },
  warning: { strip: 'bg-warning', icon: <AlertTriangle className="size-5 text-warning" aria-hidden /> },
  info: { strip: 'bg-info', icon: <Info className="size-5 text-info" aria-hidden /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      seq.current += 1;
      const id = seq.current;
      const item: ToastItem = {
        id,
        title: t.title,
        description: t.description,
        tone: t.tone ?? 'info',
        duration: t.duration ?? DEFAULT_DURATION_MS,
      };
      setItems((xs) => [...xs.slice(-(MAX_VISIBLE - 1)), item]);
      setTimeout(() => dismiss(id), item.duration);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-space-xs p-space-md pb-[max(theme(spacing.space-md),env(safe-area-inset-bottom))] md:bottom-auto md:top-20 md:items-start md:ps-space-lg"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            className="pointer-events-auto relative flex w-full max-w-sm animate-modal-enter items-start gap-space-sm overflow-hidden rounded-2xl bg-surface-card p-space-md shadow-elevation-3"
          >
            <span aria-hidden className={cn('absolute inset-y-0 end-auto start-0 w-1.5', toneStyle[t.tone].strip)} />
            {toneStyle[t.tone].icon}
            <div className="min-w-0 flex-1">
              <p className="text-label-lg text-text-primary">{t.title}</p>
              {t.description ? <p className="text-body-sm text-text-secondary">{t.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label={uiStrings.close}
              className="-m-2 flex size-9 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-surface-container-low"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
