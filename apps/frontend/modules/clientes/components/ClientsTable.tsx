import { Pencil, Trash2, ArrowRight } from 'lucide-react';
import AdminDataTable, { type AdminDataTableColumn } from '../../../components/admin/ui/AdminDataTable';
import type { AdminClient } from '../hooks/useClients';
import MemberBadge from '../../../components/admin/members/MemberBadge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (amount: number) =>
  `$${Number(amount || 0).toLocaleString('es-AR')}`;

const formatRelativeDate = (iso: string | null, timeZone?: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)} sem.`;
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    ...(timeZone ? { timeZone } : {})
  });
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClientsTableProps = {
  clients: AdminClient[];
  loading?: boolean;
  onRowClick?: (client: AdminClient) => void;
  onEdit?: (client: AdminClient) => void;
  onDelete?: (client: AdminClient) => void;
  /** Used to highlight the currently selected client in a split view. */
  selectedId?: string | number | null;
  className?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ClientsTable — wraps AdminDataTable with AdminClient-specific columns.
 *
 * Columns: Nombre · Teléfono · Última reserva · Deuda · Acciones
 *
 * @example
 * <ClientsTable clients={filteredClients} loading={loading} onRowClick={handleSelect} />
 */
export default function ClientsTable({
  clients,
  loading = false,
  onRowClick,
  onEdit,
  onDelete,
  selectedId,
  className,
}: ClientsTableProps) {
  const columns: AdminDataTableColumn<AdminClient>[] = [
    {
      key: 'name',
      label: 'Nombre',
      render: (c) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-p-text">{c.name}</span>
          <MemberBadge member={c.member} />
        </span>
      ),
    },
    {
      key: 'phone',
      label: 'Teléfono',
      render: (c) => (
        <span className="text-p-text-secondary">{c.phone || '—'}</span>
      ),
    },
    {
      key: 'lastBookingAt',
      label: 'Última reserva',
      render: (c) => (
        <span className="text-p-text-muted">{formatRelativeDate(c.lastBookingAt, c.clubTimeZone)}</span>
      ),
    },
    {
      key: 'totalDebt',
      label: 'Deuda',
      align: 'right',
      render: (c) =>
        c.totalDebt > 0 ? (
          <span className="inline-flex items-center rounded-full border border-p-error bg-p-error-bg px-2.5 py-0.5 text-[11px] font-semibold text-[var(--error-fg)]">
            {formatMoney(c.totalDebt)}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-p-positive">Al día</span>
        ),
    },
    {
      key: '_actions',
      label: '',
      align: 'right',
      isActions: true,
      render: (c) => (
        <div className="flex items-center justify-end gap-2">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(c); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-p-border bg-p-surface text-p-text-muted transition hover:border-p-accent hover:bg-p-positive-bg hover:text-p-accent"
              title="Editar cliente"
            >
              <Pencil size={15} strokeWidth={2.5} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(c); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-p-error bg-p-error-bg text-[var(--error-fg)] transition hover:bg-[var(--error-fg)] hover:text-ink-50"
              title="Eliminar cliente"
            >
              <Trash2 size={15} strokeWidth={2.5} />
            </button>
          )}
          {onRowClick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRowClick(c); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-p-border bg-p-surface text-p-text-muted transition hover:border-p-accent hover:bg-p-positive-bg hover:text-p-accent"
              title="Ver perfil"
            >
              <ArrowRight size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const getInitials = (name: string) =>
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';

  return (
    <div className="min-h-0 w-full overflow-y-auto lg:contents">
      <div className="hidden lg:contents">
        <AdminDataTable<AdminClient>
          columns={columns}
          data={clients}
          rowKey={(c) => c.id}
          loading={loading}
          empty={{
            title: 'No hay clientes',
            description: 'Intentá con otra búsqueda o agregá un cliente nuevo.',
          }}
          onRowClick={onRowClick}
          rowClassName={(c) =>
            String(c.id) === String(selectedId ?? '')
              ? 'bg-p-positive-bg [&>td:first-child]:shadow-[2px_0_0_0_var(--accent-fg)_inset]'
              : ''
          }
          className={['w-full', className].filter(Boolean).join(' ')}
        />
      </div>

      <div className="lg:hidden">
        {loading ? (
          <div className="grid place-items-center p-10">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-p-border border-t-p-accent" />
          </div>
        ) : clients.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[14px] font-semibold text-p-text-muted">No hay clientes</p>
            <p className="mt-1 text-[12px] text-p-text-muted">Intentá con otra búsqueda o agregá un cliente nuevo.</p>
          </div>
        ) : (
          <ul className="divide-y divide-p-border">
            {clients.map((c) => {
              const isSelected = String(c.id) === String(selectedId ?? '');
              const secondary = [c.dni ? `DNI ${c.dni}` : '', c.phone || ''].filter(Boolean).join(' · ') || c.email || '—';
              return (
                <li key={String(c.id)}>
                  <button
                    type="button"
                    onClick={() => onRowClick?.(c)}
                    className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition ${
                      isSelected ? 'bg-p-positive-bg' : 'hover:bg-p-surface-2'
                    }`}
                  >
                    <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-p-surface-3 text-[12px] font-extrabold text-p-text">
                      {getInitials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[14px] font-bold text-p-text">{c.name}</span>
                        <MemberBadge member={c.member} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-p-text-muted">{secondary}</span>
                    </span>
                    {c.totalDebt > 0 ? (
                      <span className="shrink-0 text-[12px] font-extrabold text-[var(--error-fg)]">{formatMoney(c.totalDebt)}</span>
                    ) : (
                      <span className="shrink-0 text-[12px] font-semibold text-p-text-muted">Al día</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
