import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Plus, Search } from 'lucide-react';

export type ProductSearchItem = {
  id: number;
  name: string;
  price: number;
  stock?: number | null;
};

type Props = {
  products: ProductSearchItem[];
  onSelect: (product: ProductSearchItem) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  minQueryLength?: number;
  maxResults?: number;
  className?: string;
  selectedName?: string;
  onInputChange?: (value: string) => void;
};

export default function ProductSearch({
  products,
  onSelect,
  placeholder = 'Agregar producto (ej: Gatorade)...',
  disabled = false,
  autoFocus = false,
  minQueryLength = 2,
  maxResults = 10,
  className = '',
  selectedName,
  onInputChange
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();
  const normalizedSelected = String(selectedName || '').trim().toLowerCase();
  const hasSelection = Boolean(normalizedSelected);

  const results = useMemo(() => {
    if (disabled) return [];
    if (hasSelection && normalizedQuery === normalizedSelected) return [];
    if (normalizedQuery.length < minQueryLength) return [];

    const filtered = (products || []).filter((p) => {
      const name = String(p?.name || '').toLowerCase();
      return name.includes(normalizedQuery);
    });

    filtered.sort((a, b) => {
      const aStock = Number(a?.stock ?? 0);
      const bStock = Number(b?.stock ?? 0);
      if (aStock !== bStock) return bStock - aStock;
      return String(a.name).localeCompare(String(b.name), 'es');
    });

    return filtered.slice(0, Math.max(1, maxResults));
  }, [disabled, hasSelection, maxResults, minQueryLength, normalizedQuery, normalizedSelected, products]);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    if (normalizedQuery.length >= minQueryLength && !(hasSelection && normalizedQuery === normalizedSelected)) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [hasSelection, minQueryLength, normalizedQuery, normalizedSelected]);

  useEffect(() => {
    if (selectedName === undefined) return;
    const nextValue = String(selectedName || '');
    if (query === nextValue) return;
    setQuery(nextValue);
    setOpen(false);
  }, [query, selectedName]);

  const commitSelect = (product: ProductSearchItem) => {
    onSelect(product);
    setQuery(product?.name || '');
    setOpen(false);
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40">
          <Search size={18} strokeWidth={3} />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => {
            if (hasSelection && normalizedQuery === normalizedSelected) return;
            if (normalizedQuery.length >= minQueryLength) setOpen(true);
          }}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
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
          className="w-full h-12 bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl pl-12 pr-4 text-sm font-bold text-[#347048] outline-none transition-all shadow-sm disabled:opacity-60"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {open && !disabled && normalizedQuery.length >= minQueryLength && (
        <div className="absolute z-[110] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-64 overflow-y-auto overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {results.length > 0 ? (
            <ul className="py-2">
              {results.map((product, idx) => {
                const outOfStock = Number(product?.stock ?? 1) <= 0;
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={product.id}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitSelect(product)}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors border-b border-[#347048]/5 last:border-0 ${
                      isActive ? 'bg-[#B9CF32]/20' : 'hover:bg-[#B9CF32]/15'
                    } ${outOfStock ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0">
                      <p className="font-black text-sm text-[#347048] truncate">{product.name}</p>
                      {product.stock !== undefined && product.stock !== null && (
                        <p className="text-[10px] font-bold text-[#347048]/50 uppercase tracking-widest">
                          Stock: {Number(product.stock) || 0}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-black text-[#347048]">${Number(product.price || 0).toLocaleString()}</span>
                      <div className="bg-[#347048] text-[#B9CF32] p-1.5 rounded-lg">
                        <Plus size={14} strokeWidth={4} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <Package size={32} className="mx-auto text-[#347048]/20 mb-2" />
              <p className="text-xs font-bold text-[#347048]/40 uppercase tracking-widest">No se encontraron productos</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
