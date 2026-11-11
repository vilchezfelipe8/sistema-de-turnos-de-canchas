'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { ClubAdminService, type ClubCatalogService } from '../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { showAdminToast } from '../utils/adminToast';
import AdminAppModal from './admin/ui/AdminAppModal';

import ServicesTable from '../modules/tienda/components/ServicesTable';
import ServiceDrawer from '../modules/tienda/components/ServiceDrawer';
import type { ServiceFormData } from '../modules/tienda/components/ServiceDrawer';
import { getApiFieldErrors } from '../utils/apiError';

type ServicesPageProps = {
  slug: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_FORM: ServiceFormData = { code: '', name: '', description: '', price: '' };

/** "Alquiler de paleta" → "ALQUILER_DE_PALETA" (código interno que pide el servidor). */
const codeFromName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'SERVICIO';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServicesPage({ slug }: ServicesPageProps) {
  const [services, setServices] = useState<ClubCatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ClubCatalogService | null>(null);
  const [form, setForm] = useState<ServiceFormData>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});
  const [submittingForm, setSubmittingForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClubCatalogService | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    isWarning?: boolean;
  }>({ show: false, title: 'Información', message: '' });

  // ── Data loading ──
  const loadServices = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await ClubAdminService.getServices(slug, true);
      setServices(rows);
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudieron cargar los servicios.');
      reportUiError({ area: 'ServicesPage', action: 'loadServices' }, error);
      setFeedbackModal({ show: true, title: 'Error', message, isWarning: true });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) void loadServices();
  }, [slug, loadServices]);

  // ── Drawer handlers ──
  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormFieldErrors({});
    setDrawerOpen(true);
  };

  const openEdit = (row: ClubCatalogService) => {
    setEditing(row);
    setForm({
      code: row.code || '',
      name: row.name || '',
      description: row.description || '',
      price: String(row.price || ''),
    });
    setFormError('');
    setFormFieldErrors({});
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setForm(EMPTY_FORM);
    setEditing(null);
    setFormError('');
    setFormFieldErrors({});
  };

  const handleFormChange = (next: ServiceFormData) => {
    setFormFieldErrors({});
    setForm(next);
  };

  // ── Form submit ──
  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingForm) return;
    setFormError('');
    setFormFieldErrors({});
    try {
      setSubmittingForm(true);
      const payload = {
        code: form.code.trim() || codeFromName(form.name),
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price),
      };
      if (editing) {
        await ClubAdminService.updateService(slug, editing.id, payload);
        closeDrawer();
        await loadServices();
        showAdminToast('Servicio actualizado.');
      } else {
        await ClubAdminService.createService(slug, payload);
        closeDrawer();
        await loadServices();
        showAdminToast('Servicio creado.');
      }
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo guardar el servicio.');
      const fieldErrors = getApiFieldErrors(error);
      reportUiError({ area: 'ServicesPage', action: 'submitForm' }, error);
      if (Object.keys(fieldErrors).length > 0) setFormFieldErrors(fieldErrors);
      setFormError(message);
    } finally {
      setSubmittingForm(false);
    }
  };

  // ── Delete ──
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await ClubAdminService.deleteService(slug, deleteTarget.id);
      setDeleteTarget(null);
      await loadServices();
      showAdminToast('Servicio dado de baja.');
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo eliminar el servicio.');
      reportUiError({ area: 'ServicesPage', action: 'confirmDelete' }, error);
      setFeedbackModal({ show: true, title: 'Error', message, isWarning: true });
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived state ──
  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return services;
    return services.filter(
      (row) =>
        String(row.code || '').toLowerCase().includes(term) ||
        String(row.name || '').toLowerCase().includes(term),
    );
  }, [services, searchTerm]);

  const summary = useMemo(() => {
    const active = services.filter((s) => s.isActive).length;
    const inactive = services.length - active;
    return { total: services.length, active, inactive };
  }, [services]);

  // ── Render ──
  return (
    <div className="flex flex-col gap-3">

      {/* ── Qué hay, buscar y agregar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[14px] text-p-text-secondary">
          {summary.active === 0 ? (
            'Todavía no cargaste servicios.'
          ) : (
            <>
              <span className="font-semibold text-p-text">
                {summary.active === 1 ? '1 servicio' : `${summary.active} servicios`}
              </span>
              {summary.inactive > 0 ? ` · ${summary.inactive} dados de baja` : ''}
            </>
          )}
        </p>
        {services.length > 0 && (
          <label className="relative w-full sm:w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" size={14} />
            <input
              type="text"
              placeholder="Buscar servicio"
              className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          onClick={openNew}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
        >
          <Plus size={15} strokeWidth={2.5} />
          Nuevo servicio
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-p-surface-2" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-p-border px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-p-text">Cobrá cosas que no tienen stock</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-p-text-muted">
            Por ejemplo: alquiler de paleta, clase particular, encordado o uso del vestuario. Después los cargás en la cuenta
            de una reserva o en una venta de mostrador.
          </p>
          <button
            type="button"
            onClick={openNew}
            className="mt-4 h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
          >
            Crear el primero
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-p-border px-4 py-8 text-center text-[13px] text-p-text-muted">
          No hay servicios con ese nombre.
        </p>
      ) : (
        <ul className="divide-y divide-p-border overflow-hidden rounded-2xl border border-p-border bg-p-surface">
          {filtered.map((service) => (
            <li key={service.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <button type="button" onClick={() => openEdit(service)} className="min-w-0 flex-1 text-left">
                <p className={`truncate text-[14px] font-semibold ${service.isActive ? 'text-p-text' : 'text-p-text-muted line-through'}`}>
                  {service.name}
                </p>
                {service.description ? (
                  <p className="truncate text-[12px] text-p-text-muted">{String(service.description)}</p>
                ) : !service.isActive ? (
                  <p className="text-[12px] text-p-text-muted">Dado de baja</p>
                ) : null}
              </button>
              <span className="text-[14px] font-semibold tabular-nums text-p-text">
                ${Number(service.price || 0).toLocaleString('es-AR')}
              </span>
              {service.isActive && (
                <button
                  type="button"
                  onClick={() => setDeleteTarget(service)}
                  className="text-[12px] font-semibold text-p-text-muted hover:text-p-text hover:underline underline-offset-2"
                >
                  Dar de baja
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Drawer ── */}
      <ServiceDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        editingService={editing}
        formData={form}
        formError={formError}
        fieldErrors={formFieldErrors}
        submitting={submittingForm}
        onFormChange={handleFormChange}
        onSubmit={(e) => void submitForm(e)}
      />

      {/* ── Delete confirmation ── */}
      <AdminAppModal
        show={Boolean(deleteTarget)}
        title="Dar de baja servicio"
        message={`Vas a dar de baja el servicio "${deleteTarget?.name || ''}".`}
        cancelText="Cancelar"
        confirmText={deleting ? 'Eliminando...' : 'Sí, dar de baja'}
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
        confirmDisabled={deleting}
      />

      {/* ── Feedback modal ── */}
      <AdminAppModal
        show={feedbackModal.show}
        title={feedbackModal.title}
        message={feedbackModal.message}
        isWarning={feedbackModal.isWarning}
        confirmText="Entendido"
        cancelText=""
        onClose={() => setFeedbackModal((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
}
