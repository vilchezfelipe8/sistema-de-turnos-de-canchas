import { Pencil, Trash2, ArrowRight } from 'lucide-react';
import AdminDataTable, { type AdminDataTableColumn } from '../../../components/admin/ui/AdminDataTable';
import type { AdminClient } from '../hooks/useClients';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (amount: number) =>
  `$${Number(amount || 0).toLocaleString('es-AR')}`;

const formatRelativeDate = (iso: string | null): string => {
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
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
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
        <span className="font-semibold text-[#1a2035]">{c.name}</span>
      ),
    },
    {
      key: 'phone',
      label: 'Teléfono',
      render: (c) => (
        <span className="text-[#4e5870]">{c.phone || '—'}</span>
      ),
    },
    {
      key: 'lastBookingAt',
      label: 'Última reserva',
      render: (c) => (
        <span className="text-[#6f7890]">{formatRelativeDate(c.lastBookingAt)}</span>
      ),
    },
    {
      key: 'totalDebt',
      label: 'Deuda',
      align: 'right',
      render: (c) =>
        c.totalDebt > 0 ? (
          <span className="inline-flex items-center rounded-full border border-[#ffd6d6] bg-[#fff5f5] px-2.5 py-0.5 text-[11px] font-semibold text-[#b42318]">
            {formatMoney(c.totalDebt)}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-[#167647]">Al día</span>
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
              className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce2ee] bg-white text-[#6f7890] transition hover:border-[#3053e2] hover:bg-[#eef1fd] hover:text-[#3053e2]"
              title="Editar cliente"
            >
              <Pencil size={15} strokeWidth={2.5} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(c); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-[#ffd6d6] bg-[#fff5f5] text-[#b42318] transition hover:bg-[#b42318] hover:text-white"
              title="Eliminar cliente"
            >
              <Trash2 size={15} strokeWidth={2.5} />
            </button>
          )}
          {onRowClick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRowClick(c); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce2ee] bg-white text-[#6f7890] transition hover:border-[#bfcffe] hover:bg-[#eef1fd] hover:text-[#3053e2]"
              title="Ver perfil"
            >
              <ArrowRight size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
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
          ? 'bg-[#eef1fd] [&>td:first-child]:shadow-[2px_0_0_0_#3053e2_inset]'
          : ''
      }
      className={['w-full', className].filter(Boolean).join(' ')}
    />
  );
}
