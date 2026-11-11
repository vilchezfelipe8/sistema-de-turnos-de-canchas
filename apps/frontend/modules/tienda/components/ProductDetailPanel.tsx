'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  ClubAdminService,
  type StockMovement,
  type StockMovementType,
} from '../../../services/ClubAdminService';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';
import { showAdminToast } from '../../../utils/adminToast';
import type { ProductRow } from './ProductsTable';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

/** Movimientos de stock en palabras simples. */
export const STOCK_MOVEMENT_TEXT: Record<StockMovementType, string> = {
  INITIAL: 'Stock inicial',
  PURCHASE: 'Entró mercadería',
  SALE: 'Vendido',
  SALE_REVERSAL: 'Volvió (se borró un consumo)',
  ADJUSTMENT: 'Corregido al contar',
  WASTE: 'Se rompió o venció',
  MANUAL_EDIT: 'Cambiado a mano',
};

export const formatStockWhen = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date
    .toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')
    .replace(/\./g, '');
  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day} ${time}`;
};

export const minStockOf = (product: ProductRow) => Number((product.minStock as number | undefined) ?? 5);

type StockAction = 'entry' | 'count' | 'waste' | null;

type ProductDetailPanelProps = {
  slug: string;
  product: ProductRow;
  /** Productos para mostrar de qué está hecho un combo. */
  allProducts: ProductRow[];
  onBack: () => void;
  onEdit: (product: ProductRow) => void;
  onDelete: (product: ProductRow) => void;
  /** Después de mover stock: recargar la lista. */
  onStockChanged: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Ficha de un producto: precio, cuánto queda, y los tres movimientos que cambian el stock
 * (entró, conté, se rompió). El stock no se pisa a mano: cada cambio queda registrado.
 */
export default function ProductDetailPanel({
  slug,
  product,
  allProducts,
  onBack,
  onEdit,
  onDelete,
  onStockChanged,
}: ProductDetailPanelProps) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [action, setAction] = useState<StockAction>(null);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isCombo = Boolean(product.isCombo);
  const stock = Number(product.stock ?? 0);
  const minStock = minStockOf(product);
  const low = !isCombo && stock <= minStock;

  const loadMovements = useCallback(async () => {
    if (isCombo) {
      setMovements([]);
      setLoadingMovements(false);
      return;
    }
    try {
      setLoadingMovements(true);
      const page = await ClubAdminService.getStockMovements(slug, { productId: Number(product.id), limit: 8 });
      setMovements(page.items);
    } catch (err) {
      reportUiError({ area: 'ProductDetailPanel', action: 'loadMovements' }, err);
      setMovements([]);
    } finally {
      setLoadingMovements(false);
    }
  }, [isCombo, product.id, slug]);

  useEffect(() => {
    setAction(null);
    setQuantity('');
    setNote('');
    setError('');
    void loadMovements();
  }, [loadMovements]);

  const openAction = (next: Exclude<StockAction, null>) => {
    setAction((current) => (current === next ? null : next));
    setQuantity(next === 'count' ? String(stock) : '');
    setNote('');
    setError('');
  };

  const submit = async () => {
    const value = Number(quantity);
    if (!Number.isInteger(value) || (action === 'count' ? value < 0 : value <= 0)) {
      setError(action === 'count' ? 'Poné cuántas unidades hay (0 o más).' : 'Poné una cantidad entera mayor a 0.');
      return;
    }
    try {
      setSubmitting(true);
      setError('');
      if (action === 'entry') {
        await ClubAdminService.createStockEntry(slug, {
          notes: note.trim() || undefined,
          items: [{ productId: Number(product.id), quantity: value }],
        });
        showAdminToast(`Entraron ${value} de ${product.name}.`);
      } else if (action === 'waste') {
        await ClubAdminService.createStockWaste(slug, {
          reason: note.trim() || undefined,
          items: [{ productId: Number(product.id), quantity: value }],
        });
        showAdminToast(`Se descontaron ${value} de ${product.name}.`);
      } else if (action === 'count') {
        const result = await ClubAdminService.createStockCount(slug, {
          notes: note.trim() || undefined,
          items: [{ productId: Number(product.id), countedQuantity: value }],
        });
        showAdminToast(result.movements.length > 0 ? `Stock corregido a ${value}.` : 'Coincide con lo que había.');
      }
      setAction(null);
      onStockChanged();
      void loadMovements();
    } catch (err) {
      reportUiError({ area: 'ProductDetailPanel', action: `stock-${action}` }, err);
      setError(extractErrorMessage(err, 'No se pudo guardar.'));
    } finally {
      setSubmitting(false);
    }
  };

  const comboParts = isCombo && Array.isArray(product.components)
    ? (product.components as Array<{ componentProductId: number; quantity: number }>).map((part) => ({
        name: allProducts.find((p) => Number(p.id) === Number(part.componentProductId))?.name || 'Producto',
        quantity: Number(part.quantity || 1),
      }))
    : [];

  const actionCopy: Record<Exclude<StockAction, null>, { title: string; label: string; notePlaceholder: string; button: string }> = {
    entry: { title: 'Entró mercadería', label: '¿Cuántas unidades entraron?', notePlaceholder: 'Proveedor o nota (opcional)', button: 'Sumar al stock' },
    count: { title: 'Conté el stock', label: '¿Cuántas hay ahora?', notePlaceholder: 'Nota (opcional)', button: 'Guardar conteo' },
    waste: { title: 'Se rompió o venció', label: '¿Cuántas se perdieron?', notePlaceholder: 'Qué pasó (opcional)', button: 'Descontar del stock' },
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-p-border bg-p-surface">
      <div className="border-b border-p-border px-5 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-p-accent lg:hidden"
        >
          <ChevronLeft size={15} />
          Volver a la lista
        </button>
        <p className="text-[20px] font-bold leading-tight tracking-tight text-p-text">{product.name}</p>
        <p className="mt-0.5 text-[14px] text-p-text-secondary">
          {formatMoney(Number(product.price || 0))}
          {product.category ? ` · ${product.category}` : ''}
          {isCombo ? ' · Combo' : ''}
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {isCombo ? (
          <div>
            <p className="text-[13px] font-semibold text-p-text">Qué lleva</p>
            {comboParts.length === 0 ? (
              <p className="mt-1 text-[13px] text-p-text-muted">No tiene productos cargados.</p>
            ) : (
              <ul className="mt-1 divide-y divide-p-border">
                {comboParts.map((part, index) => (
                  <li key={`${part.name}-${index}`} className="flex justify-between py-2 text-[13px]">
                    <span className="text-p-text">{part.name}</span>
                    <span className="tabular-nums text-p-text-muted">× {part.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-p-text-muted">Al venderlo, se descuenta el stock de cada producto que lleva.</p>
          </div>
        ) : (
          <>
            {/* Cuánto queda */}
            <div>
              <p className="text-[13px] text-p-text-muted">En stock</p>
              <p className={`text-[30px] font-bold leading-tight tabular-nums ${low ? 'text-p-warning' : 'text-p-text'}`}>
                {stock.toLocaleString('es-AR')} {stock === 1 ? 'unidad' : 'unidades'}
              </p>
              <p className={`text-[12px] ${low ? 'font-semibold text-p-warning' : 'text-p-text-muted'}`}>
                {low ? `Hay que reponer (avisa con ${minStock} o menos)` : `Avisa cuando queden ${minStock} o menos`}
                {' · '}
                {formatMoney(stock * Number(product.price || 0))} a precio de venta
              </p>
            </div>

            {/* Cambiar el stock: siempre queda registrado. */}
            <div className="flex flex-wrap gap-2">
              {(['entry', 'count', 'waste'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={action === kind}
                  onClick={() => openAction(kind)}
                  className={`h-9 rounded-xl border px-3.5 text-[13px] font-semibold transition ${
                    action === kind
                      ? 'border-ink-900 bg-ink-900 text-ink-50'
                      : 'border-p-border bg-p-surface text-p-text hover:bg-p-surface-2'
                  }`}
                >
                  {kind === 'entry' ? 'Entró mercadería' : kind === 'count' ? 'Conté' : 'Se rompió o venció'}
                </button>
              ))}
            </div>

            {action && (
              <div className="space-y-3 rounded-xl border border-p-border p-4">
                <p className="text-[14px] font-semibold text-p-text">{actionCopy[action].title}</p>
                <label className="block">
                  <span className="mb-1 block text-[13px] text-p-text-secondary">{actionCopy[action].label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={action === 'count' ? 0 : 1}
                    step={1}
                    autoFocus
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    className="h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[16px] font-semibold tabular-nums text-p-text outline-none focus:border-p-border-strong"
                  />
                </label>
                {action === 'count' && quantity !== '' && Number.isFinite(Number(quantity)) && Number(quantity) !== stock && (
                  <p className="text-[12px] font-semibold text-p-warning">
                    {Number(quantity) > stock
                      ? `Sobran ${Number(quantity) - stock} respecto a lo que figuraba.`
                      : `Faltan ${stock - Number(quantity)} respecto a lo que figuraba.`}
                  </p>
                )}
                <input
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={actionCopy[action].notePlaceholder}
                  className="h-10 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-border-strong"
                />
                {error && <p className="text-[12px] font-semibold text-p-error">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setAction(null)}
                    disabled={submitting}
                    className="h-10 rounded-xl border border-p-border px-4 text-[13px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={submitting}
                    className="h-10 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold text-ink-50 hover:bg-ink-800 disabled:opacity-60"
                  >
                    {submitting ? 'Guardando...' : actionCopy[action].button}
                  </button>
                </div>
              </div>
            )}

            {/* Últimos movimientos */}
            <div className="border-t border-p-border pt-4">
              <p className="text-[13px] font-semibold text-p-text">Últimos movimientos</p>
              {loadingMovements ? (
                <div className="mt-2 h-16 animate-pulse rounded-xl bg-p-surface-2" />
              ) : movements.length === 0 ? (
                <p className="mt-1 text-[13px] text-p-text-muted">Todavía no tuvo movimientos.</p>
              ) : (
                <ul className="mt-1 divide-y divide-p-border">
                  {movements.map((movement) => (
                    <li key={movement.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-p-text">
                          {STOCK_MOVEMENT_TEXT[movement.type] || movement.type}
                          {movement.reason && movement.type !== 'SALE_REVERSAL' ? <span className="text-p-text-muted"> · {movement.reason}</span> : null}
                        </p>
                        <p className="text-[11px] text-p-text-muted">
                          {formatStockWhen(movement.occurredAt)}
                          {movement.createdBy?.name ? ` · ${movement.createdBy.name}` : ''}
                        </p>
                      </div>
                      <div className="flex-none text-right">
                        <p className={`text-[13px] font-semibold tabular-nums ${movement.quantity >= 0 ? 'text-p-positive' : 'text-p-text'}`}>
                          {movement.quantity > 0 ? '+' : movement.quantity < 0 ? '−' : ''}
                          {Math.abs(movement.quantity)}
                        </p>
                        <p className="text-[11px] tabular-nums text-p-text-muted">quedan {movement.stockAfter}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-p-border px-5 py-3">
        <button
          type="button"
          onClick={() => onEdit(product)}
          className="text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
        >
          Editar nombre y precio
        </button>
        <button
          type="button"
          onClick={() => onDelete(product)}
          className="text-[13px] font-semibold text-p-text-secondary hover:underline underline-offset-2"
        >
          Dar de baja
        </button>
      </div>
    </div>
  );
}
