import { useEffect, useMemo, useState } from 'react';
import AdminModal from '../ui/AdminModal';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import { MemberAdminService } from '../../../services/MemberAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type MemberRenewModalProps = {
  open: boolean;
  clubSlug: string;
  clientId: string;
  clientName: string;
  /** "YYYY-MM-DD" o null si no tenía vencimiento. */
  validUntil: string | null;
  onClose: () => void;
  onRenewed?: () => void;
};

const OPTIONS = [
  { months: 1, label: '1 mes' },
  { months: 3, label: '3 meses' },
  { months: 6, label: '6 meses' },
  { months: 12, label: '1 año' },
];

const toKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const fromKey = (key: string) => new Date(`${key}T12:00:00`);

/** Suma meses sin pasarse de fin de mes (31 ene + 1 mes = 28/29 feb). */
const addMonths = (base: Date, months: number) => {
  const target = new Date(base.getFullYear(), base.getMonth() + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(base.getDate(), lastDay));
  return target;
};

const formatLong = (key: string) =>
  fromKey(key).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const chipClass = (active: boolean) =>
  `h-9 rounded-xl px-3.5 text-[13px] font-bold transition ${
    active ? 'bg-ink-900 text-ink-50' : 'bg-p-surface-2 text-p-text-secondary hover:brightness-95'
  }`;

/** "Renovar cuota": corre la fecha de "al día" del socio. No cobra nada. */
export default function MemberRenewModal({
  open,
  clubSlug,
  clientId,
  clientName,
  validUntil,
  onClose,
  onRenewed,
}: MemberRenewModalProps) {
  const todayKey = toKey(new Date());
  const stillCurrent = Boolean(validUntil && validUntil >= todayKey);
  // Si sigue al día, se suma desde su vencimiento; si ya venció, desde hoy.
  const baseKey = stillCurrent && validUntil ? validUntil : todayKey;
  const [months, setMonths] = useState<number | null>(1);
  const [customKey, setCustomKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMonths(1);
    setCustomKey('');
    setError('');
  }, [open]);

  const targetKey = useMemo(() => {
    if (months === null) return customKey;
    return toKey(addMonths(fromKey(baseKey), months));
  }, [baseKey, customKey, months]);

  const submit = async () => {
    if (!targetKey) return;
    try {
      setSubmitting(true);
      setError('');
      await MemberAdminService.updateMember(clubSlug, clientId, { validUntil: targetKey });
      showAdminToast(`${clientName} queda al día hasta el ${fromKey(targetKey).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace(/\./g, '')}.`);
      onRenewed?.();
      onClose();
    } catch (err) {
      reportUiError({ area: 'MemberRenewModal', action: 'renewMember' }, err);
      setError(extractErrorMessage(err, 'No se pudo renovar la cuota.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminModal
      open={open}
      title={`Renovar cuota de ${clientName}`}
      description={
        validUntil
          ? stillCurrent
            ? `Hoy está al día hasta el ${formatLong(validUntil)}. Se suma desde esa fecha.`
            : `La cuota venció el ${formatLong(validUntil)}. Se suma desde hoy.`
          : 'No tenía fecha de vencimiento. Se suma desde hoy.'
      }
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={submitting || !targetKey || targetKey < todayKey}
            onClick={() => void submit()}
            className="inline-flex h-9 items-center rounded-lg bg-ink-900 px-4 text-[12px] font-semibold !text-ink-50 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Guardando...' : 'Renovar'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error ? <AdminFeedbackBanner tone="error" compact>{error}</AdminFeedbackBanner> : null}
        <p className="text-[12px] font-semibold text-p-text-secondary">¿Por cuánto tiempo?</p>
        <div className="flex flex-wrap gap-1.5">
          {OPTIONS.map((option) => (
            <button
              key={option.months}
              type="button"
              aria-pressed={months === option.months}
              className={chipClass(months === option.months)}
              onClick={() => setMonths(option.months)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={months === null}
            className={chipClass(months === null)}
            onClick={() => {
              setMonths(null);
              if (!customKey) setCustomKey(targetKey);
            }}
          >
            Otra fecha
          </button>
        </div>
        {months === null && (
          <input
            type="date"
            min={todayKey}
            value={customKey}
            onChange={(event) => setCustomKey(event.target.value)}
            className="h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary"
            aria-label="Al día hasta"
          />
        )}
        {targetKey && (
          <p className="rounded-xl bg-p-positive-bg px-3 py-2 text-[13px] font-semibold text-p-accent">
            Queda al día hasta el {formatLong(targetKey)}.
          </p>
        )}
        <p className="text-[12px] text-p-text-muted">Solo cambia la fecha. Si pagó la cuota, el cobro se registra aparte.</p>
      </div>
    </AdminModal>
  );
}
