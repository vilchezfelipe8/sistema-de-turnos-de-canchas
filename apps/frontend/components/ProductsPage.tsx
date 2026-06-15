'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus } from 'lucide-react';
import { ClubAdminService } from '../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { showAdminToast } from '../utils/adminToast';
import AdminAppModal from './admin/ui/AdminAppModal';
import { AdminFilterToolbar, MetricCard } from './admin/ui';
import ProductsTable from '../modules/tienda/components/ProductsTable';
import ProductDrawer from '../modules/tienda/components/ProductDrawer';
import type { ProductFormData } from '../modules/tienda/components/ProductDrawer';
import type { ProductRow } from '../modules/tienda/components/ProductsTable';
import { getApiFieldErrors } from '../utils/apiError';

interface ProductsPageProps {
  slug?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const emptyForm = (): ProductFormData => ({
  name: '',
  price: '',
  stock: '',
  category: '',
  isCombo: false,
  components: [{ componentProductId: '', quantity: '1' }],
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProductsPage({ slug = '' }: ProductsPageProps) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});
  const [submittingForm, setSubmittingForm] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    isWarning?: boolean;
  }>({ show: false, title: 'Información', message: '' });
  const [formData, setFormData] = useState<ProductFormData>(emptyForm());

  // ── Data loading ──
  const loadProducts = useCallback(async () => {
    try {
      const data = await ClubAdminService.getProducts(slug);
      setProducts(data as ProductRow[]);
    } catch (error) {
      reportUiError({ area: 'ProductsPage', action: 'loadProducts' }, error);
      setFeedbackModal({
        show: true,
        title: 'Error',
        message: 'No se pudieron cargar los productos.',
        isWarning: true,
      });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) void loadProducts();
  }, [slug, loadProducts]);

  // ── Drawer handlers ──
  const openNew = () => {
    setEditingProduct(null);
    setFormData(emptyForm());
    setFormError('');
    setFormFieldErrors({});
    setDrawerOpen(true);
  };

  const openEdit = (product: ProductRow) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: String(product.price),
      stock: String((product.baseStock as number | undefined) ?? product.stock ?? 0),
      category: (product.category as string) || '',
      isCombo: Boolean(product.isCombo),
      components:
        Array.isArray(product.components) && product.components.length > 0
          ? (product.components as Array<{ componentProductId: number; quantity: number }>).map(
              (c) => ({
                componentProductId: String(c.componentProductId),
                quantity: String(c.quantity),
              }),
            )
          : [{ componentProductId: '', quantity: '1' }],
    });
    setFormError('');
    setFormFieldErrors({});
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingProduct(null);
    setFormData(emptyForm());
    setFormError('');
    setFormFieldErrors({});
  };

  // ── Form submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingForm) return;
    setFormError('');
    setFormFieldErrors({});

    const components = formData.components
      .map((c) => ({
        componentProductId: Number(c.componentProductId),
        quantity: Number(c.quantity),
      }))
      .filter(
        (c) =>
          Number.isFinite(c.componentProductId) &&
          c.componentProductId > 0 &&
          Number.isFinite(c.quantity) &&
          c.quantity > 0,
      );

    if (formData.isCombo) {
      if (components.length === 0) {
        setFormFieldErrors({ components: 'Un combo debe tener al menos un componente.' });
        setFormError('Un combo debe tener al menos un componente.');
        return;
      }
      const ids = components.map((c) => c.componentProductId);
      if (new Set(ids).size !== ids.length) {
        setFormFieldErrors({ components: 'No podés repetir el mismo producto en un combo.' });
        setFormError('No podés repetir el mismo producto en un combo.');
        return;
      }
      if (editingProduct && ids.includes(Number(editingProduct.id))) {
        setFormFieldErrors({ components: 'Un producto no puede ser componente de sí mismo.' });
        setFormError('Un producto no puede ser componente de sí mismo.');
        return;
      }
    }

    try {
      setSubmittingForm(true);
      const payload = {
        name: formData.name,
        price: Number(formData.price),
        stock: formData.isCombo ? 0 : Number(formData.stock),
        category: formData.category,
        isCombo: formData.isCombo,
        components: formData.isCombo ? components : [],
      };
      if (editingProduct) {
        await ClubAdminService.updateProduct(slug, editingProduct.id, payload);
        closeDrawer();
        void loadProducts();
        showAdminToast('Producto actualizado.');
      } else {
        await ClubAdminService.createProduct(slug, payload);
        closeDrawer();
        void loadProducts();
        showAdminToast('Producto creado.');
      }
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo guardar el producto.');
      const fieldErrors = getApiFieldErrors(error);
      reportUiError({ area: 'ProductsPage', action: 'saveProduct' }, error);
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
      await ClubAdminService.deleteProduct(slug, deleteTarget.id);
      setDeleteTarget(null);
      void loadProducts();
      showAdminToast('Producto dado de baja.');
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo dar de baja el producto.');
      reportUiError({ area: 'ProductsPage', action: 'deleteProduct' }, error);
      setFeedbackModal({ show: true, title: 'Error', message, isWarning: true });
    } finally {
      setDeleting(false);
    }
  };

  // ── Combo component rows ──
  const addComponentRow = () =>
    setFormData((prev) => ({
      ...prev,
      components: [...prev.components, { componentProductId: '', quantity: '1' }],
    }));

  const handleFormChange = (next: ProductFormData) => {
    setFormFieldErrors({});
    setFormData(next);
  };

  const removeComponentRow = (index: number) =>
    setFormData((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== index),
    }));

  const updateComponentRow = (
    index: number,
    field: 'componentProductId' | 'quantity',
    value: string,
  ) =>
    setFormData((prev) => ({
      ...prev,
      components: prev.components.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    }));

  // ── Derived state ──
  const filteredProducts = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [products, searchTerm],
  );

  const comboOptions = useMemo(
    () => products.filter((p) => !editingProduct || p.id !== editingProduct.id),
    [products, editingProduct],
  );

  const summary = useMemo(() => {
    const simple = products.filter((p) => !p.isCombo);
    const lowStock = simple.filter((p) => Number(p.stock ?? 0) < 5);
    const stockValue = simple.reduce(
      (sum, p) => sum + Number(p.stock ?? 0) * Number(p.price ?? 0),
      0,
    );
    return {
      lowStock: lowStock.length,
      stockValue,
      total: products.length,
    };
  }, [products]);

  // ── Render ──
  return (
    <div className="flex flex-col gap-3">

      {/* ── Summary metrics ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Bajo stock"
          value={summary.lowStock}
          format="number"
          valueColor={summary.lowStock > 0 ? 'var(--error-fg)' : undefined}
          delta={
            summary.lowStock > 0
              ? { value: -summary.lowStock, label: 'productos con menos de 5 u.' }
              : { value: 0, label: 'sin alertas de stock' }
          }
        />
        <MetricCard
          label="Valor en stock"
          value={summary.stockValue}
          format="money"
          delta={{ value: summary.total, label: 'productos activos' }}
        />
      </div>

      {/* ── Table ── */}
      <ProductsTable
        products={filteredProducts}
        loading={loading}
        onEdit={openEdit}
        onDelete={setDeleteTarget}
        onRowClick={openEdit}
        selectedId={editingProduct?.id ?? null}
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
                placeholder="Buscar por nombre de producto..."
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
              Nuevo producto
            </button>
          </AdminFilterToolbar>
        )}
      />

      {/* ── Drawer ── */}
      <ProductDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        editingProduct={editingProduct}
        comboOptions={comboOptions}
        formData={formData}
        formError={formError}
        fieldErrors={formFieldErrors}
        submitting={submittingForm}
        onFormChange={handleFormChange}
        onAddComponent={addComponentRow}
        onRemoveComponent={removeComponentRow}
        onUpdateComponent={updateComponentRow}
        onSubmit={handleSubmit}
      />

      {/* ── Delete confirmation ── */}
      <AdminAppModal
        show={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onCancel={() => setDeleteTarget(null)}
        title="Dar de baja producto"
        message={
          deleteTarget ? (
            <span>
              <strong>{deleteTarget.name}</strong> no se va a borrar definitivamente. Lo vamos a
              dar de baja para que no aparezca en el stock ni en los consumos.
            </span>
          ) : null
        }
        cancelText="Cancelar"
        confirmText={deleting ? 'Dando de baja...' : 'Dar de baja'}
        isWarning
        onConfirm={() => void confirmDelete()}
        confirmDisabled={deleting}
      />

      {/* ── Feedback modal ── */}
      <AdminAppModal
        show={feedbackModal.show}
        onClose={() => setFeedbackModal((prev) => ({ ...prev, show: false }))}
        title={feedbackModal.title}
        message={feedbackModal.message}
        cancelText=""
        confirmText="Aceptar"
        isWarning={feedbackModal.isWarning}
      />
    </div>
  );
}
