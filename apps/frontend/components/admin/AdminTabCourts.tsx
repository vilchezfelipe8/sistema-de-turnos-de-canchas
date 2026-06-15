import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, Ban, Power, Save } from 'lucide-react';
import { getCourts, reactivateCourt, suspendCourt, updateCourtPrice } from '../../services/CourtService';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
import { extractErrorMessage } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import AdminAppModal from './ui/AdminAppModal';
import { MetricCard } from './ui';
import SettingsSection from '../../modules/ajustes/components/SettingsSection';
import SettingsInfoNote from '../../modules/ajustes/components/SettingsInfoNote';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Court = {
  id: number;
  name: string;
  price?: number | null;
  isUnderMaintenance?: boolean;
  sport?: string;
  surface?: string;
  activityType?: {
    name?: string;
    defaultDurationMinutes?: number;
  } | null;
};

type ModalState = {
  show: boolean;
  title?: string;
  message?: ReactNode;
  cancelText?: string;
  confirmText?: string;
  isWarning?: boolean;
  onConfirm?: () => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getCourtTypeLabel = (court: Court): string => {
  const activityName = String(court?.activityType?.name || '').trim();
  if (activityName) return activityName;
  return String(court?.sport || court?.surface || '-');
};

const getPriceReferenceMinutes = (court: Court): number => {
  const activityName = String(court?.activityType?.name || court?.sport || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();

  if (activityName === 'FUTBOL' || activityName === 'TENIS') return 60;

  const rawDefault = Number(court?.activityType?.defaultDurationMinutes);
  if (Number.isFinite(rawDefault) && rawDefault > 0) return rawDefault;

  return 90;
};

// ---------------------------------------------------------------------------
// CourtCard sub-component
// ---------------------------------------------------------------------------

type CourtCardProps = {
  court: Court;
  priceEdit: string;
  onPriceChange: (value: string) => void;
  onPriceSave: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
};

function CourtCard({
  court,
  priceEdit,
  onPriceChange,
  onPriceSave,
  onSuspend,
  onReactivate,
}: CourtCardProps) {
  const isMaintenance = Boolean(court.isUnderMaintenance);

  return (
    <div className="relative overflow-hidden rounded-xl border border-p-border bg-p-surface">
      {/* Status indicator stripe */}
      <div
        className={`absolute inset-y-0 left-0 w-[3px] ${
          isMaintenance ? 'bg-p-error' : 'bg-p-positive'
        }`}
      />

      <div className="p-5 pl-6">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold leading-snug text-p-text">
            {court.name}
          </h3>
          {isMaintenance ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-p-error bg-p-error-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-p-error">
              <span className="h-1.5 w-1.5 rounded-full bg-p-error" />
              Mantenimiento
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-p-positive bg-p-positive-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-p-positive">
              <span className="h-1.5 w-1.5 rounded-full bg-p-positive" />
              Operativo
            </span>
          )}
        </div>

        {/* Activity type badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-p-border bg-p-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-p-text-muted">
          <Activity size={11} strokeWidth={2.2} />
          {getCourtTypeLabel(court)}
        </span>

        {/* Price editor */}
        <div className="mt-4 rounded-xl border border-p-border bg-p-surface-2 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-p-text-muted">
            Precio base · {getPriceReferenceMinutes(court)} min
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-p-text-muted">
                $
              </span>
              <input
                type="number"
                min={0}
                className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-7 pr-3 text-[13px] font-semibold text-p-text outline-none transition focus:border-p-accent"
                value={priceEdit}
                onChange={(e) => onPriceChange(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={onPriceSave}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-ink-900 px-4 text-[12px] font-semibold text-ink-50 transition hover:bg-ink-900"
            >
              <Save size={13} />
              Guardar
            </button>
          </div>
        </div>

        {/* Action */}
        <div className="mt-3 border-t border-p-border pt-3">
          {isMaintenance ? (
            <button
              type="button"
              onClick={onReactivate}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-p-positive px-3 text-[12px] font-semibold text-ink-50 transition hover:bg-p-positive"
            >
              <Power size={13} strokeWidth={2.4} />
              Reactivar cancha
            </button>
          ) : (
            <button
              type="button"
              onClick={onSuspend}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-p-error bg-p-surface px-3 text-[12px] font-semibold text-p-error transition hover:bg-p-error-bg"
            >
              <Ban size={13} strokeWidth={2.4} />
              Poner en mantenimiento
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AdminTabCourts() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [modalState, setModalState] = useState<ModalState>({ show: false });
  const [modalConfirming, setModalConfirming] = useState(false);

  // ── Modal helpers ──
  const closeModal = useCallback(() => {
    if (modalConfirming) return;
    setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  }, [modalConfirming]);

  const wrapAction = useCallback(
    (action?: () => Promise<void> | void) => async () => {
      if (modalConfirming) return;
      setModalConfirming(true);
      try {
        await action?.();
        setModalConfirming(false);
        setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
      } catch (error) {
        setModalConfirming(false);
        setModalState({
          show: true,
          title: 'Error',
          message: extractErrorMessage(error, 'No se pudo completar la acción.'),
          isWarning: true,
          cancelText: '',
          confirmText: 'Aceptar',
        });
      }
    },
    [modalConfirming],
  );

  const showError = useCallback((message: ReactNode) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar',
    });
  }, []);

  const showConfirm = useCallback(
    (options: {
      title: string;
      message: ReactNode;
      confirmText?: string;
      cancelText?: string;
      isWarning?: boolean;
      onConfirm: () => Promise<void> | void;
      onCancel?: () => Promise<void> | void;
    }) =>
      setModalState({
        show: true,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText ?? 'Aceptar',
        cancelText: options.cancelText ?? 'Cancelar',
        isWarning: options.isWarning ?? true,
        onConfirm: wrapAction(options.onConfirm),
        onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined,
      }),
    [wrapAction],
  );

  // ── Data loading ──
  const loadCourts = useCallback(async () => {
    try {
      const data = await getCourts();
      setCourts(data as Court[]);
      setPriceEdits((prev) => {
        const next = { ...prev };
        (data as Court[]).forEach((court) => {
          if (next[court.id] === undefined) {
            next[court.id] =
              court.price !== undefined && court.price !== null ? String(court.price) : '';
          }
        });
        return next;
      });
    } catch (error: unknown) {
      if (isAuthSessionInvalidatedError(error)) return;
      showError(extractErrorMessage(error, 'No se pudieron cargar las canchas.'));
    }
  }, [showError]);

  useEffect(() => {
    void loadCourts();
  }, [loadCourts]);

  // ── Actions ──
  const handleSuspend = (id: number) => {
    showConfirm({
      title: 'Suspender cancha',
      message: '¿Seguro que querés poner esta cancha en mantenimiento?',
      confirmText: 'Suspender',
      onConfirm: async () => {
        await suspendCourt(id);
        await loadCourts();
        showAdminToast('Cancha puesta en mantenimiento.');
      },
    });
  };

  const handleReactivate = (id: number) => {
    showConfirm({
      title: 'Reactivar cancha',
      message: '¿Querés habilitar nuevamente esta cancha para reservas?',
      confirmText: 'Reactivar',
      isWarning: false,
      onConfirm: async () => {
        await reactivateCourt(id);
        await loadCourts();
        showAdminToast('Cancha reactivada.');
      },
    });
  };

  const handlePriceSave = async (id: number) => {
    try {
      const raw = priceEdits[id];
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        showError('Ingresá un precio válido.');
        return;
      }
      await updateCourtPrice(id, parsed);
      showAdminToast('Precio actualizado.');
      await loadCourts();
    } catch (error: unknown) {
      showError(extractErrorMessage(error, 'No se pudo actualizar el precio.'));
    }
  };

  // ── Derived metrics ──
  const activeCourts = courts.filter((c) => !c.isUnderMaintenance).length;
  const maintenanceCourts = courts.length - activeCourts;
  const averagePrice = courts.length
    ? courts.reduce((sum, c) => sum + Number(c.price || 0), 0) / courts.length
    : 0;

  // ── Render ──
  return (
    <div className="flex w-full flex-col gap-4">

      {/* ── Summary metrics ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Total"
          value={courts.length}
          format="number"
          valueColor="var(--accent-fg)"
        />
        <MetricCard
          label="Operativas"
          value={activeCourts}
          format="number"
          valueColor="var(--positive-fg)"
        />
        <MetricCard
          label="Mantenimiento"
          value={maintenanceCourts}
          format="number"
          valueColor={maintenanceCourts > 0 ? 'var(--warn-fg)' : undefined}
        />
        <MetricCard
          label="Precio prom."
          value={Math.round(averagePrice)}
          format="money"
        />
      </div>

      {/* ── Info: cálculo de precio ── */}
      <SettingsInfoNote variant="info">
        El precio definido es la base para la duración por defecto de cada actividad. Si la reserva
        es más corta o larga, el sistema ajusta el importe de forma proporcional. Para Fútbol y
        Tenis la base es siempre 60 min.
      </SettingsInfoNote>

      {/* ── Courts list ── */}
      <SettingsSection
        title="Canchas registradas"
        description="Administrá precios, estado operativo y mantenimiento de cada cancha."
      >
        {courts.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px] font-semibold text-p-text-muted">
            Sin canchas registradas.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {courts.map((court) => (
              <CourtCard
                key={court.id}
                court={court}
                priceEdit={priceEdits[court.id] ?? ''}
                onPriceChange={(value) =>
                  setPriceEdits((prev) => ({ ...prev, [court.id]: value }))
                }
                onPriceSave={() => void handlePriceSave(court.id)}
                onSuspend={() => handleSuspend(court.id)}
                onReactivate={() => handleReactivate(court.id)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {/* ── Alta de canchas ── */}
      <SettingsInfoNote variant="neutral" title="Alta de canchas">
        Deshabilitada en el panel. Para agregar nuevas canchas, comunicarse con soporte.
      </SettingsInfoNote>

      {/* ── Modal ── */}
      <AdminAppModal
        show={modalState.show}
        onClose={closeModal}
        onCancel={modalState.onCancel}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalConfirming ? 'Procesando...' : modalState.confirmText}
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm}
        confirmDisabled={modalConfirming}
        closeOnBackdrop={!modalConfirming && modalState.closeOnBackdrop}
        closeOnEscape={!modalConfirming && modalState.closeOnEscape}
      />
    </div>
  );
}
