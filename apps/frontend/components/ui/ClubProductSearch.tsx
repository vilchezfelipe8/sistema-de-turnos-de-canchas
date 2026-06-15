import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Plus, Search } from 'lucide-react';
import { ADMIN_Z_INDEX } from '../../utils/adminZIndex';

export type ClubProductSearchItem = {
  id: number;
  name: string;
  price: number;
  stock?: number | null;
};

type ClubProductSearchProps = {
  products: ClubProductSearchItem[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (product: ClubProductSearchItem) => void;
  selectedName?: string;
  onInputChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minQueryLength?: number;
  maxResults?: number;
  className?: string;
};

export default function ClubProductSearch({
  products,
  value,
  onChange,
  onSelect,
  selectedName,
  onInputChange,
  placeholder = 'Buscar producto del club...',
  disabled = false,
  minQueryLength = 1,
  maxResults = 12,
  className = ''
}: ClubProductSearchProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = String(value || '').trim().toLowerCase();
  const normalizedSelected = String(selectedName || '').trim().toLowerCase();
  const hasSelection = Boolean(normalizedSelected);

  const results = useMemo(() => {
    if (disabled) return [];
    if (hasSelection && normalizedQuery === normalizedSelected) return [];
    if (normalizedQuery.length < minQueryLength) return [];
    const filtered = (products || []).filter((product) =>
      String(product?.name || '').toLowerCase().includes(normalizedQuery)
    );
    filtered.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    return filtered.slice(0, Math.max(1, maxResults));
  }, [disabled, hasSelection, maxResults, minQueryLength, normalizedQuery, normalizedSelected, products]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    if (normalizedQuery.length >= minQueryLength && !(hasSelection && normalizedQuery === normalizedSelected)) {
      setOpen(results.length > 0);
    } else {
      setOpen(false);
    }
  }, [hasSelection, minQueryLength, normalizedQuery, normalizedSelected, results.length]);

  const commitSelect = (item: ClubProductSearchItem) => {
    onSelect(item);
    onChange(String(item?.name || ''));
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-900/40">
          <Search size={18} strokeWidth={3} />
        </div>
        <input
          type="text"
          value={value}
          disabled={disabled}
          onFocus={() => {
            if (hasSelection && normalizedQuery === normalizedSelected) return;
            if (normalizedQuery.length >= minQueryLength && results.length > 0) setOpen(true);
          }}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            if (onInputChange) onInputChange(next);
          }}
          onKeyDown={(e) => {
            if (!open && e.key !== 'Escape') return;
            if (e.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (results.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((prev) => Math.max(prev - 1, 0));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const selected = results[Math.max(0, Math.min(activeIndex, results.length - 1))];
              if (selected) commitSelect(selected);
            }
          }}
          placeholder={placeholder}
          className="w-full h-12 bg-p-surface border-2 border-lima-900/10 focus:border-lima-300 rounded-xl pl-12 pr-4 text-sm font-bold text-ink-900 outline-none transition-all shadow-sm disabled:opacity-60"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {open && !disabled && (
        <div
          className="absolute w-full mt-2 bg-p-surface border-2 border-lima-900/10 rounded-2xl shadow-2xl max-h-64 overflow-y-auto overflow-hidden"
          style={{ zIndex: ADMIN_Z_INDEX.dropdown }}
        >
          {results.length > 0 ? (
            <ul className="py-2">
              {results.map((product, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={product.id}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitSelect(product)}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors border-b border-lima-900/5 last:border-0 ${
                      isActive ? 'bg-lima-300/20' : 'hover:bg-lima-300/15'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-black text-sm text-ink-900 truncate">{product.name}</p>
                      <p className="text-[10px] font-bold text-ink-900/50 uppercase tracking-widest">
                        ${Number(product.price || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] font-black uppercase text-ink-900/65">
                        Stock {Number(product?.stock || 0)}
                      </span>
                      <div className="bg-lima-700 text-lima-300 p-1.5 rounded-lg">
                        <Plus size={14} strokeWidth={4} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <Package size={32} className="mx-auto text-ink-900/20 mb-2" />
              <p className="text-xs font-bold text-ink-900/40 uppercase tracking-widest">Sin coincidencias</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
