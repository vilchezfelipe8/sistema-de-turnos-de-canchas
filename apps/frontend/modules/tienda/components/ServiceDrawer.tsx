import AdminDrawer from '../../../components/admin/ui/AdminDrawer';
import { AdminInlineError } from '../../../components/admin/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceFormData = {
  /** Identificador interno: se arma solo con el nombre si está vacío. */
  code: string;
  name: string;
  description: string;
  price: string;
};

type ServiceDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** null = crear, objeto = editar */
  editingService: { id: number; name?: string } | null;
  formData: ServiceFormData;
  formError: string;
  fieldErrors?: Record<string, string>;
  submitting?: boolean;
  onFormChange: (data: ServiceFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
};

const inputClass =
  'h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-border-strong';
const labelClass = 'mb-1 block text-[13px] font-medium text-p-text';

/**
 * ServiceDrawer — crear o editar un servicio: nombre, precio y una descripción opcional.
 */
export default function ServiceDrawer({
  open,
  onClose,
  editingService,
  formData,
  formError,
  fieldErrors,
  submitting = false,
  onFormChange,
  onSubmit,
}: ServiceDrawerProps) {
  const isEditing = Boolean(editingService);

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
        form="service-drawer-form"
        type="submit"
        disabled={submitting}
        className="h-10 rounded-xl bg-ink-900 px-5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:opacity-60"
      >
        {submitting ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear servicio'}
      </button>
    </div>
  );

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title={isEditing ? `Editar ${editingService?.name || 'servicio'}` : 'Nuevo servicio'}
      subtitle={!isEditing ? 'Algo que cobrás sin stock: clase, alquiler de paleta, encordado…' : undefined}
      size="sm"
      footer={footer}
    >
      <form id="service-drawer-form" onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>Nombre</span>
          <input
            required
            autoFocus={!isEditing}
            value={formData.name}
            onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
            className={inputClass}
            placeholder="Alquiler de paleta"
          />
          <AdminInlineError>{fieldErrors?.name || fieldErrors?.code}</AdminInlineError>
        </label>

        <label className="block">
          <span className={labelClass}>Precio</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-p-text-muted">$</span>
            <input
              required
              type="number"
              min={0.01}
              step="0.01"
              inputMode="decimal"
              value={formData.price}
              onChange={(e) => onFormChange({ ...formData, price: e.target.value })}
              className={`${inputClass} pl-7`}
              placeholder="3000"
              onWheel={(e) => e.currentTarget.blur()}
            />
          </div>
          <AdminInlineError>{fieldErrors?.price}</AdminInlineError>
        </label>

        <label className="block">
          <span className={labelClass}>
            Descripción <span className="font-normal text-p-text-muted">(opcional)</span>
          </span>
          <textarea
            value={formData.description}
            onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
            className="min-h-[72px] w-full resize-none rounded-xl border border-p-border bg-p-surface px-3 py-2.5 text-[14px] text-p-text placeholder:text-p-text-muted outline-none focus:border-p-border-strong"
            placeholder="Ej: incluye pelotas"
          />
          <AdminInlineError>{fieldErrors?.description}</AdminInlineError>
        </label>

        {formError && (
          <p className="rounded-lg bg-p-error-bg px-3 py-2 text-[12px] font-semibold text-p-error">{formError}</p>
        )}
      </form>
    </AdminDrawer>
  );
}
