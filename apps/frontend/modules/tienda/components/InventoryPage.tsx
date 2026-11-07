'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, PackagePlus, PackageMinus, Plus, Trash2 } from 'lucide-react';
import {
  ClubAdminService,
  type StockMovement,
  type StockMovementType,
} from '../../../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { showAdminToast } from '../../../utils/adminToast';
import { AdminInlineError, AdminModal, AdminPanel } from '../../../components/admin/ui';
import { STOCK_MOVEMENT_TEXT, formatStockWhen } from './ProductDetailPanel';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type InventoryProduct = {
  id: number;
  name: string;
  category?: string | null;
  price: number;
  stock: number;
  minStock?: number;
  isCombo?: boolean;
};

type ModalKind = 'entry' | 'count' | 'waste' | null;

type DraftRow = { productId: string; quantity: string; unitCost: string };

const TYPE_FILTERS: Array<{ value: '' | StockMovementType; label: string }> = [
  { value: '', label: 'Todos los movimientos' },
  { value: 'SALE', label: STOCK_MOVEMENT_TEXT.SALE },
  { value: 'PURCHASE', label: STOCK_MOVEMENT_TEXT.PURCHASE },
  { value: 'WASTE', label: STOCK_MOVEMENT_TEXT.WASTE },
  { value: 'ADJUSTMENT', label: STOCK_MOVEMENT_TEXT.ADJUSTMENT },
  { value: 'SALE_REVERSAL', label: STOCK_MOVEMENT_TEXT.SALE_REVERSAL },
  { value: 'MANUAL_EDIT', label: STOCK_MOVEMENT_TEXT.MANUAL_EDIT },
  { value: 'INITIAL', label: STOCK_MOVEMENT_TEXT.INITIAL },
];

const emptyRow = (): DraftRow => ({ productId: '', quantity: '', unitCost: '' });

const inputClass =
  'h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-border-strong';

const primaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-3.5 text-[13px] font-semibold text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60';

const secondaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-p-border bg-p-surface px-3.5 text-[13px] font-semibold text-p-text transition hover:bg-p-surface-2';

