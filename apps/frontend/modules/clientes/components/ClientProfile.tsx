import { useState } from 'react';
import { Phone, Mail, CreditCard, ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import type { AdminClient } from '../hooks/useClients';
import MovementsTimeline, { type MovementsTimelineItem } from '../../../components/admin/ui/MovementsTimeline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (amount: number) =>
  `$${Number(amount || 0).toLocaleString('es-AR')}`;

const formatDate = (iso: string | null, timeZone?: string | null): string => {
  if (!iso) return '—';
  // YYYY-MM-DD (local date string from backend)
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {})
  });
};

const formatDateTime = (iso: string | null, timeZone?: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
};

const accountStatusLabel: Record<string, string> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
};

const paymentStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagado',
  DEBT: 'Con deuda',
  PARTIAL: 'Parcial',
};

const sourceTypeLabel: Record<string, string> = {
  BOOKING: 'Reserva',
  BAR: 'Bar',
  TABLE: 'Mesa',
  MANUAL: 'Manual',
};

const buildTimelineItems = (history: any[]): MovementsTimelineItem[] =>
  [...history]
    .sort((a, b) => {
      const ta = new Date(a?.createdAt || `${a?.date || ''}T${a?.time || '00:00'}:00`).getTime();
      const tb = new Date(b?.createdAt || `${b?.date || ''}T${b?.time || '00:00'}:00`).getTime();
      return tb - ta;
    })
    .map((entry: any, i) => {
      const totalAmount = Number(entry?.totalAmount || 0);
      const pending = Number(entry?.amount || 0);
      const paid = Math.max(0, totalAmount - pending);
      const hasPending = pending > 0.01;

      const sourceType = String(entry?.sourceType || '').toUpperCase();
      const sourceLabelStr = sourceTypeLabel[sourceType] || sourceType || 'Cuenta';
      const courtInfo = entry?.bookingId
        ? `Reserva #${entry.bookingId}${entry?.courtName ? ` · ${entry.courtName}` : ''}`
        : sourceLabelStr;

      const timeStr =
        entry?.time
          ? String(entry.time).substring(0, 5)
          : entry?.createdAt
          ? formatDateTime(entry.createdAt)
          : null;

      return {
        id: entry?.id ?? i,
        timeLabel: timeStr ?? undefined,
        label: courtInfo,
        sublabel: [
          `Total ${formatMoney(totalAmount)}`,
          paid > 0 ? `Pagado ${formatMoney(paid)}` : null,
          hasPending ? `Pendiente ${formatMoney(pending)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        amount: hasPending ? pending : totalAmount,
        type: hasPending ? 'expense' : 'income',
        badge: hasPending ? (
          <span className="inline-flex items-center rounded-full border border-p-error bg-p-error-bg px-2 py-0.5 text-[10px] font-semibold text-[var(--error-fg)]">
            {paymentStatusLabel[String(entry?.paymentStatus || '')] || 'Pendiente'}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-p-positive bg-p-positive-bg px-2 py-0.5 text-[10px] font-semibold text-p-positive">
            {accountStatusLabel[String(entry?.accountStatus || entry?.status || '')] || 'Cerrada'}
          </span>
        ),
      } satisfies MovementsTimelineItem;
    });

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-p-border py-2.5 last:border-b-0">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">
        {label}
      </span>
      <span className="text-right text-[13px] text-p-text">{value}</span>
    </div>
  );
}

type ProfileTab = 'info' | 'cuenta';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClientProfileProps = {
  client: AdminClient;
  /** Called on mobile when user taps ← Volver. */
  onBack?: () => void;
  onEdit?: (client: AdminClient) => void;
  onDelete?: (client: AdminClient) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ClientProfile — vista completa del perfil de un cliente.
 *
 * Desktop: embebible en el panel derecho de un split view.
 * Mobile: página full screen con botón ← Volver.
 *
 * Secciones: Datos básicos · Cuenta corriente (historial de cuentas/movimientos)
 */
export default function ClientProfile({
  client,
  onBack,
  onEdit,
  onDelete,
}: ClientProfileProps) {
  const [tab, setTab] = useState<ProfileTab>('info');

  const timelineItems = buildTimelineItems(client.history ?? []);
  const totalDebt = Number(client.totalDebt || 0);
  const hasDebt = totalDebt > 0.01;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-p-border bg-p-surface px-6 py-5">
        <div className="flex items-start gap-3">
          {/* Mobile back button */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-p-border bg-p-surface text-p-text-muted transition hover:bg-p-surface-2 md:hidden"
              aria-label="Volver"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold leading-tight text-p-text">
                {client.name}
              </h2>
              {client.isProfessor && (
                <span className="inline-flex rounded-full border border-p-accent bg-p-surface-2 px-2 py-0.5 text-[10px] font-semibold text-p-accent">
                  Profesor
                </span>
              )}
              {hasDebt && (
                <span className="inline-flex rounded-full border border-p-error bg-p-error-bg px-2 py-0.5 text-[10px] font-semibold text-[var(--error-fg)]">
                  Debe {formatMoney(totalDebt)}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {client.phone && (
                <span className="flex items-center gap-1 text-[12px] text-p-text-muted">
                  <Phone size={11} className="shrink-0" />
                  {client.phone}
                </span>
              )}
              {client.email && (
                <span className="flex items-center gap-1 text-[12px] text-p-text-muted">
                  <Mail size={11} className="shrink-0" />
                  {client.email}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(client)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-p-border bg-p-surface text-p-text-muted transition hover:border-p-border-strong hover:text-p-text"
              title="Editar cliente"
            >
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(client)}
              className="grid h-8 w-8 place-items-center rounded-lg border border-p-border bg-p-surface text-p-text-muted transition hover:border-p-error hover:bg-p-error-bg hover:text-[var(--error-fg)]"
              title="Eliminar cliente"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex shrink-0 gap-0 border-b border-p-border bg-p-surface px-6">
        {(
          [
            { id: 'info', label: 'Datos básicos' },
            { id: 'cuenta', label: `Cuenta corriente${timelineItems.length ? ` (${timelineItems.length})` : ''}` },
          ] as Array<{ id: ProfileTab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'border-b-2 px-4 py-3 text-[13px] font-medium transition-colors',
              tab === t.id
                ? 'border-p-accent text-p-accent'
                : 'border-transparent text-p-text-muted hover:text-p-text',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto bg-p-surface-2 px-6 py-5">
        {tab === 'info' && (
          <div className="space-y-4">
            {/* Datos de contacto */}
            <div className="rounded-xl border border-p-border bg-p-surface px-5 py-1">
              <DataRow label="DNI" value={client.dni && client.dni !== '-' ? client.dni : 'No informado'} />
              <DataRow label="Teléfono" value={client.phone || 'No informado'} />
              <DataRow label="Email" value={client.email || 'No informado'} />
              <DataRow label="Rol" value={client.isProfessor ? 'Profesor' : 'Cliente'} />
            </div>

            {/* Resumen de actividad */}
            <div className="rounded-xl border border-p-border bg-p-surface px-5 py-1">
              <DataRow label="Total reservas" value={String(client.totalBookings || 0)} />
              <DataRow label="Última reserva" value={formatDateTime(client.lastBookingAt, client.clubTimeZone)} />
              <DataRow label="Próxima reserva" value={formatDateTime(client.nextBookingAt, client.clubTimeZone)} />
              <DataRow
                label="Saldo pendiente"
                value={hasDebt ? formatMoney(totalDebt) : 'Al día'}
              />
            </div>
          </div>
        )}

        {tab === 'cuenta' && (
          <div className="rounded-xl border border-p-border bg-p-surface px-4 py-2">
            <MovementsTimeline
              items={timelineItems}
              emptyTitle="Sin cuentas registradas"
              emptyDescription="Este cliente aún no tiene cuentas asociadas en el sistema."
            />
          </div>
        )}
      </div>
    </div>
  );
}
