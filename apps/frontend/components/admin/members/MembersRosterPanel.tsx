import { useCallback, useEffect, useState } from 'react';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import AdminEmptyState from '../ui/AdminEmptyState';
import MemberRenewModal from './MemberRenewModal';
import {
  MemberAdminService,
  type ClubMemberStatus,
  type MemberCategory,
  type MemberListItem
} from '../../../services/MemberAdminService';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type MembersRosterPanelProps = {
  clubSlug: string;
  onSelectClient?: (clientId: string) => void;
  /** Solo ADMIN/OWNER cambian el padrón (renovar cuota). */
  canManage?: boolean;
};

type RosterFilter = 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'INACTIVE' | 'ALL';

const FILTERS: Array<{ value: RosterFilter; label: string }> = [
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'EXPIRED', label: 'Cuota vencida' },
  { value: 'SUSPENDED', label: 'Suspendidos' },
  { value: 'INACTIVE', label: 'Bajas' },
  { value: 'ALL', label: 'Todos' },
];

const EMPTY_TEXT: Record<RosterFilter, string> = {
  ACTIVE: 'No hay socios activos.',
  EXPIRED: 'Nadie tiene la cuota vencida.',
  SUSPENDED: 'No hay socios suspendidos.',
  INACTIVE: 'No hay bajas.',
  ALL: 'Todavía no hay socios cargados.',
};

const PAGE_SIZE = 50;
const inputClass =
  'h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';

const ACCOUNT_LABEL: Record<string, string> = {
  ACTIVE: 'Usa la app',
  PENDING_ACTIVATION: 'App sin activar',
  DISABLED: 'App deshabilitada'
};

