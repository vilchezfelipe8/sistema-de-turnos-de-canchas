import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { ADMIN_TOAST_EVENT } from '../../utils/adminToast';
import type { AdminToastAction, AdminToastPayload, AdminToastType } from '../../utils/adminToast';
import { ADMIN_Z_INDEX } from '../../utils/adminZIndex';
import { POP_EXIT_MS } from '../../hooks/usePresence';

interface ToastItem {
  id: number;
  message: string;
  type: AdminToastType;
  action?: AdminToastAction;
  leaving?: boolean;
}

const MAX_TOASTS = 4;
const DISMISS_MS = 2400;
const DISMISS_WITH_ACTION_MS = 6000;

const TOAST_TONE: Record<AdminToastType, string> = {
  success: 'bg-ink-900 text-ink-50',
  info: 'bg-ink-900 text-ink-50',
  error: 'bg-p-error text-white',
  warning: 'bg-p-warning text-white',
};

/**
 * AdminToast — renders the global admin toast stack.
 * Mount once inside AdminPlaygroundShell. Toasts are fired via showAdminToast().
 * Entra y sale con la misma animación que los menús (p-motion-pop).
 */
export default function AdminToast() {
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const remove = (id: number) => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.delete(id);
    };
    const dismiss = (id: number) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      timers.set(id, setTimeout(() => remove(id), POP_EXIT_MS));
    };

    const onEvent = (e: Event) => {
      const { message, type, action } = (e as CustomEvent<AdminToastPayload>).detail;
      const id = idRef.current++;
      setToasts((prev) => [...prev, { id, message, type, action }].slice(-MAX_TOASTS));
      const timer = setTimeout(() => dismiss(id), action ? DISMISS_WITH_ACTION_MS : DISMISS_MS);
      timers.set(id, timer);
    };

    window.addEventListener(ADMIN_TOAST_EVENT, onEvent);
    return () => {
      window.removeEventListener(ADMIN_TOAST_EVENT, onEvent);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  if (!mounted || typeof document === 'undefined' || toasts.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-label="Notificaciones"
      className="pointer-events-none fixed right-4 top-[76px] flex flex-col items-end gap-2 sm:right-6"
      style={{ zIndex: ADMIN_Z_INDEX.toast }}
    >
      {toasts.map((toast) => {
        const Icon = toast.type === 'error' || toast.type === 'warning' ? AlertTriangle : toast.type === 'info' ? Info : CheckCircle2;
        return (
          <div
            key={toast.id}
            role="status"
            data-state={toast.leaving ? 'closed' : 'open'}
            className={`p-motion-pop pointer-events-auto inline-flex max-w-[360px] items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold shadow-p-lg ${TOAST_TONE[toast.type] || TOAST_TONE.success}`}
          >
            <Icon size={15} className="shrink-0 opacity-90" />
            <span className="min-w-0">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
                className="ml-1.5 shrink-0 rounded-md border border-white/35 px-2 py-0.5 text-[12px] font-bold transition-colors hover:bg-white/10"
              >
                {toast.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