const minStockOf = (product: InventoryProduct) => Number(product.minStock ?? 5);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InventoryPage({ slug = '' }: { slug?: string }) {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [filterProductId, setFilterProductId] = useState('');
  const [filterType, setFilterType] = useState<'' | StockMovementType>('');

  const [modal, setModal] = useState<ModalKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');
  const [entrySupplier, setEntrySupplier] = useState('');
  const [entryDocument, setEntryDocument] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftRows, setDraftRows] = useState<DraftRow[]>([emptyRow()]);
  const [countDraft, setCountDraft] = useState<Record<number, string>>({});

  // ── Data loading ──
  const loadProducts = useCallback(async () => {
    try {
      setLoadingProducts(true);
      const data = (await ClubAdminService.getProducts(slug)) as InventoryProduct[];
      setProducts(data.filter((product) => !product.isCombo));
    } catch (error) {
      reportUiError({ area: 'InventoryPage', action: 'loadProducts' }, error);
      setLoadError(extractErrorMessage(error, 'No se pudieron cargar los productos.'));
    } finally {
      setLoadingProducts(false);
    }
  }, [slug]);

  const loadMovements = useCallback(
    async (cursor?: string) => {
      try {
        if (cursor) setLoadingMore(true);
        else setLoadingMovements(true);
        const page = await ClubAdminService.getStockMovements(slug, {
          productId: filterProductId ? Number(filterProductId) : undefined,
          type: filterType || undefined,
          limit: 50,
          cursor,
        });
        setMovements((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (error) {
        reportUiError({ area: 'InventoryPage', action: 'loadMovements' }, error);
        setLoadError(extractErrorMessage(error, 'No se pudo cargar el historial de stock.'));
      } finally {
        setLoadingMovements(false);
        setLoadingMore(false);
      }
    },
    [slug, filterProductId, filterType],
  );

  useEffect(() => {
    if (slug) void loadProducts();
  }, [slug, loadProducts]);

  useEffect(() => {
    if (slug) void loadMovements();
  }, [slug, loadMovements]);

  // ── Derived state ──
  const lowStockProducts = useMemo(
    () =>
      products
        .filter((product) => Number(product.stock || 0) <= minStockOf(product))
        .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)),
    [products],
  );

  const summary = useMemo(
    () => ({
      units: products.reduce((sum, product) => sum + Number(product.stock || 0), 0),
      value: products.reduce((sum, product) => sum + Number(product.stock || 0) * Number(product.price || 0), 0),
    }),
    [products],
  );

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const countChanges = useMemo(
    () =>
      products
        .filter((product) => countDraft[product.id] !== undefined && countDraft[product.id] !== '')
        .map((product) => ({
          product,
          counted: Number(countDraft[product.id]),
          diff: Number(countDraft[product.id]) - Number(product.stock || 0),
        }))
        .filter((row) => Number.isFinite(row.counted)),
    [products, countDraft],
  );

  // ── Modal handlers ──
  const openModal = (kind: Exclude<ModalKind, null>) => {
    setModal(kind);
    setModalError('');
    setEntrySupplier('');
    setEntryDocument('');
    setDraftNotes('');
    setDraftRows([emptyRow()]);
    setCountDraft({});
  };

  const closeModal = () => {
    if (submitting) return;
    setModal(null);
  };

  const updateDraftRow = (index: number, field: keyof DraftRow, value: string) =>
    setDraftRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const refreshAll = () => {
    void loadProducts();
    void loadMovements();
  };

  const submitRows = async () => {
    const rows = draftRows
      .filter((row) => row.productId && row.quantity)
      .map((row) => ({
        productId: Number(row.productId),
        quantity: Number(row.quantity),
        unitCost: row.unitCost === '' ? null : Number(row.unitCost),
      }));
    if (rows.length === 0) {
      setModalError('Cargá al menos un producto con cantidad.');
      return;
    }
    if (rows.some((row) => !Number.isInteger(row.quantity) || row.quantity <= 0)) {
      setModalError('Las cantidades tienen que ser números enteros mayores a 0.');
      return;
    }
    const ids = rows.map((row) => row.productId);
    if (new Set(ids).size !== ids.length) {
      setModalError('Repetiste un producto: sumá las cantidades en una sola fila.');
      return;
    }

    try {
      setSubmitting(true);
      setModalError('');
      if (modal === 'entry') {
        await ClubAdminService.createStockEntry(slug, {
          supplier: entrySupplier.trim() || undefined,
          documentNumber: entryDocument.trim() || undefined,
          notes: draftNotes.trim() || undefined,
          items: rows,
        });
        showAdminToast('Ingreso registrado.');
      } else {
        await ClubAdminService.createStockWaste(slug, {
          reason: draftNotes.trim() || undefined,
          items: rows.map(({ productId, quantity }) => ({ productId, quantity })),
        });
        showAdminToast('Merma registrada.');
      }
      setModal(null);
      refreshAll();
    } catch (error) {
      reportUiError({ area: 'InventoryPage', action: modal === 'entry' ? 'createEntry' : 'createWaste' }, error);
      setModalError(extractErrorMessage(error, 'No se pudo guardar el movimiento.'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitCount = async () => {
    if (countChanges.length === 0) {
      setModalError('Cargá la cantidad contada de al menos un producto.');
      return;
    }
    if (countChanges.some((row) => !Number.isInteger(row.counted) || row.counted < 0)) {
      setModalError('Las cantidades contadas tienen que ser enteros desde 0.');
      return;
    }
    try {
      setSubmitting(true);
      setModalError('');
      const result = await ClubAdminService.createStockCount(slug, {
        notes: draftNotes.trim() || undefined,
        items: countChanges.map((row) => ({ productId: row.product.id, countedQuantity: row.counted })),
      });
      const adjusted = result.movements.length;
      showAdminToast(adjusted > 0 ? `Conteo guardado: ${adjusted} ajuste${adjusted === 1 ? '' : 's'}.` : 'Conteo guardado: todo coincide.');
      setModal(null);
      refreshAll();
    } catch (error) {
      reportUiError({ area: 'InventoryPage', action: 'createCount' }, error);
      setModalError(extractErrorMessage(error, 'No se pudo guardar el conteo.'));
    } finally {
      setSubmitting(false);
    }
  };

  const selectClass = `${inputClass} sm:w-[220px]`;

  // ── Render ──
  return (
    <div className="flex flex-col gap-3">
      {loadError && <AdminInlineError>{loadError}</AdminInlineError>}

      <p className="text-[14px] text-p-text-secondary">
        <span className="font-semibold text-p-text">{summary.units.toLocaleString('es-AR')} unidades</span> en stock ·{' '}
        <span className="tabular-nums">${summary.value.toLocaleString('es-AR')}</span> a precio de venta ·{' '}
        {lowStockProducts.length > 0 ? (
          <span className="font-semibold text-p-warning">
            {lowStockProducts.length === 1 ? '1 para reponer' : `${lowStockProducts.length} para reponer`}
          </span>
        ) : (
          'nada para reponer'
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButtonClass} onClick={() => openModal('entry')}>
          <PackagePlus size={15} strokeWidth={2.5} />
          Entró mercadería
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => openModal('count')}>
          <ClipboardCheck size={15} strokeWidth={2.5} />
          Contar todo
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => openModal('waste')}>
          <PackageMinus size={15} strokeWidth={2.5} />
          Se rompió o venció
        </button>
      </div>

      {lowStockProducts.length > 0 && (
        <div className="rounded-xl bg-p-warning-bg px-4 py-3 text-[14px] text-p-warning">
          <span className="font-semibold">Para reponer:</span>{' '}
          {lowStockProducts.map((product) => `${product.name} (quedan ${Number(product.stock || 0)})`).join(' · ')}
        </div>
      )}

      <AdminPanel
        title="Todo lo que entró y salió"
        actions={(
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Filtrar por producto"
              className={selectClass}
              value={filterProductId}
              onChange={(event) => setFilterProductId(event.target.value)}
            >
              <option value="">Todos los productos</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{product.name}</option>
              ))}
            </select>
            <select
              aria-label="Filtrar por tipo de movimiento"
              className={selectClass}
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as '' | StockMovementType)}
            >
              {TYPE_FILTERS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}
        bodyClassName="p-0"
      >
        {loadingMovements ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-p-surface-2" />
            ))}
          </div>
        ) : movements.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[14px] font-semibold text-p-text-secondary">Todavía no hay movimientos</p>
            <p className="mt-1 text-[12px] text-p-text-muted">Cargá mercadería o vendé algo y lo vas a ver acá.</p>
          </div>
        ) : (
          <ul className="divide-y divide-p-border">
            {movements.map((row) => {
              const detail = [
                row.supplier,
                row.documentNumber ? `remito ${row.documentNumber}` : null,
                row.unitCost != null ? `costo $${row.unitCost.toLocaleString('es-AR')}` : null,
                row.type !== 'SALE_REVERSAL' ? row.reason : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]"
                >
                  <p className="col-span-2 text-[12px] text-p-text-muted sm:col-span-1">{formatStockWhen(row.occurredAt)}</p>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-p-text">
                      <span className="font-semibold">{row.product.name}</span>
                      <span className="text-p-text-secondary"> · {STOCK_MOVEMENT_TEXT[row.type] || row.type}</span>
                    </p>
                    {(detail || row.createdBy?.name) && (
                      <p className="truncate text-[12px] text-p-text-muted">
                        {[detail, row.createdBy?.name ? `por ${row.createdBy.name}` : null].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className={`text-[14px] font-semibold tabular-nums ${row.quantity > 0 ? 'text-p-positive' : 'text-p-text'}`}>
                      {row.quantity > 0 ? '+' : row.quantity < 0 ? '−' : ''}
                      {Math.abs(row.quantity)}
                    </p>
                    <p className="text-[11px] tabular-nums text-p-text-muted">quedan {row.stockAfter}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <div className="flex justify-center border-t border-p-border p-3">
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={loadingMore}
              onClick={() => void loadMovements(nextCursor)}
            >
              {loadingMore ? 'Cargando...' : 'Ver más'}
            </button>
          </div>
        )}
      </AdminPanel>

      {/* ── Ingreso / merma ── */}
      <AdminModal
        open={modal === 'entry' || modal === 'waste'}
        title={modal === 'entry' ? 'Entró mercadería' : 'Se rompió o venció'}
        description={
          modal === 'entry'
            ? 'Lo que llegó del proveedor. Se suma al stock de cada producto.'
            : 'Roturas, vencimientos o lo que se usó en el club. Se descuenta sin contar como venta.'
        }
        onClose={closeModal}
        maxWidthClassName="max-w-[640px]"
        footer={(
          <>
            <button type="button" className={secondaryButtonClass} onClick={closeModal} disabled={submitting}>
              Cancelar
            </button>
            <button type="button" className={primaryButtonClass} onClick={() => void submitRows()} disabled={submitting}>
              {submitting ? 'Guardando...' : modal === 'entry' ? 'Sumar al stock' : 'Descontar del stock'}
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          {modal === 'entry' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-p-text">
                Proveedor (opcional)
                <input className={inputClass} value={entrySupplier} onChange={(e) => setEntrySupplier(e.target.value)} placeholder="Ej. Distribuidora Córdoba" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-p-text">
                Remito o factura (opcional)
                <input className={inputClass} value={entryDocument} onChange={(e) => setEntryDocument(e.target.value)} placeholder="Ej. 0001-00012345" />
              </label>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {draftRows.map((row, index) => {
              const selected = row.productId ? productById.get(Number(row.productId)) : undefined;
              return (
                <div key={index} className="grid grid-cols-[1fr_88px_auto] items-end gap-2 sm:grid-cols-[1fr_88px_110px_auto]">
                  <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold text-p-text-muted">
                    Producto
                    <select className={inputClass} value={row.productId} onChange={(e) => updateDraftRow(index, 'productId', e.target.value)}>
                      <option value="">Elegí un producto</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({Number(product.stock || 0)} u.)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-p-text-muted">
                    Cantidad
                    <input
                      className={inputClass}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={row.quantity}
                      onChange={(e) => updateDraftRow(index, 'quantity', e.target.value)}
                      placeholder={selected && modal === 'waste' ? `máx ${selected.stock}` : '0'}
                    />
                  </label>
                  {modal === 'entry' && (
                    <label className="col-span-2 flex flex-col gap-1 text-[11px] font-semibold text-p-text-muted sm:col-span-1">
                      Costo c/u
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={row.unitCost}
                        onChange={(e) => updateDraftRow(index, 'unitCost', e.target.value)}
                        placeholder="Opcional"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    aria-label="Quitar fila"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-p-border text-p-text-muted transition hover:border-p-error hover:text-[var(--error-fg)] disabled:opacity-40"
                    disabled={draftRows.length === 1}
                    onClick={() => setDraftRows((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-p-accent"
              onClick={() => setDraftRows((prev) => [...prev, emptyRow()])}
            >
              <Plus size={14} strokeWidth={2.5} />
              Agregar producto
            </button>
          </div>

          <label className="flex flex-col gap-1 text-[12px] font-semibold text-p-text">
            {modal === 'entry' ? 'Nota (opcional)' : 'Qué pasó (opcional)'}
            <input
              className={inputClass}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              placeholder={modal === 'entry' ? 'Opcional' : 'Ej. Se rompieron 2 botellas'}
            />
          </label>

          {modalError && <AdminInlineError>{modalError}</AdminInlineError>}
        </div>
      </AdminModal>

      {/* ── Conteo físico ── */}
      <AdminModal
        open={modal === 'count'}
        title="Contar todo el stock"
        description="Poné cuántas unidades contaste de cada producto. Solo se corrigen los que completes y no coincidan."
        onClose={closeModal}
        maxWidthClassName="max-w-[640px]"
        footer={(
          <>
            <span className="mr-auto text-[12px] text-p-text-muted">
              {countChanges.filter((row) => row.diff !== 0).length === 1 ? '1 no coincide' : `${countChanges.filter((row) => row.diff !== 0).length} no coinciden`}
            </span>
            <button type="button" className={secondaryButtonClass} onClick={closeModal} disabled={submitting}>
              Cancelar
            </button>
            <button type="button" className={primaryButtonClass} onClick={() => void submitCount()} disabled={submitting}>
              {submitting ? 'Guardando...' : 'Guardar conteo'}
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-p-border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-p-surface-2 text-left text-[11px] uppercase tracking-wide text-p-text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Producto</th>
                  <th className="px-3 py-2 text-right font-semibold">Figura</th>
                  <th className="w-[96px] px-3 py-2 font-semibold">Contaste</th>
                  <th className="w-[80px] px-3 py-2 text-right font-semibold">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const raw = countDraft[product.id] ?? '';
                  const diff = raw === '' ? null : Number(raw) - Number(product.stock || 0);
                  return (
                    <tr key={product.id} className="border-t border-p-border">
                      <td className="px-3 py-1.5 font-semibold text-p-text">{product.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-p-text-muted">{Number(product.stock || 0)}</td>
                      <td className="px-3 py-1.5">
                        <input
                          aria-label={`Cantidad contada de ${product.name}`}
                          className={`${inputClass} h-8`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          value={raw}
                          onChange={(e) => setCountDraft((prev) => ({ ...prev, [product.id]: e.target.value }))}
                        />
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                          diff == null || diff === 0 ? 'text-p-text-muted' : diff > 0 ? 'text-p-positive' : 'text-[var(--error-fg)]'
                        }`}
                      >
                        {diff == null || !Number.isFinite(diff) ? '—' : diff > 0 ? `+${diff}` : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-p-text">
            Nota (opcional)
            <input className={inputClass} value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="Ej. conteo de fin de mes" />
          </label>
          {modalError && <AdminInlineError>{modalError}</AdminInlineError>}
        </div>
      </AdminModal>
    </div>
  );
}