/** "2026-11-05" → "5 nov" (con año si no es el actual). */
const formatRosterDate = (value: string | null | undefined): string => {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date
    .toLocaleDateString('es-AR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
    .replace(/\./g, '');
};

/** Estado del socio en una frase: "Al día hasta 30 nov", "Cuota vencida el 5 nov", "Suspendido · motivo"… */
const memberStatusPhrase = (item: MemberListItem): { text: string; tone: string } => {
  if (item.status === 'INACTIVE') {
    return { text: item.leftAt ? `De baja desde el ${formatRosterDate(item.leftAt)}` : 'De baja', tone: 'text-p-text-muted' };
  }
  if (item.status === 'SUSPENDED') {
    return { text: `Suspendido${item.statusReason ? ` · ${item.statusReason}` : ''}`, tone: 'text-p-warning' };
  }
  if (!item.isCurrent) {
    return {
      text: item.validUntil ? `Cuota vencida el ${formatRosterDate(item.validUntil)}` : 'No vigente',
      tone: 'text-p-warning',
    };
  }
  return { text: item.validUntil ? `Al día hasta el ${formatRosterDate(item.validUntil)}` : 'Al día', tone: 'text-p-positive' };
};

// Clientes > Socios: padrón con estado en palabras simples y renovación de cuota a mano.
export default function MembersRosterPanel({ clubSlug, onSelectClient, canManage = false }: MembersRosterPanelProps) {
  const [membersEnabled, setMembersEnabled] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<MemberCategory[]>([]);
  const [items, setItems] = useState<MemberListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<RosterFilter>('ACTIVE');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [renewTarget, setRenewTarget] = useState<MemberListItem | null>(null);

  useEffect(() => {
    if (!clubSlug) return;
    Promise.all([MemberAdminService.getSettings(clubSlug), MemberAdminService.listCategories(clubSlug)])
      .then(([settings, rows]) => {
        setMembersEnabled(settings.membersEnabled);
        setCategories(rows);
      })
      .catch((err) => {
        reportUiError({ area: 'MembersRosterPanel', action: 'loadSettings' }, err);
        setError(extractErrorMessage(err, 'No se pudo cargar el padrón.'));
      });
  }, [clubSlug]);

  const load = useCallback(async () => {
    if (!clubSlug || !membersEnabled) return;
    setLoading(true);
    try {
      const status: ClubMemberStatus | undefined =
        filter === 'ALL' ? undefined : filter === 'EXPIRED' ? 'ACTIVE' : filter;
      const result = await MemberAdminService.listMembers(clubSlug, {
        status,
        currentness: filter === 'EXPIRED' ? 'EXPIRED' : undefined,
        categoryId: categoryId || undefined,
        q: query.trim() || undefined,
        page,
        pageSize: PAGE_SIZE
      });
      setItems(result.items);
      setTotal(result.total);
      setError('');
    } catch (err) {
      reportUiError({ area: 'MembersRosterPanel', action: 'loadMembers' }, err);
      setError(extractErrorMessage(err, 'No se pudo cargar el padrón.'));
    } finally {
      setLoading(false);
    }
  }, [categoryId, clubSlug, filter, membersEnabled, page, query]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  if (membersEnabled === false) {
    return (
      <AdminEmptyState
        title="El módulo de socios está desactivado"
        description="Activalo en Ajustes > Socios para administrar el padrón."
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-[200px] flex-1`}
          placeholder="Buscar por nombre, DNI o N° de socio"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        {categories.length > 1 && (
          <select
            className={inputClass}
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
            aria-label="Categoría"
          >
            <option value="">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => {
              setFilter(option.value);
              setPage(1);
            }}
            className={`h-8 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition ${
              filter === option.value ? 'bg-ink-900 text-ink-50' : 'text-p-text-secondary hover:bg-p-surface-2'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-p-border">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-p-surface-2 text-[11px] uppercase tracking-wide text-p-text-muted">
            <tr>
              <th className="px-3 py-2">Socio</th>
              <th className="hidden px-3 py-2 md:table-cell">Categoría</th>
              <th className="px-3 py-2">Estado</th>
              <th className="hidden px-3 py-2 md:table-cell">App</th>
              {canManage && <th className="px-3 py-2 text-right"><span className="sr-only">Acciones</span></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const phrase = memberStatusPhrase(item);
              const expired = item.status === 'ACTIVE' && !item.isCurrent;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t border-p-border hover:bg-p-surface-2"
                  onClick={() => onSelectClient?.(item.client.id)}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-p-text">{item.client.name}</span>
                    {item.memberNumber ? <span className="ml-2 text-[12px] text-p-text-muted">N° {item.memberNumber}</span> : null}
                    <span className="block text-[12px] text-p-text-muted md:hidden">{item.categoryName}</span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-p-text-secondary md:table-cell">{item.categoryName}</td>
                  <td className={`px-3 py-2.5 text-[12px] font-semibold ${phrase.tone}`}>{phrase.text}</td>
                  <td className="hidden px-3 py-2.5 text-p-text-secondary md:table-cell">
                    {item.appAccount ? ACCOUNT_LABEL[item.appAccount.status] : 'Sin cuenta'}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2.5 text-right">
                      {item.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRenewTarget(item);
                          }}
                          className={`h-8 whitespace-nowrap rounded-lg px-3 text-[12px] font-semibold ${
                            expired
                              ? 'bg-ink-900 text-ink-50 hover:bg-ink-800'
                              : 'border border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                          }`}
                        >
                          Renovar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-3 py-6 text-center text-p-text-muted">
                  {query.trim() || categoryId ? 'Nadie coincide con esa búsqueda.' : EMPTY_TEXT[filter]}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[12px] text-p-text-muted">
        <span>{loading ? 'Cargando...' : `${total} socio${total === 1 ? '' : 's'}`}</span>
        {totalPages > 1 && (
          <div className="flex gap-2">
            <button type="button" className={inputClass} disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              Anterior
            </button>
            <span className="self-center">
              {page} / {totalPages}
            </span>
            <button type="button" className={inputClass} disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>
              Siguiente
            </button>
          </div>
        )}
      </div>

      <p className="text-[12px] text-p-text-muted">
        ¿Tenés el padrón en una planilla? Pedile al equipo de Pique que lo cargue (hace falta el DNI de cada socio).
      </p>

      <MemberRenewModal
        open={Boolean(renewTarget)}
        clubSlug={clubSlug}
        clientId={renewTarget?.client.id || ''}
        clientName={renewTarget?.client.name || ''}
        validUntil={renewTarget?.validUntil || null}
        onClose={() => setRenewTarget(null)}
        onRenewed={() => void load()}
      />
    </div>
  );
}
