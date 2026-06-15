'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { ClubAdminService, type ClubCatalogService } from '../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { showAdminToast } from '../utils/adminToast';
import AdminAppModal from './admin/ui/AdminAppModal';
import { AdminFilterToolbar, MetricCard } from './admin/ui';
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
        code: form.code.trim(),
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

      {/* ── Summary metrics ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Servicios activos"
          value={summary.active}
          format="number"
          delta={{ value: summary.total, label: `de ${summary.total} en el catálogo` }}
        />
        <MetricCard
          label="Inactivos"
          value={summary.inactive}
          format="number"
          valueColor={summary.inactive > 0 ? 'var(--error-fg)' : undefined}
          delta={{ value: -summary.inactive, label: 'dados de baja' }}
        />
      </div>

      {/* ── Table ── */}
      <div className="w-full">
        <ServicesTable
          services={filtered}
          loading={loading}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onRowClick={openEdit}
          selectedId={editing?.id ?? null}
          toolbar={(
            <AdminFilterToolbar className="border-0 bg-transparent p-0 gap-1 sm:flex-nowrap sm:justify-end">
              <div className="relative w-full sm:w-[300px] sm:flex-none">
                <Search
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-p-text-muted"
                  size={14}
                  strokeWidth={2.5}
                />
                <input
                  type="text"
                  placeholder="Buscar por código o nombre..."
                  className="h-8 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[12px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={openNew}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-2.5 text-[11px] font-semibold text-ink-50 shadow-p-md transition hover:bg-ink-800 hover:shadow-p-md sm:w-auto"
              >
                <Plus size={14} strokeWidth={2.5} />
                Nuevo servicio
              </button>
            </AdminFilterToolbar>
          )}
        />
      </div>

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
