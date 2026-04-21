import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Wrench } from 'lucide-react';

export type ClubServiceSearchItem = {
  id: number;
  code: string;
  name: string;
  price: number;
  isActive?: boolean;
};

type ClubServiceSearchProps = {
  services: ClubServiceSearchItem[];
  value: string;
  onChange: (value: string) => void;
  onSelect: (service: ClubServiceSearchItem) => void;
  selectedName?: string;
  onInputChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minQueryLength?: number;
  maxResults?: number;
  className?: string;
};

export default function ClubServiceSearch({
  services,
  value,
  onChange,
  onSelect,
  selectedName,
  onInputChange,
  placeholder = 'Buscar servicio del club...',
  disabled = false,
  minQueryLength = 1,
  maxResults = 12,
  className = ''
}: ClubServiceSearchProps) {
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
    const filtered = (services || []).filter((service) => {
      const name = String(service?.name || '').toLowerCase();
      const code = String(service?.code || '').toLowerCase();
      return name.includes(normalizedQuery) || code.includes(normalizedQuery);
    });
    filtered.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    return filtered.slice(0, Math.max(1, maxResults));
  }, [disabled, hasSelection, maxResults, minQueryLength, normalizedQuery, normalizedSelected, services]);

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

  const commitSelect = (item: ClubServiceSearchItem) => {
    onSelect(item);
    onChange(String(item?.name || ''));
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40">
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
          className="w-full h-12 bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl pl-12 pr-4 text-sm font-bold text-[#347048] outline-none transition-all shadow-sm disabled:opacity-60"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {open && !disabled && (
        <div className="absolute z-[120] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-64 overflow-y-auto overflow-hidden">
          {results.length > 0 ? (
            <ul className="py-2">
              {results.map((service, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={service.id}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitSelect(service)}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors border-b border-[#347048]/5 last:border-0 ${
                      isActive ? 'bg-[#B9CF32]/20' : 'hover:bg-[#B9CF32]/15'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-black text-sm text-[#347048] truncate">{service.name}</p>
                      <p className="text-[10px] font-bold text-[#347048]/50 uppercase tracking-widest">
                        {service.code} - ${Number(service.price || 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-[#347048] text-[#B9CF32] p-1.5 rounded-lg shrink-0">
                      <Plus size={14} strokeWidth={4} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <Wrench size={32} className="mx-auto text-[#347048]/20 mb-2" />
              <p className="text-xs font-bold text-[#347048]/40 uppercase tracking-widest">Sin coincidencias</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
