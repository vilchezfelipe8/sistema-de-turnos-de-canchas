import { X } from 'lucide-react';
import AdminDrawer from '../../../components/admin/ui/AdminDrawer';
import { AdminInlineError } from '../../../components/admin/ui';

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
  /** Avisar para reponer cuando queden esta cantidad o menos. */
  minStock: string;
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
  /** Categorías ya usadas, para sugerir. */
  categories?: string[];
  formData: ProductFormData;
  formError: string;
  fieldErrors?: Record<string, string>;
  submitting?: boolean;
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
  'h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-border-strong';
const labelClass = 'mb-1 block text-[13px] font-medium text-p-text';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ProductDrawer — crear o editar un producto: nombre, precio, categoría y cuándo avisar
 * para reponer. El stock solo se carga al crearlo; después se mueve desde la ficha.
 */
export default function ProductDrawer({
  open,
  onClose,
  editingProduct,
  comboOptions,
  categories = [],
  formData,
  formError,
  fieldErrors,
  submitting = false,
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
        disabled={submitting}
        className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2"
      >
        Cancelar
      </button>
      <button
        form="product-drawer-form"
        type="submit"
        disabled={submitting}
        className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:opacity-60"
      >
        {submitting ? 'Guardando...' : isEditing ? 'Guardar cambios' : formData.isCombo ? 'Crear combo' : 'Crear producto'}
      </button>
    </div>
  );

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title={isEditing ? `Editar ${editingProduct?.name || 'producto'}` : formData.isCombo ? 'Nuevo combo' : 'Nuevo producto'}
      subtitle={!isEditing ? 'Lo que vendés en el mostrador: bebidas, pelotas, alquileres…' : undefined}
      size="md"
      footer={footer}
    >
      <form id="product-drawer-form" onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Nombre</span>
          <input
            required
            autoFocus={!isEditing}
            placeholder="Agua 500ml"
            className={inputClass}
            value={formData.name}
            onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
          />
          <AdminInlineError>{fieldErrors?.name}</AdminInlineError>
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Precio</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-p-text-muted">$</span>
              <input
                required
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="1800"
                className={`${inputClass} pl-7`}
                value={formData.price}
                onChange={(e) => onFormChange({ ...formData, price: e.target.value })}
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
            <AdminInlineError>{fieldErrors?.price}</AdminInlineError>
          </label>

          <label className="block">
            <span className={labelClass}>
              Categoría <span className="font-normal text-p-text-muted">(opcional)</span>
            </span>
            <input
              list="product-categories"
              className={inputClass}
              placeholder="Bebidas"
              value={formData.category}
              onChange={(e) => onFormChange({ ...formData, category: e.target.value })}
            />
            <datalist id="product-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <AdminInlineError>{fieldErrors?.category}</AdminInlineError>
          </label>
        </div>

        {!formData.isCombo && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!isEditing && (
              <label className="block">
                <span className={labelClass}>¿Cuántas tenés hoy?</span>
                <input
                  required
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  className={inputClass}
                  value={formData.stock}
                  onChange={(e) => onFormChange({ ...formData, stock: e.target.value })}
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <AdminInlineError>{fieldErrors?.stock}</AdminInlineError>
              </label>
            )}
            <label className="block">
              <span className={labelClass}>Avisame cuando queden</span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="5"
                  className={`${inputClass} pr-24`}
                  value={formData.minStock}
                  onChange={(e) => onFormChange({ ...formData, minStock: e.target.value })}
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-p-text-muted">
                  o menos
                </span>
              </div>
              <AdminInlineError>{fieldErrors?.minStock}</AdminInlineError>
            </label>
          </div>
        )}

        {!formData.isCombo && isEditing && (
          <p className="text-[12px] text-p-text-muted">
            El stock se cambia desde la ficha del producto (Entró mercadería, Conté o Se rompió), así queda registrado.
          </p>
        )}

        {/* Combo: una opción aparte, al final. */}
        <label className="flex cursor-pointer items-start gap-2.5 border-t border-p-border pt-4">
          <input
            type="checkbox"
            checked={formData.isCombo}
            onChange={(e) => onFormChange({ ...formData, isCombo: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-p-brand"
          />
          <span>
            <span className="block text-[14px] font-medium text-p-text">Es un combo</span>
            <span className="block text-[12px] text-p-text-muted">
              Se arma con otros productos (ej: 2 aguas + 1 pelota). Al venderlo descuenta el stock de cada uno.
            </span>
          </span>
        </label>

        {formData.isCombo && (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-p-text">Qué lleva</p>
            {formData.components.map((component, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  aria-label="Producto"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none focus:border-p-border-strong"
                  value={component.componentProductId}
                  onChange={(e) => onUpdateComponent(index, 'componentProductId', e.target.value)}
                >
                  <option value="">Elegí un producto</option>
                  {comboOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="text-[13px] text-p-text-muted">×</span>
                <input
                  aria-label="Cantidad"
                  type="number"
                  min="1"
                  className="h-11 w-16 rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none focus:border-p-border-strong"
                  value={component.quantity}
                  onChange={(e) => onUpdateComponent(index, 'quantity', e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Sacar"
                  onClick={() => onRemoveComponent(index)}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg text-p-text-muted hover:bg-p-surface-2 hover:text-p-text"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <AdminInlineError>{fieldErrors?.components || fieldErrors?.productId}</AdminInlineError>
            <button
              type="button"
              onClick={onAddComponent}
              className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
            >
              + Agregar otro producto
            </button>
          </div>
        )}

        {formError && (
          <p className="rounded-lg bg-p-error-bg px-3 py-2 text-[12px] font-semibold text-p-error">{formError}</p>
        )}
      </form>
    </AdminDrawer>
  );
}
