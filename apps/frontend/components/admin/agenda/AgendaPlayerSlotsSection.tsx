import { useCallback, useEffect, useRef, useState } from 'react';
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
  `$${Number(amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

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
  // Avisa la duración fija de la modalidad elegida (null = la de la actividad) para ajustar la selección.
  onFormatDurationChange?: (durationMinutes: number | null) => void;
  /** Avisa precio y condición de cada jugador asignado, para mostrarlos en la lista de jugadores. */
  onSlotsLoaded?: (slots: AgendaPlayerSlotInfo[]) => void;
};

export type AgendaPlayerSlotInfo = {
  clientId: string | null;
  name: string;
  shareAmount: number;
  conditionLabel: string;
  isFrozen: boolean;
};

const slotConditionLabel = (slot: AdminBookingSlots['slots'][number]) =>
  slot.isEmpty
    ? 'No socio'
    : slot.pricingMemberCategoryName
      ? `Socio ${slot.pricingMemberCategoryName}`
      : slot.memberPricePending
        ? 'Socio · falta validar'
        : 'No socio';

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
  onPricesChanged,
  onFormatDurationChange,
  onSlotsLoaded
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

  const selectedFormatDuration = activityFormats.find((format) => format.id === formatId)?.durationMinutes ?? null;
  const onFormatDurationChangeRef = useRef(onFormatDurationChange);
  useEffect(() => {
    onFormatDurationChangeRef.current = onFormatDurationChange;
  }, [onFormatDurationChange]);
  useEffect(() => {
    if (pricingMode !== 'PER_PLAYER' || bookingId || !formatId) return;
    onFormatDurationChangeRef.current?.(selectedFormatDuration);
  }, [bookingId, formatId, pricingMode, selectedFormatDuration]);

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

  const onSlotsLoadedRef = useRef(onSlotsLoaded);
  useEffect(() => {
    onSlotsLoadedRef.current = onSlotsLoaded;
  }, [onSlotsLoaded]);
  useEffect(() => {
    if (!onSlotsLoadedRef.current) return;
    const filled = (slotsData?.perPlayer ? slotsData.slots : []).filter((slot) => !slot.isEmpty);
    onSlotsLoadedRef.current(
      filled.map((slot) => ({
        clientId: slot.clientId ? String(slot.clientId) : null,
        name: String(slot.displayName || ''),
        shareAmount: Number(slot.shareAmount || 0),
        conditionLabel: slotConditionLabel(slot),
        isFrozen: Boolean(slot.isFrozen)
      }))
    );
  }, [slotsData]);

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

  // Reserva nueva: elegir modalidad. Con una sola no hay nada que elegir: se usa sola.
  if (!bookingId) {
    if (activityFormats.length === 1) return null;
    return (
      <section className="mt-6">
        <p className="text-[13px] font-semibold text-p-text">Modalidad</p>
        {activityFormats.length === 0 ? (
          <p className="mt-1 text-[12px] text-p-error">Esta actividad no tiene modalidades. Cargalas en Ajustes &gt; Actividades.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {activityFormats.map((format) => (
              <button key={format.id} type="button" className={chipClass(format.id === formatId)} onClick={() => onFormatChange(format.id)}>
                {format.name} · {format.playerCount} jug.{format.durationMinutes ? ` · ${format.durationMinutes} min` : ''}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  if (!slotsData?.perPlayer) return null;
  const total = slotsData.slots.reduce((sum, slot) => sum + slot.shareAmount, 0);
  const emptySlots = slotsData.slots.filter((slot) => slot.isEmpty);
  const pendingValidation = slotsData.slots.filter((slot) => !slot.isEmpty && slot.memberPricePending && !slot.isFrozen);

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] text-p-text-muted">
          {slotsData.activityFormat?.name} · {slotsData.playerCount} jugadores ·{' '}
          <span className="font-semibold text-p-text">{formatMoney(total)}</span>
          {Number(slotsData.memberBenefitAmount || 0) > 0
            ? ` · beneficio socio ${formatMoney(Number(slotsData.memberBenefitAmount))}`
            : ''}
        </p>
        {canReprice ? (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            title="Vuelve a calcular el precio de los lugares sin pagos con la condición actual de cada jugador"
            onClick={() => void runAction('reprice', () => PlayerPricingService.reprice(bookingId), 'Precios actualizados.')}
          >
            <RefreshCw size={12} /> Actualizar precios
          </button>
        ) : null}
      </div>
      {error ? <div className="mt-2"><AdminFeedbackBanner tone="error" compact>{error}</AdminFeedbackBanner></div> : null}
      {pendingValidation.map((slot) => (
        <div key={`validate-${slot.slotIndex}`} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-p-warning-bg px-3 py-2 text-[12px] text-p-warning">
          <span>{slot.displayName || 'Jugador'} dice ser socio: validalo con carnet o DNI.</span>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void runAction('validateMember', () => PlayerPricingService.validateMember(bookingId, slot.slotIndex), 'Socio validado.')
            }
          >
            <BadgeCheck size={12} /> Validar
          </button>
        </div>
      ))}
      {emptySlots.length > 0 && (
        <p className="mt-1 text-[12px] text-p-text-muted">
          {emptySlots.length === 1 ? 'Falta 1 jugador' : `Faltan ${emptySlots.length} jugadores`}: cada lugar vacío se cobra{' '}
          {formatMoney(emptySlots[0].shareAmount)} (no socio).
        </p>
      )}
    </section>
  );
}
