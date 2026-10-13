import { useCallback, useEffect, useState } from 'react';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import AdminEmptyState from '../ui/AdminEmptyState';
import MemberBadge from './MemberBadge';
import {
  MEMBER_STATUS_LABELS,
  MemberAdminService,
  type ClubMemberStatus,
  type MemberCategory,
  type MemberListItem
} from '../../../services/MemberAdminService';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type MembersRosterPanelProps = {
  clubSlug: string;
  onSelectClient?: (clientId: string) => void;
};

const PAGE_SIZE = 50;
const inputClass =
  'h-9 rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary';

const ACCOUNT_LABEL: Record<string, string> = {
  ACTIVE: 'App activa',
  PENDING_ACTIVATION: 'App pendiente',
  DISABLED: 'App deshabilitada'
};

// Clientes > Padrón: listado de socios con estado, categoría, vencimiento y estado de la cuenta de la app.
export default function MembersRosterPanel({ clubSlug, onSelectClient }: MembersRosterPanelProps) {
  const [membersEnabled, setMembersEnabled] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<MemberCategory[]>([]);
  const [items, setItems] = useState<MemberListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ClubMemberStatus | ''>('ACTIVE');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      const result = await MemberAdminService.listMembers(clubSlug, {
        status: status || undefined,
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
  }, [categoryId, clubSlug, membersEnabled, page, query, status]);

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
          className={`${inputClass} min-w-[220px] flex-1`}
          placeholder="Buscar por nombre, DNI o N° de socio"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <select
          className={inputClass}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ClubMemberStatus | '');
            setPage(1);
          }}
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVE">Activos</option>
          <option value="SUSPENDED">Suspendidos</option>
          <option value="INACTIVE">Bajas</option>
        </select>
        <select
          className={inputClass}
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas las categorías</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <AdminFeedbackBanner tone="info" compact>
        Para cargar el padrón completo desde una planilla, pedile al equipo de Pique la importación (DNI obligatorio por socio).
      </AdminFeedbackBanner>

      <div className="overflow-auto rounded-xl border border-p-border">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-p-surface-2 text-[11px] uppercase tracking-wide text-p-text-muted">
            <tr>
              <th className="px-3 py-2">Socio</th>
              <th className="px-3 py-2">DNI</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Al día hasta</th>
              <th className="px-3 py-2">App</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-t border-p-border hover:bg-p-surface-2"
                onClick={() => onSelectClient?.(item.client.id)}
              >
                <td className="px-3 py-2">
                  <span className="font-semibold text-p-text">{item.client.name}</span>
                  {item.memberNumber ? <span className="ml-2 text-[12px] text-p-text-muted">N° {item.memberNumber}</span> : null}
                </td>
                <td className="px-3 py-2 text-p-text-secondary">{item.client.dni || '—'}</td>
                <td className="px-3 py-2 text-p-text-secondary">{item.categoryName}</td>
                <td className="px-3 py-2">
                  <MemberBadge member={item} />
                  {!item.isCurrent ? <span className="ml-1 text-[12px] text-p-text-muted">{MEMBER_STATUS_LABELS[item.status]}</span> : null}
                </td>
                <td className="px-3 py-2 text-p-text-secondary">{item.validUntil || '—'}</td>
                <td className="px-3 py-2 text-p-text-secondary">{item.appAccount ? ACCOUNT_LABEL[item.appAccount.status] : 'Sin cuenta'}</td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-p-text-muted">
                  No hay socios con estos filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[12px] text-p-text-muted">
        <span>{loading ? 'Cargando...' : `${total} socio${total === 1 ? '' : 's'}`}</span>
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
      </div>
    </div>
  );
}
