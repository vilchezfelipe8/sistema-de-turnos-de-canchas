import type { ReactNode } from 'react';
import { ArrowRight, Edit, Trash2 } from 'lucide-react';
import { AdminDataTable, AdminPanel } from '../../../components/admin/ui';
import type { AdminDataTableColumn } from '../../../components/admin/ui';
import type { ClubCatalogService } from '../../../services/ClubAdminService';

type ServicesTableProps = {
  services: ClubCatalogService[];
  loading: boolean;
  onEdit: (s: ClubCatalogService) => void;
  onDelete: (s: ClubCatalogService) => void;
  onRowClick?: (s: ClubCatalogService) => void;
  selectedId?: string | number | null;
  className?: string;
  toolbar?: ReactNode;
};

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(
  onEdit: (s: ClubCatalogService) => void,
  onDelete: (s: ClubCatalogService) => void,
  onRowClick?: (s: ClubCatalogService) => void,
): AdminDataTableColumn<ClubCatalogService>[] {
  return [
    {
      key: 'code',
      label: 'Código',
      render: (s) => (
        <span className="font-mono text-[12px] font-semibold uppercase tracking-wide text-[#3053e2]">
          {s.code}
        </span>
      ),
    },
    {
      key: 'name',
      label: 'Servicio',
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-[#2a3245]">{s.name}</p>
          {s.description && (
            <p className="mt-0.5 truncate text-[11px] text-[#98a1b3]">{s.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'price',
      label: 'Precio',
      render: (s) => (
        <span className="font-semibold text-[#2a3245]">
          ${Number(s.price || 0).toLocaleString('es-AR')}
        </span>
      ),
    },
    {
      key: 'isActive',
      label: 'Estado',
      render: (s) => (
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            s.isActive
              ? 'border-[#ccebd7] bg-[#f0fbf4] text-[#167647]'
              : 'border-[#ffd6d6] bg-[#fff5f5] text-[#b42318]'
          }`}
        >
          {s.isActive ? 'Activo' : 'Inactivo'}
        </span>
      ),
    },
    {
      key: '_actions',
      label: '',
      align: 'right',
      isActions: true,
      render: (s) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onEdit(s); }}
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce2ee] bg-white text-[#6f7890] transition hover:border-[#3053e2] hover:bg-[#eef1fd] hover:text-[#3053e2]"
            title="Editar"
          >
            <Edit size={15} strokeWidth={2.5} />
          </button>
          {s.isActive && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onDelete(s); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-[#ffd6d6] bg-[#fff5f5] text-[#b42318] transition hover:bg-[#b42318] hover:text-white"
              title="Dar de baja"
            >
              <Trash2 size={15} strokeWidth={2.5} />
            </button>
          )}
          {onRowClick && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onRowClick(s); }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce2ee] bg-white text-[#6f7890] transition hover:border-[#bfcffe] hover:bg-[#eef1fd] hover:text-[#3053e2]"
              title="Ver detalle"
            >
              <ArrowRight size={15} strokeWidth={2.5} />
            </button>
          )}
        </div>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ServicesTable — tabla de servicios del catálogo.
 *
 * Encapsula SERVICE_COLUMNS + AdminPanel + AdminDataTable.
 * Puramente presentacional: sin fetch, sin estado.
 */
export default function ServicesTable({
  services,
  loading,
  onEdit,
  onDelete,
  onRowClick,
  selectedId,
  className,
  toolbar,
}: ServicesTableProps) {
  return (
    <AdminPanel
      title="Catálogo de servicios"
      description="Servicios cobrables sin stock físico. Se cargan directamente en cuentas."
      actions={toolbar}
      headerClassName="pl-4 pr-2 py-3"
      className="w-full"
      bodyClassName="p-0"
    >
      <AdminDataTable
        columns={buildColumns(onEdit, onDelete, onRowClick)}
        data={services}
        rowKey={(s) => s.id}
        loading={loading}
        empty={{
          title: 'No hay servicios registrados',
          description: 'Creá el primero con el botón "Nuevo servicio".',
        }}
        onRowClick={onRowClick}
        rowClassName={(s) =>
          String(s.id) === String(selectedId ?? '')
            ? 'bg-[#eef1fd] [&>td:first-child]:shadow-[2px_0_0_0_#3053e2_inset]'
            : ''
        }
        className={['w-full', className].filter(Boolean).join(' ')}
      />
    </AdminPanel>
  );
}
