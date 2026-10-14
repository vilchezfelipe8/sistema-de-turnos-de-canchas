import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, RefreshCw } from 'lucide-react';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import {
  PlayerPricingService,
  type ActivityFormat,
  type AdminBookingSlots,
  type ClubPricingMode
} from '../../../services/PlayerPricingService';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { showAdminToast } from '../../../utils/adminToast';

const formatMoney = (amount: number) =>
  `$ ${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

type AgendaPlayerSlotsSectionProps = {
  clubSlug: string;
  // Reserva ya creada; null mientras se arma una nueva.
  bookingId: number | null;
  // Actividad de la cancha elegida (para filtrar modalidades).
  activityId: number | null;
  formatId: string;
  onFormatChange: (formatId: string) => void;
  // Cambia cuando cambian los participantes, para volver a leer los lugares.
  refreshKey?: unknown;
  canReprice: boolean;
  onPricesChanged?: () => void;
};

const chipClass = (active: boolean) =>
  `h-8 rounded-lg border px-3 text-[12px] font-semibold transition ${active ? 'border-ink-900 bg-ink-900 !text-ink-50' : 'border-p-border text-p-text hover:bg-p-surface-2'}`;
const buttonClass =
  'inline-flex h-7 items-center gap-1 rounded-lg border border-p-border px-2 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

// Precio por jugador en la Agenda: modalidad al crear y lugares (jugador, categoría, parte) en la reserva.
// Si el club cobra por cancha no muestra nada.
export default function AgendaPlayerSlotsSection({
  clubSlug,
  bookingId,
  activityId,
  formatId,
  onFormatChange,
  refreshKey,
  canReprice,
  onPricesChanged
}: AgendaPlayerSlotsSectionProps) {
  const [pricingMode, setPricingMode] = useState<ClubPricingMode>('PER_COURT');
  const [formats, setFormats] = useState<ActivityFormat[]>([]);
  const [slotsData, setSlotsData] = useState<AdminBookingSlots | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clubSlug) return;
    let cancelled = false;
    PlayerPricingService.getPublicFormats(clubSlug)
      .then((result) => {
        if (cancelled) return;
        setPricingMode(result.pricingMode);
        setFormats(result.formats);
      })
      .catch((err) => reportUiError({ area: 'AgendaPlayerSlotsSection', action: 'loadFormats' }, err));
    return () => {
      cancelled = true;
    };
  }, [clubSlug]);

  const activityFormats = formats.filter((format) => !activityId || format.activityTypeId === activityId);

  // Preseleccionar la primera modalidad de la actividad al armar una reserva nueva.
  useEffect(() => {
    if (pricingMode !== 'PER_PLAYER' || bookingId) return;
    if (!activityFormats.some((format) => format.id === formatId)) {
      onFormatChange(activityFormats[0]?.id || '');
    }
  }, [activityFormats, bookingId, formatId, onFormatChange, pricingMode]);

  const loadSlots = useCallback(async () => {
    if (!bookingId || pricingMode !== 'PER_PLAYER') {
      setSlotsData(null);
      return;
    }
    try {
      setSlotsData(await PlayerPricingService.getBookingSlots(bookingId));
      setError('');
    } catch (err) {
      reportUiError({ area: 'AgendaPlayerSlotsSection', action: 'loadSlots' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar los lugares.'));
    }
  }, [bookingId, pricingMode]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots, refreshKey]);

  const runAction = async (action: string, fn: () => Promise<unknown>, message: string) => {
    try {
      setBusy(true);
      setError('');
      await fn();
      await loadSlots();
      onPricesChanged?.();
      showAdminToast(message);
    } catch (err) {
      reportUiError({ area: 'AgendaPlayerSlotsSection', action }, err);
      setError(extractErrorMessage(err, 'No se pudo completar la acción.'));
    } finally {
      setBusy(false);
    }
  };

  if (pricingMode !== 'PER_PLAYER') return null;

  // Reserva nueva: elegir modalidad.
  if (!bookingId) {
    return (
      <section className="mt-4 rounded-xl border border-p-border bg-p-surface-2 p-4">
        <p className="text-[13px] font-semibold text-p-text">Modalidad</p>
        {activityFormats.length === 0 ? (
          <p className="mt-1 text-[12px] text-p-error">Esta actividad no tiene modalidades. Cargalas en Ajustes &gt; Actividades.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {activityFormats.map((format) => (
              <button key={format.id} type="button" className={chipClass(format.id === formatId)} onClick={() => onFormatChange(format.id)}>
                {format.name} · {format.playerCount} jug.
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[12px] text-p-text-muted">
          Cada jugador paga según su categoría. Los lugares sin asignar se cobran como no socio; los completás después en Participantes.
        </p>
      </section>
    );
  }

  if (!slotsData?.perPlayer) return null;
  const total = slotsData.slots.reduce((sum, slot) => sum + slot.shareAmount, 0);

  return (
    <section className="mt-4 rounded-xl border border-p-border bg-p-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-p-text">
          Jugadores · {slotsData.activityFormat?.name} ({slotsData.playerCount})
        </p>
        {canReprice ? (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            title="Recalcula las partes sin pagos con la condición actual de cada jugador"
            onClick={() => void runAction('reprice', () => PlayerPricingService.reprice(bookingId), 'Precios recalculados.')}
          >
            <RefreshCw size={12} /> Recalcular
          </button>
        ) : null}
      </div>
      {error ? <div className="mt-2"><AdminFeedbackBanner tone="error" compact>{error}</AdminFeedbackBanner></div> : null}
      <ul className="mt-2 divide-y divide-p-border text-[12px]">
        {slotsData.slots.map((slot) => (
          <li key={slot.slotIndex} className="flex items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <span className="font-semibold text-p-text">
                {slot.slotIndex}. {slot.isEmpty ? 'Sin asignar' : slot.displayName || 'Jugador'}
              </span>
              <span className="ml-2 text-p-text-muted">
                {slot.isEmpty
                  ? 'no socio'
                  : slot.pricingMemberCategoryName
                    ? `Socio ${slot.pricingMemberCategoryName}`
                    : slot.memberPricePending
                      ? 'Socio · precio pendiente de validar'
                      : 'No socio'}
              </span>
              {slot.isFrozen ? <span className="ml-2 text-p-accent">pagado</span> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {slot.memberPricePending && !slot.isFrozen ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  title="Validar presencialmente (carnet o DNI) para aplicar el precio socio"
                  onClick={() =>
                    void runAction('validateMember', () => PlayerPricingService.validateMember(bookingId, slot.slotIndex), 'Socio validado.')
                  }
                >
                  <BadgeCheck size={12} /> Validar socio
                </button>
              ) : null}
              <span className="font-semibold text-p-text">{formatMoney(slot.shareAmount)}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t border-p-border pt-2 text-[12px]">
        <span className="text-p-text-muted">
          {Number(slotsData.memberBenefitAmount || 0) > 0 ? `Beneficio socio: ${formatMoney(Number(slotsData.memberBenefitAmount))}` : ''}
        </span>
        <span className="font-semibold text-p-text">Total {formatMoney(total)}</span>
      </div>
    </section>
  );
}
