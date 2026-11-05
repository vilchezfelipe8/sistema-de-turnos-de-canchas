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
import {
  AdminDataTable,
  AdminInlineError,
  AdminModal,
  AdminPanel,
  MetricCard,
} from '../../../components/admin/ui';
import type { AdminDataTableColumn } from '../../../components/admin/ui';

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

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  INITIAL: 'Stock inicial',
  PURCHASE: 'Ingreso',
  SALE: 'Venta',
  SALE_REVERSAL: 'Anulación',
  ADJUSTMENT: 'Ajuste por conteo',
  WASTE: 'Merma',
  MANUAL_EDIT: 'Edición manual',
};

const TYPE_FILTERS: Array<{ value: '' | StockMovementType; label: string }> = [
  { value: '', label: 'Todos los movimientos' },
  { value: 'PURCHASE', label: 'Ingresos' },
  { value: 'SALE', label: 'Ventas' },
  { value: 'SALE_REVERSAL', label: 'Anulaciones' },
  { value: 'ADJUSTMENT', label: 'Ajustes por conteo' },
  { value: 'WASTE', label: 'Mermas' },
  { value: 'MANUAL_EDIT', label: 'Ediciones manuales' },
  { value: 'INITIAL', label: 'Stock inicial' },
];

const emptyRow = (): DraftRow => ({ productId: '', quantity: '', unitCost: '' });

const inputClass =
  'h-9 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[12px] text-p-text placeholder:text-p-text-muted outline-none transition focus:border-p-accent';

const primaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 text-[12px] font-semibold text-ink-50 shadow-p-md transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60';

const secondaryButtonClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text transition hover:border-p-accent hover:bg-p-positive-bg';

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

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

  // ── Table ──
  const columns: AdminDataTableColumn<StockMovement>[] = [
    {
      key: 'occurredAt',
      label: 'Fecha',
      width: 'w-[130px]',
      render: (row) => <span className="text-[12px] text-p-text-muted">{formatDateTime(row.occurredAt)}</span>,
    },
    {
      key: 'product',
      label: 'Producto',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-p-text">{row.product.name}</p>
          {row.product.category && <p className="mt-0.5 truncate text-[11px] text-p-text-muted">{row.product.category}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Movimiento',
      render: (row) => (
        <span className="whitespace-nowrap rounded-full border border-p-border bg-p-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-p-text-muted">
          {MOVEMENT_LABELS[row.type]}
        </span>
      ),
    },
    {
      key: 'quantity',
      label: 'Cantidad',
      align: 'right',
      render: (row) => (
        <span className={`font-semibold tabular-nums ${row.quantity > 0 ? 'text-p-positive' : 'text-[var(--error-fg)]'}`}>
          {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
        </span>
      ),
    },
    {
      key: 'stockAfter',
      label: 'Saldo',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-p-text">
          <span className="text-p-text-muted">{row.stockBefore} → </span>
          {row.stockAfter}
        </span>
      ),
    },
    {
      key: 'detail',
      label: 'Detalle',
      hideOnMobile: true,
      render: (row) => {
        const parts = [
          row.supplier,
          row.documentNumber ? `Remito ${row.documentNumber}` : null,
          row.unitCost != null ? `Costo $${row.unitCost.toLocaleString('es-AR')}` : null,
          row.reason,
        ].filter(Boolean);
        return (
          <div className="min-w-0 text-[12px] text-p-text-muted">
            <p className="truncate">{parts.join(' · ') || '—'}</p>
            {row.createdBy?.name && <p className="mt-0.5 truncate text-[11px]">por {row.createdBy.name}</p>}
          </div>
        );
      },
    },
  ];

  const selectClass = `${inputClass} sm:w-[220px]`;

  // ── Render ──
  return (
    <div className="flex flex-col gap-3">
      {loadError && <AdminInlineError>{loadError}</AdminInlineError>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Para reponer"
          value={lowStockProducts.length}
          format="number"
          loading={loadingProducts}
          valueColor={lowStockProducts.length > 0 ? 'var(--error-fg)' : undefined}
          delta={{ value: lowStockProducts.length > 0 ? -lowStockProducts.length : 0, label: 'en o debajo del mínimo' }}
        />
        <MetricCard label="Unidades en stock" value={summary.units} format="number" loading={loadingProducts} />
        <MetricCard label="Valor en stock (a precio de venta)" value={summary.value} format="money" loading={loadingProducts} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButtonClass} onClick={() => openModal('entry')}>
          <PackagePlus size={15} strokeWidth={2.5} />
          Registrar ingreso
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => openModal('count')}>
          <ClipboardCheck size={15} strokeWidth={2.5} />
          Conteo físico
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => openModal('waste')}>
          <PackageMinus size={15} strokeWidth={2.5} />
          Registrar merma
        </button>
      </div>

      {lowStockProducts.length > 0 && (
        <AdminPanel title="Para reponer" description="Productos con stock en o por debajo de su mínimo.">
          <ul className="flex flex-wrap gap-2">
            {lowStockProducts.map((product) => (
              <li
                key={product.id}
                className="rounded-lg border border-p-error bg-p-error-bg px-2.5 py-1 text-[12px] font-semibold text-[var(--error-fg)]"
              >
                {product.name} · {Number(product.stock || 0)} u.
              </li>
            ))}
          </ul>
        </AdminPanel>
      )}

      <AdminPanel
        title="Historial de movimientos"
        description="Cada venta, anulación, ingreso, ajuste y merma queda registrada con su saldo."
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
        <AdminDataTable
          columns={columns}
          data={movements}
          rowKey={(row) => row.id}
          loading={loadingMovements}
          empty={{
            title: 'Todavía no hay movimientos',
            description: 'Registrá un ingreso de mercadería o hacé una venta y lo vas a ver acá.',
          }}
        />
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
        title={modal === 'entry' ? 'Registrar ingreso' : 'Registrar merma'}
        description={
          modal === 'entry'
            ? 'Mercadería que llegó del proveedor. Suma stock a cada producto.'
            : 'Rotura, vencimiento o consumo interno. Resta stock sin generar una venta.'
        }
        onClose={closeModal}
        maxWidthClassName="max-w-[640px]"
        footer={(
          <>
            <button type="button" className={secondaryButtonClass} onClick={closeModal} disabled={submitting}>
              Cancelar
            </button>
            <button type="button" className={primaryButtonClass} onClick={() => void submitRows()} disabled={submitting}>
              {submitting ? 'Guardando...' : modal === 'entry' ? 'Registrar ingreso' : 'Registrar merma'}
            </button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          {modal === 'entry' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-p-text">
                Proveedor
                <input className={inputClass} value={entrySupplier} onChange={(e) => setEntrySupplier(e.target.value)} placeholder="Ej. Distribuidora Córdoba" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-p-text">
                Nº de remito o factura
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
                      Costo unitario
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
            {modal === 'entry' ? 'Notas' : 'Motivo'}
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
        title="Conteo físico"
        description="Cargá lo que contaste en el depósito. Solo se ajustan los productos que completes y que tengan diferencia."
        onClose={closeModal}
        maxWidthClassName="max-w-[640px]"
        footer={(
          <>
            <span className="mr-auto text-[12px] text-p-text-muted">
              {countChanges.filter((row) => row.diff !== 0).length} con diferencia
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
                  <th className="px-3 py-2 text-right font-semibold">Sistema</th>
                  <th className="w-[96px] px-3 py-2 font-semibold">Contado</th>
                  <th className="w-[72px] px-3 py-2 text-right font-semibold">Dif.</th>
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
            Notas
            <input className={inputClass} value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="Ej. Inventario mensual de octubre" />
          </label>
          {modalError && <AdminInlineError>{modalError}</AdminInlineError>}
        </div>
      </AdminModal>
    </div>
  );
}
