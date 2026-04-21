'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Search, Plus, Edit, Trash2, Wrench, Tag, DollarSign, X } from 'lucide-react';
import { ClubAdminService, type ClubCatalogService } from '../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import AppModal from './AppModal';

const ModalPortal = ({ children, onClose }: { children: ReactNode; onClose: () => void }) => {
  const backdropMouseDownRef = useRef(false);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-[#347048]/60 p-4"
      onMouseDown={(event) => {
        backdropMouseDownRef.current = event.target === event.currentTarget;
      }}
      onTouchStart={(event) => {
        backdropMouseDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const startedOnBackdrop = backdropMouseDownRef.current;
        backdropMouseDownRef.current = false;
        if (startedOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="density-compact relative z-10 w-full max-w-md bg-[#EBE1D8] border-2 border-white rounded-[2rem] shadow-2xl flex flex-col max-h-[93vh] overflow-hidden text-[#347048]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
};

type ServicesPageProps = {
  slug: string;
};

type ServiceFormState = {
  code: string;
  name: string;
  description: string;
  price: string;
};

const EMPTY_FORM: ServiceFormState = {
  code: '',
  name: '',
  description: '',
  price: ''
};

export default function ServicesPage({ slug }: ServicesPageProps) {
  const [services, setServices] = useState<ClubCatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClubCatalogService | null>(null);
  const [form, setForm] = useState<ServiceFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<ClubCatalogService | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    isWarning?: boolean;
  }>({ show: false, title: 'Informacion', message: '' });

  const loadServices = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await ClubAdminService.getServices(slug, true);
      setServices(rows);
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudieron cargar los servicios.');
      reportUiError({ area: 'ServicesPage', action: 'loadServices' }, error);
      setFeedbackModal({
        show: true,
        title: 'Error',
        message,
        isWarning: true
      });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) void loadServices();
  }, [slug, loadServices]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEdit = (row: ClubCatalogService) => {
    setEditing(row);
    setForm({
      code: row.code || '',
      name: row.name || '',
      description: row.description || '',
      price: String(row.price || '')
    });
    setIsModalOpen(true);
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price)
      };
      if (editing) {
        await ClubAdminService.updateService(slug, editing.id, payload);
      } else {
        await ClubAdminService.createService(slug, payload);
      }
      setIsModalOpen(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      await loadServices();
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo guardar el servicio.');
      reportUiError({ area: 'ServicesPage', action: 'submitForm' }, error);
      setFeedbackModal({ show: true, title: 'Error', message, isWarning: true });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await ClubAdminService.deleteService(slug, deleteTarget.id);
      setDeleteTarget(null);
      await loadServices();
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo eliminar el servicio.');
      reportUiError({ area: 'ServicesPage', action: 'confirmDelete' }, error);
      setFeedbackModal({ show: true, title: 'Error', message, isWarning: true });
    } finally {
      setDeleting(false);
    }
  };

  const filtered = services.filter((row) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      String(row.code || '').toLowerCase().includes(term) ||
      String(row.name || '').toLowerCase().includes(term)
    );
  });

  const inputClass = 'compact-field w-full h-10 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all';
  const labelClass = 'block text-[10px] font-black text-[#347048]/60 mb-1.5 uppercase tracking-widest ml-1';

  return (
    <>
      <div className="density-compact flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-5">
        <div className="relative flex-1 w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40 group-focus-within:text-[#B9CF32]" size={18} strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Buscar por codigo o nombre..."
            className="compact-field w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl pl-12 pr-4 py-2.5 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={openNew}
          className="compact-field w-full sm:w-auto px-5 py-2.5 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-[#347048]/20 uppercase tracking-widest text-xs italic"
        >
          <Plus size={18} strokeWidth={3} /> Nuevo servicio
        </button>
      </div>

      <div className="density-compact bg-white/40 border-2 border-white rounded-[1.5rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-separate border-spacing-y-1.5 px-3">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/40">
                <th className="px-4 py-3">Codigo</th>
                <th className="px-4 py-3">Servicio</th>
                <th className="px-4 py-3">Precio</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="text-sm font-bold">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-20 text-center text-[#347048]/40">
                    Cargando servicios...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-20 text-center text-[#347048]/30 italic uppercase tracking-widest font-black">
                    No hay servicios registrados
                  </td>
                </tr>
              ) : (
                filtered.map((service) => (
                  <tr key={service.id} className="bg-white/80 hover:bg-white transition-all shadow-sm">
                    <td className="px-4 py-3 first:rounded-l-2xl text-[#926699] font-black uppercase">{service.code}</td>
                    <td className="px-4 py-3 text-[#347048] font-black">{service.name}</td>
                    <td className="px-4 py-3 text-base font-black text-[#347048] italic tracking-tighter">
                      ${Number(service.price || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-black px-3 py-1 rounded-full border uppercase tracking-widest ${service.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                        {service.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 last:rounded-r-2xl text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(service)}
                          className="p-2 rounded-xl bg-white border border-[#347048]/10 text-[#347048] hover:bg-[#347048] hover:text-[#EBE1D8] transition-all shadow-sm"
                          title="Editar"
                        >
                          <Edit size={16} strokeWidth={2.5} />
                        </button>
                        {service.isActive && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(service)}
                            className="p-2 rounded-xl bg-red-50 border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm"
                            title="Dar de baja"
                          >
                            <Trash2 size={16} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <ModalPortal onClose={() => setIsModalOpen(false)}>
          <div className="flex justify-between items-start mb-5 border-b border-[#347048]/10 pb-4">
            <div>
              <h3 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tighter">
                <div className="bg-[#926699] p-2 rounded-xl text-[#EBE1D8] shadow-lg shadow-[#926699]/20">
                  {editing ? <Edit size={24} strokeWidth={2.5} /> : <Wrench size={24} strokeWidth={3} />}
                </div>
                {editing ? 'Editar servicio' : 'Nuevo servicio'}
              </h3>
              <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mt-2 ml-1">Catalogo de servicios del club</p>
            </div>
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
            >
              <X size={20} strokeWidth={3} />
            </button>
          </div>

            <form onSubmit={submitForm} className="space-y-4">
            <div>
              <label className={labelClass}>Codigo del servicio</label>
              <div className="relative">
                <input
                  required
                  value={form.code}
                  onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  className={`${inputClass} pl-12`}
                  placeholder="Ej: CLASE_PARTICULAR"
                />
                <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40" size={18} strokeWidth={2.5} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Nombre</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className={inputClass}
                placeholder="Ej: Clase particular"
              />
            </div>

            <div>
              <label className={labelClass}>Precio</label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  className={`${inputClass} pl-12`}
                  placeholder="0.00"
                  onWheel={(event) => event.currentTarget.blur()}
                />
                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40" size={18} strokeWidth={2.5} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Descripcion</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full min-h-[88px] bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 py-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all resize-none"
                placeholder="Detalle opcional del servicio"
              />
            </div>

            <button
              type="submit"
              className="compact-field w-full h-10 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-xl uppercase tracking-widest text-xs"
            >
              {editing ? 'Guardar cambios' : 'Crear servicio'}
            </button>
          </form>
        </ModalPortal>
      )}

      <AppModal
        show={Boolean(deleteTarget)}
        title="Dar de baja servicio"
        message={`Vas a dar de baja el servicio "${deleteTarget?.name || ''}".`}
        cancelText="Cancelar"
        confirmText={deleting ? 'Eliminando...' : 'Si, dar de baja'}
        isWarning
        onClose={() => {
          if (deleting) return;
          setDeleteTarget(null);
        }}
        onCancel={() => {
          if (deleting) return;
          setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

      <AppModal
        show={feedbackModal.show}
        title={feedbackModal.title}
        message={feedbackModal.message}
        isWarning={feedbackModal.isWarning}
        confirmText="Entendido"
        cancelText=""
        onClose={() => setFeedbackModal((prev) => ({ ...prev, show: false }))}
      />
    </>
  );
}
