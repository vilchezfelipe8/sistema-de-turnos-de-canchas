import { X, Tag, DollarSign, Box, Package, Pencil, Plus } from 'lucide-react';
import AdminDrawer, { AdminDrawerSection } from '../../../components/admin/ui/AdminDrawer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProductComponentRow = {
  componentProductId: string;
  quantity: string;
};

export type ProductFormData = {
  name: string;
  price: string;
  stock: string;
  category: string;
  isCombo: boolean;
  components: ProductComponentRow[];
};

export type ProductOption = {
  id: number | string;
  name: string;
};

type ProductDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** null = crear, objeto = editar */
  editingProduct: { id: number | string; name?: string } | null;
  /** Lista de productos disponibles para seleccionar como componentes de combos. */
  comboOptions: ProductOption[];
  formData: ProductFormData;
  formError: string;
  onFormChange: (data: ProductFormData) => void;
  onAddComponent: () => void;
  onRemoveComponent: (index: number) => void;
  onUpdateComponent: (index: number, field: 'componentProductId' | 'quantity', value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
};

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputClass =
  'h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#2a3245] placeholder:text-[#8b93a5] outline-none transition-all focus:border-[#3053e2]';
const labelClass = 'mb-1.5 block text-[12px] font-medium text-[#4e5870]';
const sectionCardClass = 'rounded-2xl border border-[#dce2ee] bg-[#f8f9fd] p-4';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ProductDrawer — drawer de creación y edición de productos.
 *
 * Puramente presentacional: sin estado propio, sin fetch.
 * Toda la lógica y el estado viven en ProductsPage.
 */
export default function ProductDrawer({
  open,
  onClose,
  editingProduct,
  comboOptions,
  formData,
  formError,
  onFormChange,
  onAddComponent,
  onRemoveComponent,
  onUpdateComponent,
  onSubmit,
}: ProductDrawerProps) {
  const isEditing = Boolean(editingProduct);

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="h-10 rounded-xl border border-[#dce2ee] bg-white px-4 text-[13px] font-semibold text-[#4e5870] transition hover:bg-[#f8f9fc]"
      >
        Cancelar
      </button>
      <button
        form="product-drawer-form"
        type="submit"
        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
      >
        {isEditing ? <Pencil size={14} /> : <Plus size={14} />}
        {isEditing ? 'Guardar cambios' : 'Confirmar ingreso'}
      </button>
    </div>
  );

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title={isEditing ? 'Editar producto' : 'Nuevo producto'}
      subtitle="Inventario del club"
      size="md"
      footer={footer}
    >
      <form id="product-drawer-form" onSubmit={onSubmit}>
        {/* ── Datos generales ── */}
        <AdminDrawerSection title="Datos generales" className={sectionCardClass}>
          <div>
            <label className={labelClass}>Nombre del producto</label>
            <div className="relative">
              <input
                required
                placeholder="Ej: Gatorade Blue"
                className={`${inputClass} pl-10`}
                value={formData.name}
                onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
              />
              <Tag
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b3]"
                size={15}
                strokeWidth={2.5}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Tipo de producto</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onFormChange({ ...formData, isCombo: false })}
                className={`h-9 rounded-xl border text-[12px] font-semibold transition ${
                  !formData.isCombo
                    ? 'border-[#3053e2] bg-[#eef1fd] text-[#3053e2]'
                    : 'border-[#dce2ee] bg-white text-[#6f7890] hover:bg-[#f8f9fc]'
                }`}
              >
                Producto simple
              </button>
              <button
                type="button"
                onClick={() => onFormChange({ ...formData, isCombo: true })}
                className={`h-9 rounded-xl border text-[12px] font-semibold transition ${
                  formData.isCombo
                    ? 'border-[#3053e2] bg-[#eef1fd] text-[#3053e2]'
                    : 'border-[#dce2ee] bg-white text-[#6f7890] hover:bg-[#f8f9fc]'
                }`}
              >
                Combo
              </button>
            </div>
          </div>
        </AdminDrawerSection>

        {/* ── Precio y stock ── */}
        <AdminDrawerSection title="Precio y stock" className={`${sectionCardClass} mt-5`}>
          <div>
            <label className={labelClass}>Precio ($)</label>
            <div className="relative">
              <input
                required
                type="number"
                min="0"
                placeholder="0"
                className={`${inputClass} pl-10`}
                value={formData.price}
                onChange={(e) => onFormChange({ ...formData, price: e.target.value })}
                onWheel={(e) => e.currentTarget.blur()}
              />
              <DollarSign
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b3]"
                size={15}
                strokeWidth={2.5}
              />
            </div>
          </div>

          {!formData.isCombo && (
            <div>
              <label className={labelClass}>Stock inicial</label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min="0"
                  placeholder="0"
                  className={`${inputClass} pl-10`}
                  value={formData.stock}
                  onChange={(e) => onFormChange({ ...formData, stock: e.target.value })}
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <Box
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b3]"
                  size={15}
                  strokeWidth={2.5}
                />
              </div>
            </div>
          )}

          <div>
            <label className={labelClass}>Categoría (opcional)</label>
            <div className="relative">
              <input
                className={`${inputClass} pl-10`}
                placeholder="Ej: Bebidas, Grips, Alquiler..."
                value={formData.category}
                onChange={(e) => onFormChange({ ...formData, category: e.target.value })}
              />
              <Package
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b3]"
                size={15}
                strokeWidth={2.5}
              />
            </div>
          </div>
        </AdminDrawerSection>

        {/* ── Composición del combo ── */}
        {formData.isCombo && (
          <AdminDrawerSection title="Composición del combo" className={`${sectionCardClass} mt-5`}>
            <p className="text-[12px] text-[#6f7890]">
              Seleccioná los productos que forman el combo.
            </p>
            <div className="space-y-2">
              {formData.components.map((component, index) => (
                <div key={index} className="grid grid-cols-12 items-center gap-2">
                  <select
                    className="col-span-7 h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#2a3245] outline-none transition focus:border-[#3053e2]"
                    value={component.componentProductId}
                    onChange={(e) =>
                      onUpdateComponent(index, 'componentProductId', e.target.value)
                    }
                  >
                    <option value="">Seleccionar producto</option>
                    {comboOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="col-span-3 h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#2a3245] outline-none transition focus:border-[#3053e2]"
                    value={component.quantity}
                    onChange={(e) => onUpdateComponent(index, 'quantity', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveComponent(index)}
                    className="col-span-2 grid h-9 place-items-center rounded-lg border border-[#ffd6d6] bg-[#fff5f5] text-[#b42318] transition hover:bg-[#b42318] hover:text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onAddComponent}
              className="h-9 w-full rounded-lg border border-[#dce2ee] bg-white text-[12px] font-semibold text-[#3053e2] transition hover:bg-[#eef1fd]"
            >
              + Agregar componente
            </button>
          </AdminDrawerSection>
        )}

        {/* ── Error ── */}
        {formError && (
          <p className="mt-4 rounded-lg border border-[#ffd6d6] bg-[#fff5f5] px-3 py-2 text-[12px] font-semibold text-[#b42318]">
            {formError}
          </p>
        )}
      </form>
    </AdminDrawer>
  );
}
