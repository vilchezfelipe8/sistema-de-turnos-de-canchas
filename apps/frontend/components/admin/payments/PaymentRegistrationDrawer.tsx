import React from 'react';
import { AdminDrawerSection } from '../ui/AdminDrawer';

type PaymentQuickPreset = 'FULL' | 'COURT_ONLY' | 'CUSTOM_ITEMS';

type Option = {
  value: string;
  label: string;
};

type PendingItem = {
  id: string;
  type?: string;
  label?: string;
  description?: string;
  remainingAmount: number;
};

type Props = {
  methodOptions: Option[];
  methodValue: string;
  onMethodChange: (value: string) => void;
  presetOptions: Array<{ id: PaymentQuickPreset; label: string }>;
  selectedPreset: PaymentQuickPreset;
  onPresetChange: (preset: PaymentQuickPreset) => void;
  pendingItems: PendingItem[];
  selectedItemIds: string[];
  customAmountById: Record<string, string>;
  customSelectedTotal: number;
  onSelectAll?: () => void;
  onClear?: () => void;
  onToggleItem: (itemId: string, checked: boolean) => void;
  onItemAmountChange: (itemId: string, value: string) => void;
  amountDraft: string;
  onAmountChange: (value: string) => void;
  maxInlineLabel: string;
  maxFooterLabel: string;
};

const sectionCardClass = 'rounded-2xl border border-p-border bg-p-surface-2 p-4';

export default function PaymentRegistrationDrawer({
  methodOptions,
  methodValue,
  onMethodChange,
  presetOptions,
  selectedPreset,
  onPresetChange,
  pendingItems,
  selectedItemIds,
  customAmountById,
  customSelectedTotal,
  onSelectAll,
  onClear,
  onToggleItem,
  onItemAmountChange,
  amountDraft,
  onAmountChange,
  maxInlineLabel,
  maxFooterLabel,
}: Props) {
  return (
    <>
      {/* Método de pago */}
      <AdminDrawerSection className={sectionCardClass}>
        <label className="block">
          <span className="text-[12px] font-medium text-p-text-muted">Método</span>
          <select
            value={methodValue}
            onChange={(event) => onMethodChange(String(event.target.value || ''))}
            className="mt-1 h-11 w-full rounded-xl border border-p-border bg-p-surface px-3 text-[14px] text-p-text outline-none focus:border-p-accent"
          >
            {methodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </AdminDrawerSection>

      {/* Conceptos a cobrar */}
      <AdminDrawerSection title="Conceptos a cobrar" className={sectionCardClass}>
        <div className="grid grid-cols-3 gap-2">
          {presetOptions.map((option) => {
            const isActive = selectedPreset === option.id;
            return (
              <button
                key={`payment-preset-${option.id}`}
                type="button"
                onClick={() => onPresetChange(option.id)}
                className={`h-9 rounded-lg border text-[12px] font-semibold transition ${
                  isActive
                    ? 'border-p-accent bg-p-positive-bg text-p-accent'
                    : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </AdminDrawerSection>

      {/* Selección manual de conceptos */}
      {selectedPreset === 'CUSTOM_ITEMS' && (
        <AdminDrawerSection className={sectionCardClass}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-[12px] font-semibold text-p-text-secondary">Selección manual</span>
            <span className="text-[11px] font-semibold text-p-text-muted">
              Total: {customSelectedTotal.toFixed(2)} $
            </span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            {onSelectAll && (
              <button
                type="button"
                onClick={onSelectAll}
                className="h-7 rounded-md border border-p-border bg-p-surface px-2 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
              >
                Seleccionar todo
              </button>
            )}
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="h-7 rounded-md border border-p-border bg-p-surface px-2 text-[11px] font-semibold text-p-text-secondary hover:bg-p-surface-2"
              >
                Limpiar
              </button>
            )}
          </div>
          <div className="max-h-[240px] overflow-auto rounded-lg border border-p-border bg-p-surface p-2">
            {pendingItems.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-p-text-muted">
                No hay conceptos con deuda pendiente.
              </p>
            ) : (
              <div className="space-y-1">
                {pendingItems.map((item) => {
                  const itemId = String(item.id);
                  const checked = selectedItemIds.includes(itemId);
                  const label =
                    item.type === 'BOOKING'
                      ? 'Cancha'
                      : item.description || item.label || 'Concepto';
                  return (
                    <div
                      key={`payment-concept-item-${itemId}`}
                      onClick={() => onToggleItem(itemId, !checked)}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-p-surface-2"
                    >
                      <span className="min-w-0 flex items-center gap-2 text-[12px] text-p-text">
                        <input
                          type="checkbox"
                          checked={checked}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onToggleItem(itemId, event.target.checked)}
                          className="h-4 w-4 accent-p-brand"
                        />
                        <span className="truncate">{label}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-[116px] items-center rounded-md border border-p-border bg-p-surface px-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={!checked}
                            onClick={(event) => event.stopPropagation()}
                            value={
                              checked
                                ? String(
                                    customAmountById[itemId] ??
                                      Number(item.remainingAmount || 0).toFixed(2)
                                  )
                                : ''
                            }
                            onChange={(event) => onItemAmountChange(itemId, event.target.value)}
                            className="w-full bg-transparent text-right text-[12px] font-semibold text-p-text outline-none disabled:text-p-text-muted"
                          />
                          <span className="ml-1 text-[11px] font-semibold text-p-text-muted">$</span>
                        </div>
                        <span className="w-[88px] text-right text-[11px] font-semibold text-p-text-secondary">
                          {Number(item.remainingAmount || 0).toFixed(2)} $
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </AdminDrawerSection>
      )}

      {/* Monto final */}
      <AdminDrawerSection className={sectionCardClass}>
        <label className="block">
          <span className="text-[12px] font-medium text-p-text-muted">Monto final</span>
          <div className="mt-1 h-11 rounded-xl border border-p-border bg-p-surface px-3 flex items-center justify-between">
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountDraft}
              onChange={(event) => onAmountChange(event.target.value)}
              className="w-full bg-transparent text-[16px] text-p-text outline-none"
            />
            <span className="text-[15px] font-semibold text-p-text-muted">$</span>
          </div>
          <p className="mt-1 text-[11px] text-p-text-muted">{maxInlineLabel}</p>
          <p className="mt-2 text-[11px] text-p-text-muted">{maxFooterLabel}</p>
        </label>
      </AdminDrawerSection>
    </>
  );
}
