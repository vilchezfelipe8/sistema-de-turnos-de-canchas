import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, Ban, Power } from 'lucide-react';
import { getCourts, reactivateCourt, suspendCourt, updateCourtPrice } from '../../services/CourtService';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
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
    <div className="relative overflow-hidden rounded-xl border border-[#dce2ee] bg-white">
      {/* Status indicator stripe */}
      <div
        className={`absolute inset-y-0 left-0 w-[3px] ${
          isMaintenance ? 'bg-[#d92d20]' : 'bg-[#17b26a]'
        }`}
      />

      <div className="p-5 pl-6">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold leading-snug text-[#1a2035]">
            {court.name}
          </h3>
          {isMaintenance ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#ffd6d6] bg-[#fff5f5] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#b42318]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#d92d20]" />
              Mantenimiento
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#ccebd7] bg-[#f0fbf4] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#167647]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#17b26a]" />
              Operativo
            </span>
          )}
        </div>

        {/* Activity type badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce2ee] bg-[#f8f9fc] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#6f7890]">
          <Activity size={11} strokeWidth={2.2} />
          {getCourtTypeLabel(court)}
        </span>

        {/* Price editor */}
        <div className="mt-4 rounded-xl border border-[#edf0f6] bg-[#f8f9fc] p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#98a1b3]">
            Precio base · {getPriceReferenceMinutes(court)} min
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-[#98a1b3]">
                $
              </span>
              <input
                type="number"
                min={0}
                className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white pl-7 pr-3 text-[13px] font-semibold text-[#2a3245] outline-none transition focus:border-[#3053e2]"
                value={priceEdit}
                onChange={(e) => onPriceChange(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={onPriceSave}
              className="h-10 shrink-0 rounded-lg bg-[#3053e2] px-4 text-[12px] font-semibold text-white transition hover:bg-[#2748cc]"
            >
              Guardar
            </button>
          </div>
        </div>

        {/* Action */}
        <div className="mt-3 border-t border-[#edf0f6] pt-3">
          {isMaintenance ? (
            <button
              type="button"
              onClick={onReactivate}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#17b26a] px-3 text-[12px] font-semibold text-white transition hover:bg-[#079455]"
            >
              <Power size={13} strokeWidth={2.4} />
              Reactivar cancha
            </button>
          ) : (
            <button
              type="button"
              onClick={onSuspend}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[#ffd6d6] bg-white px-3 text-[12px] font-semibold text-[#b42318] transition hover:bg-[#fff5f5]"
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

  // ── Modal helpers ──
  const closeModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  }, []);

  const wrapAction = useCallback(
    (action?: () => Promise<void> | void) => async () => {
      closeModal();
      await action?.();
    },
    [closeModal],
  );

  const showInfo = useCallback((message: ReactNode, title = 'Información') => {
    setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  }, []);

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
      showError(`Error: ${(error as Error).message}`);
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
        try {
          await suspendCourt(id);
          await loadCourts();
        } catch (error: unknown) {
          showError(`Error: ${(error as Error).message}`);
        }
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
        try {
          await reactivateCourt(id);
          await loadCourts();
        } catch (error: unknown) {
          showError(`Error: ${(error as Error).message}`);
        }
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
      showInfo('Precio actualizado', 'Listo');
      await loadCourts();
    } catch (error: unknown) {
      showError(`Error: ${(error as Error).message}`);
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
          valueColor="#3053e2"
        />
        <MetricCard
          label="Operativas"
          value={activeCourts}
          format="number"
          valueColor="#167647"
        />
        <MetricCard
          label="Mantenimiento"
          value={maintenanceCourts}
          format="number"
          valueColor={maintenanceCourts > 0 ? '#b45309' : undefined}
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
          <div className="flex items-center justify-center py-10 text-[13px] font-semibold text-[#98a1b3]">
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
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm}
        closeOnBackdrop={modalState.closeOnBackdrop}
        closeOnEscape={modalState.closeOnEscape}
      />
    </div>
  );
}
