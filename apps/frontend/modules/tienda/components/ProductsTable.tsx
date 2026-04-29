import type { ReactNode } from 'react';
import { ArrowRight, Edit, Trash2 } from 'lucide-react';
import { AdminDataTable, AdminPanel } from '../../../components/admin/ui';
import type { AdminDataTableColumn } from '../../../components/admin/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProductRow = {
  id: number;
  name: string;
  price: number;
  stock?: number;
  category?: string;
  isCombo?: boolean;
  components?: unknown[];
  baseStock?: number;
  [key: string]: unknown;
};

type ProductsTableProps = {
  products: ProductRow[];
  loading: boolean;
  onEdit: (p: ProductRow) => void;
  onDelete: (p: ProductRow) => void;
  onRowClick?: (p: ProductRow) => void;
  selectedId?: string | number | null;
  className?: string;
  toolbar?: ReactNode;
};

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(
  onEdit: (p: ProductRow) => void,
  onDelete: (p: ProductRow) => void,
  onRowClick?: (p: ProductRow) => void,
): AdminDataTableColumn<ProductRow>[] {
  return [
    {
      key: 'name',
      label: 'Producto',
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-[#2a3245]">{p.name}</p>
          {p.category && (
            <p className="mt-0.5 truncate text-[11px] text-[#98a1b3]">{p.category}</p>
          )}
        </div>
      ),
    },
    {
      key: 'isCombo',
      label: 'Tipo',
      render: (p) => (
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            p.isCombo
              ? 'border-[#c7d2ff] bg-[#eef1ff] text-[#3053e2]'
              : 'border-[#dce2ee] bg-[#f5f7fb] text-[#6f7890]'
          }`}
        >
          {p.isCombo ? 'Combo' : 'Simple'}
        </span>
      ),
    },
    {
      key: 'stock',
      label: 'Stock',
      render: (p) => {
        if (p.isCombo) {
          return (
            <span className="text-[12px] text-[#98a1b3]">—</span>
          );
        }
        const qty = Number(p.stock ?? 0);
        const isLow = qty < 5;
        return (
          <span
            className={`inline-flex rounded-lg border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              isLow
                ? 'border-[#ffd6d6] bg-[#fff5f5] text-[#b42318]'
                : 'border-[#ccebd7] bg-[#f0fbf4] text-[#167647]'
            }`}
          >
            {qty} u.
          </span>
        );
      },
    },
    {
      key: 'price',
      label: 'Precio',
      render: (p) => (
        <span className="font-semibold text-[#2a3245]">
          ${Number(p.price || 0).toLocaleString('es-AR')}
        </span>
      ),
    },
    {
      key: '_actions',
      label: '',
      align: 'right',
      isActions: true,
      render: (p) => (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onEdit(p); }}
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce2ee] bg-white text-[#6f7890] transition hover:border-[#3053e2] hover:bg-[#eef1fd] hover:text-[#3053e2]"
            title="Editar"
          >
            <Edit size={15} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onDelete(p); }}
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#ffd6d6] bg-[#fff5f5] text-[#b42318] transition hover:bg-[#b42318] hover:text-white"
            title="Dar de baja"
          >
            <Trash2 size={15} strokeWidth={2.5} />
          </button>
          {onRowClick && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onRowClick(p); }}
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
 * ProductsTable — tabla de productos del catálogo.
 *
 * Encapsula PRODUCT_COLUMNS + AdminPanel + AdminDataTable.
 * Puramente presentacional: sin fetch, sin estado.
 */
export default function ProductsTable({
  products,
  loading,
  onEdit,
  onDelete,
  onRowClick,
  selectedId,
  className,
  toolbar,
}: ProductsTableProps) {
  return (
    <AdminPanel
      title="Catálogo de productos"
      description="Productos simples y combos disponibles para cargar en cuentas."
      actions={toolbar}
      headerClassName="pl-4 pr-2 py-3"
      bodyClassName="p-0"
    >
      <AdminDataTable
        columns={buildColumns(onEdit, onDelete, onRowClick)}
        data={products}
        rowKey={(p) => p.id}
        loading={loading}
        empty={{
          title: 'No hay productos registrados',
          description: 'Creá el primero con el botón "Nuevo producto".',
        }}
        onRowClick={onRowClick}
        rowClassName={(p) =>
          String(p.id) === String(selectedId ?? '')
            ? 'bg-[#eef1fd] [&>td:first-child]:shadow-[2px_0_0_0_#3053e2_inset]'
            : ''
        }
        className={className}
      />
    </AdminPanel>
  );
}
