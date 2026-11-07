'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus } from 'lucide-react';
import { ClubAdminService } from '../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import { showAdminToast } from '../utils/adminToast';
import AdminAppModal from './admin/ui/AdminAppModal';
import ProductDetailPanel, { minStockOf } from '../modules/tienda/components/ProductDetailPanel';
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
  /** Producto abierto en la ficha de la derecha. */
  const [selectedId, setSelectedId] = useState<number | null>(null);
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
      if (Number(deleteTarget.id) === Number(selectedId)) setSelectedId(null);
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

  const selectedProduct = useMemo(
    () => products.find((p) => Number(p.id) === Number(selectedId)) || null,
    [products, selectedId],
  );

  const summary = useMemo(() => {
    const simple = products.filter((p) => !p.isCombo);
    const lowStock = simple.filter((p) => Number(p.stock ?? 0) <= minStockOf(p));
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

      {/* ── Qué hay, buscar y agregar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[14px] text-p-text-secondary">
          <span className="font-semibold text-p-text">
            {summary.total === 1 ? '1 producto' : `${summary.total} productos`}
          </span>
          {' · '}
          <span className="tabular-nums">${Number(summary.stockValue || 0).toLocaleString('es-AR')}</span> en stock
          {' · '}
          {summary.lowStock > 0 ? (
            <span className="font-semibold text-p-warning">
              {summary.lowStock === 1 ? '1 para reponer' : `${summary.lowStock} para reponer`}
            </span>
          ) : (
            'nada para reponer'
          )}
        </p>
        <label className="relative w-full sm:w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-p-text-muted" size={14} />
          <input
            type="text"
            placeholder="Buscar producto"
            className="h-10 w-full rounded-xl border border-p-border bg-p-surface pl-9 pr-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 hover:bg-ink-800"
        >
          <Plus size={15} strokeWidth={2.5} />
          Nuevo producto
        </button>
      </div>

      {/* ── Lista a la izquierda, ficha a la derecha ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className={selectedProduct ? 'max-lg:hidden' : ''}>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-p-surface-2" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-p-border px-4 py-10 text-center">
              <p className="text-[14px] font-semibold text-p-text-secondary">
                {searchTerm.trim() ? 'No hay productos con ese nombre' : 'Todavía no cargaste productos'}
              </p>
              <p className="mt-1 text-[12px] text-p-text-muted">
                {searchTerm.trim() ? 'Probá con otra palabra.' : 'Agregá bebidas, pelotas o lo que vendas en el mostrador.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-p-border overflow-hidden rounded-2xl border border-p-border bg-p-surface">
              {filteredProducts.map((product) => {
                const stock = Number(product.stock ?? 0);
                const low = !product.isCombo && stock <= minStockOf(product);
                const isSelected = Number(selectedId) === Number(product.id);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(Number(product.id))}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                        isSelected ? 'bg-p-surface-2' : 'hover:bg-p-surface-2'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-p-text">{product.name}</p>
                        <p className="truncate text-[12px] text-p-text-muted">
                          {[product.category, product.isCombo ? 'Combo' : null].filter(Boolean).join(' · ') || 'Sin categoría'}
                        </p>
                      </div>
                      <div className="flex flex-none items-center gap-4">
                        <span
                          className={`text-[13px] tabular-nums ${low ? 'font-semibold text-p-warning' : 'text-p-text-secondary'}`}
                        >
                          {product.isCombo ? 'Según sus productos' : low ? `Quedan ${stock} · reponer` : `${stock} en stock`}
                        </span>
                        <span className="w-20 text-right text-[14px] font-semibold tabular-nums text-p-text">
                          ${Number(product.price || 0).toLocaleString('es-AR')}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={`${selectedProduct ? '' : 'max-lg:hidden'} lg:sticky lg:top-0 lg:max-h-[calc(100vh-220px)]`}>
          {selectedProduct ? (
            <ProductDetailPanel
              slug={slug}
              product={selectedProduct}
              allProducts={products}
              onBack={() => setSelectedId(null)}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onStockChanged={() => void loadProducts()}
            />
          ) : (
            <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-p-border px-6 text-center">
              <p className="text-[13px] text-p-text-muted">Elegí un producto para ver su stock y cargar lo que entra o sale.</p>
            </div>
          )}
        </div>
      </div>

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
