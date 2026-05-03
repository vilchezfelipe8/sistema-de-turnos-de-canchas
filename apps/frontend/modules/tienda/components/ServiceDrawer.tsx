import { Tag, DollarSign, Pencil, Plus } from 'lucide-react';
import AdminDrawer, { AdminDrawerSection } from '../../../components/admin/ui/AdminDrawer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceFormData = {
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
  onFormChange: (data: ServiceFormData) => void;
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
 * ServiceDrawer — drawer de creación y edición de servicios.
 *
 * Puramente presentacional: sin estado propio, sin fetch.
 * Toda la lógica y el estado viven en ServicesPage.
 */
export default function ServiceDrawer({
  open,
  onClose,
  editingService,
  formData,
  formError,
  onFormChange,
  onSubmit,
}: ServiceDrawerProps) {
  const isEditing = Boolean(editingService);

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
        form="service-drawer-form"
        type="submit"
        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#3053e2] px-5 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
      >
        {isEditing ? <Pencil size={14} /> : <Plus size={14} />}
        {isEditing ? 'Guardar cambios' : 'Crear servicio'}
      </button>
    </div>
  );

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title={isEditing ? 'Editar servicio' : 'Nuevo servicio'}
      subtitle="Catálogo de servicios del club"
      size="sm"
      footer={footer}
    >
      <form id="service-drawer-form" onSubmit={onSubmit}>
        {/* ── Datos generales ── */}
        <AdminDrawerSection title="Identificación" className={sectionCardClass}>
          <div>
            <label className={labelClass}>Código del servicio</label>
            <div className="relative">
              <input
                required
                value={formData.code}
                onChange={(e) =>
                  onFormChange({ ...formData, code: e.target.value.toUpperCase() })
                }
                className={`${inputClass} pl-10`}
                placeholder="Ej: CLASE_PARTICULAR"
              />
              <Tag
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b3]"
                size={15}
                strokeWidth={2.5}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Nombre</label>
            <input
              required
              value={formData.name}
              onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
              className={inputClass}
              placeholder="Ej: Clase particular"
            />
          </div>
        </AdminDrawerSection>

        {/* ── Precio ── */}
        <AdminDrawerSection title="Precio" className={`${sectionCardClass} mt-5`}>
          <div>
            <label className={labelClass}>Precio ($)</label>
            <div className="relative">
              <input
                required
                type="number"
                min={0.01}
                step="0.01"
                value={formData.price}
                onChange={(e) => onFormChange({ ...formData, price: e.target.value })}
                className={`${inputClass} pl-10`}
                placeholder="0.00"
                onWheel={(e) => e.currentTarget.blur()}
              />
              <DollarSign
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#98a1b3]"
                size={15}
                strokeWidth={2.5}
              />
            </div>
          </div>
        </AdminDrawerSection>

        {/* ── Descripción ── */}
        <AdminDrawerSection title="Descripción" className={`${sectionCardClass} mt-5`}>
          <div>
            <label className={labelClass}>Detalle descriptivo (opcional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
              className="min-h-[80px] w-full resize-none rounded-xl border border-[#dce2ee] bg-white px-3 py-2.5 text-[13px] text-[#2a3245] placeholder:text-[#8b93a5] outline-none transition focus:border-[#3053e2]"
              placeholder="Información adicional para el equipo"
            />
          </div>
        </AdminDrawerSection>

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
