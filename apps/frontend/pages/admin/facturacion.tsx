import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { ChevronLeft, ChevronRight, RotateCcw, CheckCheck, Eye, X, FileX2 } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminSegmentedControl } from '../../components/admin/ui';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import {
  listFacturas,
  retryFactura,
  createCreditNote,
  listIncidents,
  resolveIncident,
  type FacturaSummary,
  type FacturaStatus,
  type FiscalIncident,
  type PaginatedResult,
} from '../../services/FiscalBandejaService';

type BandejaTab = 'comprobantes' | 'incidencias';

const BANDEJA_TABS: Array<{ value: BandejaTab; label: string }> = [
  { value: 'comprobantes', label: 'Comprobantes' },
  { value: 'incidencias', label: 'Incidencias' },
];

const parseBandejaTab = (value: unknown): BandejaTab => {
  if (String(value || '') === 'incidencias') return 'incidencias';
  return 'comprobantes';
};

// ---------- helpers ----------

const STATUS_LABELS: Record<FacturaStatus, string> = {
  PENDING: 'Pendiente',
  PROCESSING: 'En proceso',
  APPROVED: 'Aprobado',
  APPROVED_WITH_OBSERVATIONS: 'Aprobado c/obs.',
  REJECTED: 'Rechazado',
  TECHNICAL_ERROR: 'Error técnico',
  CANCELLED: 'Cancelado',
};

const STATUS_COLORS: Record<FacturaStatus, string> = {
  PENDING: 'bg-p-warning-bg text-p-warning',
  PROCESSING: 'bg-p-accent/10 text-p-accent',
  APPROVED: 'bg-p-positive-bg text-p-positive',
  APPROVED_WITH_OBSERVATIONS: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-p-error-bg text-[var(--error-fg)]',
  TECHNICAL_ERROR: 'bg-p-warning-bg text-p-warning',
  CANCELLED: 'bg-p-surface-3 text-p-text-muted',
};

const RETRYABLE = new Set<FacturaStatus>(['PENDING', 'TECHNICAL_ERROR']);

const ALL_STATUSES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'PROCESSING', label: 'En proceso' },
  { value: 'APPROVED', label: 'Aprobados' },
  { value: 'APPROVED_WITH_OBSERVATIONS', label: 'Con observaciones' },
  { value: 'TECHNICAL_ERROR', label: 'Error técnico' },
  { value: 'REJECTED', label: 'Rechazados' },
  { value: 'CANCELLED', label: 'Cancelados' },
];

const INCIDENT_STATUSES: Array<{ value: 'OPEN' | 'RESOLVED' | 'ALL'; label: string }> = [
  { value: 'OPEN', label: 'Abiertas' },
  { value: 'RESOLVED', label: 'Resueltas' },
  { value: 'ALL', label: 'Todas' },
];

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'bg-p-error-bg text-[var(--error-fg)]',
  MEDIUM: 'bg-p-warning-bg text-p-warning',
  LOW: 'bg-p-surface-3 text-p-text-muted',
};

const PRIORITY_LABELS: Record<string, string> = {
  HIGH: 'Alta',
  MEDIUM: 'Media',
  LOW: 'Baja',
};

const fmtMoney = (v: string | null) => {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const kindLabel = (kind: 'INVOICE' | 'CREDIT_NOTE') =>
  kind === 'INVOICE' ? 'Factura' : 'Nota de Crédito';

const SUGGESTED_ACTION_LABELS: Record<string, string> = {
  RETRY_AUTOMATICALLY: 'Reintento automático',
  REFRESH_AUTH_AND_RETRY: 'Refrescar auth',
  REQUIRE_ADMIN_CONFIGURATION_FIX: 'Corregir configuración',
  REQUIRE_RECEIVER_DATA_FIX: 'Corregir datos receptor',
  REQUIRE_MANUAL_RECONCILIATION: 'Reconciliación manual',
  REQUIRE_ENGINEERING_REVIEW: 'Revisión técnica',
};

const comprobanteNum = (f: FacturaSummary) => {
  if (!f.puntoDeVenta || !f.numeroComprobante) return '—';
  return `${String(f.puntoDeVenta).padStart(4, '0')}-${String(f.numeroComprobante).padStart(8, '0')}`;
};

// ---------- pagination ----------

function Paginator({
  page,
  pages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between border-t border-p-border px-4 py-3">
      <span className="text-[12px] text-p-text-muted">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="flex h-7 w-7 items-center justify-center rounded border border-p-border bg-p-surface text-p-text-muted hover:bg-p-hover disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[60px] text-center text-[12px] text-p-text">
          {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="flex h-7 w-7 items-center justify-center rounded border border-p-border bg-p-surface text-p-text-muted hover:bg-p-hover disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------- comprobantes tab ----------

function ComprobantesTab({ slug }: { slug: string }) {
  const router = useRouter();
  const facturaIdFilter = String(router.query.facturaId || '').trim() || undefined;

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaginatedResult<FacturaSummary> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [emittingNc, setEmittingNc] = useState<string | null>(null);
  const [confirmNcId, setConfirmNcId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listFacturas(slug, {
        status: statusFilter || undefined,
        facturaId: facturaIdFilter,
        page,
      });
      setResult(data);
    } catch (e) {
      setError(extractErrorMessage(e, 'Error al cargar comprobantes.'));
    } finally {
      setLoading(false);
    }
  }, [slug, statusFilter, facturaIdFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusChange = (s: string) => {
    // Clear facturaId filter when changing status
    const nextQuery = { ...router.query } as Record<string, unknown>;
    delete nextQuery.facturaId;
    void router.replace({ pathname: router.pathname, query: { ...nextQuery, tab: 'comprobantes' } }, undefined, { shallow: true });
    setStatusFilter(s);
    setPage(1);
  };

  const clearFacturaIdFilter = () => {
    const { facturaId: _removed, ...nextQuery } = router.query;
    void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
  };

  const handleRetry = async (facturaId: string) => {
    setRetrying(facturaId);
    try {
      await retryFactura(slug, facturaId);
      showAdminToast('Reintento encolado.');
      await load();
    } catch (e) {
      showAdminToast(extractErrorMessage(e, 'Error al reintentar.'));
    } finally {
      setRetrying(null);
    }
  };

  const handleEmitNc = async (facturaId: string) => {
    setEmittingNc(facturaId);
    setConfirmNcId(null);
    try {
      await createCreditNote(slug, facturaId);
      showAdminToast('Nota de crédito encolada para emisión.');
      await load();
    } catch (e) {
      showAdminToast(extractErrorMessage(e, 'Error al emitir la NC.'));
    } finally {
      setEmittingNc(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {ALL_STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => handleStatusChange(s.value)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              statusFilter === s.value && !facturaIdFilter
                ? 'border-p-accent bg-p-accent text-white'
                : 'border-p-border bg-p-surface text-p-text-muted hover:bg-p-hover'
            }`}
          >
            {s.label}
          </button>
        ))}
        {facturaIdFilter && (
          <div className="flex items-center gap-1 rounded-full border border-p-accent/40 bg-p-accent/10 pl-3 pr-1.5 py-1 text-[12px] font-medium text-p-accent">
            Comprobante: {facturaIdFilter.slice(0, 8)}…
            <button
              type="button"
              onClick={clearFacturaIdFilter}
              className="ml-1 flex h-4 w-4 items-center justify-center rounded-full hover:bg-p-accent/20"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* tabla */}
      <div className="overflow-hidden rounded-xl border border-p-border bg-p-surface">
        {error && (
          <div className="px-4 py-3 text-[13px] text-[var(--error-fg)]">{error}</div>
        )}
        {loading && !result && (
          <div className="px-4 py-6 text-center text-[13px] text-p-text-muted">Cargando...</div>
        )}
        {result && result.items.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-p-text-muted">
            No hay comprobantes{statusFilter ? ' con ese estado' : ''}.
          </div>
        )}
        {result && result.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-b border-p-border bg-p-hover">
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Tipo</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Estado</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Número</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Receptor</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Fecha</th>
                    <th className="px-4 py-2.5 text-right font-medium text-p-text-muted">Total</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">CAE</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-p-border">
                  {result.items.map((f) => (
                    <tr key={f.id} className="hover:bg-p-hover/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-p-text">{kindLabel(f.kind)}</div>
                        {f.comprobanteDescripcion && (
                          <div className="text-[11px] text-p-text-muted">{f.comprobanteDescripcion}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[f.status]}`}
                        >
                          {STATUS_LABELS[f.status]}
                        </span>
                        {f.mensajeError && (
                          <div
                            className="mt-1 max-w-[180px] truncate text-[11px] text-p-warning"
                            title={f.mensajeError}
                          >
                            {f.mensajeError}
                          </div>
                        )}
                        {f.suggestedAction && (
                          <div className="mt-1 inline-flex items-center rounded-full bg-p-surface-3 px-2 py-0.5 text-[10px] font-medium text-p-text-muted">
                            {SUGGESTED_ACTION_LABELS[f.suggestedAction] ?? f.suggestedAction}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-p-text">{comprobanteNum(f)}</td>
                      <td className="px-4 py-3">
                        {f.receptorNombre ? (
                          <>
                            <div className="text-p-text">{f.receptorNombre}</div>
                            {f.receptorDocNumero && (
                              <div className="text-[11px] text-p-text-muted">{f.receptorDocNumero}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-p-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-p-text">{fmtDate(f.fechaEmision)}</td>
                      <td className="px-4 py-3 text-right font-medium text-p-text">{fmtMoney(f.importeTotal)}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-p-text-muted">
                        {f.cae ? (
                          <>
                            <div>{f.cae}</div>
                            <div>vto. {fmtDate(f.caeVencimiento)}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {f.pdfUrl && (
                            <a
                              href={f.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-p-border bg-p-surface px-2.5 py-1 text-[12px] text-p-text hover:bg-p-hover"
                            >
                              <Eye className="h-3 w-3" />
                              Ver
                            </a>
                          )}
                          {RETRYABLE.has(f.status) && (
                            <button
                              disabled={retrying === f.id}
                              onClick={() => handleRetry(f.id)}
                              title="Reintentar"
                              className="inline-flex items-center gap-1 rounded border border-p-border bg-p-surface px-2.5 py-1 text-[12px] text-p-text hover:bg-p-hover disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {retrying === f.id ? 'Encolando...' : 'Reintentar'}
                            </button>
                          )}
                          {(f.status === 'APPROVED' || f.status === 'APPROVED_WITH_OBSERVATIONS') && f.kind === 'INVOICE' && (
                            confirmNcId === f.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-p-text-muted">¿Emitir NC?</span>
                                <button
                                  disabled={emittingNc === f.id}
                                  onClick={() => handleEmitNc(f.id)}
                                  className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  {emittingNc === f.id ? 'Emitiendo...' : 'Confirmar'}
                                </button>
                                <button
                                  onClick={() => setConfirmNcId(null)}
                                  className="inline-flex items-center rounded border border-p-border bg-p-surface px-2 py-1 text-[12px] text-p-text-muted hover:bg-p-hover"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmNcId(f.id)}
                                title="Emitir Nota de Crédito para anular este comprobante"
                                className="inline-flex items-center gap-1 rounded border border-p-border bg-p-surface px-2.5 py-1 text-[12px] text-p-text-muted hover:bg-p-hover"
                              >
                                <FileX2 className="h-3 w-3" />
                                NC
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginator
              page={result.page}
              pages={result.pages}
              total={result.total}
              pageSize={result.pageSize}
              onPage={(p) => setPage(p)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- incidencias tab ----------

function IncidenciasTab({ slug }: { slug: string }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'RESOLVED' | 'ALL'>('OPEN');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaginatedResult<FiscalIncident> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listIncidents(slug, { status: statusFilter, page });
      setResult(data);
    } catch (e) {
      setError(extractErrorMessage(e, 'Error al cargar incidencias.'));
    } finally {
      setLoading(false);
    }
  }, [slug, statusFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusChange = (s: 'OPEN' | 'RESOLVED' | 'ALL') => {
    setStatusFilter(s);
    setPage(1);
  };

  const handleResolve = async (incidentId: string) => {
    setResolving(incidentId);
    try {
      await resolveIncident(slug, incidentId);
      showAdminToast('Incidencia resuelta.');
      await load();
    } catch (e) {
      showAdminToast(extractErrorMessage(e, 'Error al resolver la incidencia.'));
    } finally {
      setResolving(null);
    }
  };

  const handleViewFactura = (facturaId: string) => {
    void router.push(
      { pathname: router.pathname, query: { tab: 'comprobantes', facturaId } },
      undefined,
      { shallow: true }
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* filtros */}
      <div className="flex items-center gap-2">
        {INCIDENT_STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => handleStatusChange(s.value)}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
              statusFilter === s.value
                ? 'border-p-accent bg-p-accent text-white'
                : 'border-p-border bg-p-surface text-p-text-muted hover:bg-p-hover'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* tabla */}
      <div className="overflow-hidden rounded-xl border border-p-border bg-p-surface">
        {error && (
          <div className="px-4 py-3 text-[13px] text-[var(--error-fg)]">{error}</div>
        )}
        {loading && !result && (
          <div className="px-4 py-6 text-center text-[13px] text-p-text-muted">Cargando...</div>
        )}
        {result && result.items.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-p-text-muted">
            No hay incidencias{statusFilter !== 'ALL' ? ` ${statusFilter === 'OPEN' ? 'abiertas' : 'resueltas'}` : ''}.
          </div>
        )}
        {result && result.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-[13px]">
                <thead>
                  <tr className="border-b border-p-border bg-p-hover">
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Tipo / Título</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Prioridad</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Estado</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Comprobante</th>
                    <th className="px-4 py-2.5 text-left font-medium text-p-text-muted">Creada</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-p-border">
                  {result.items.map((inc) => (
                    <tr key={inc.id} className="hover:bg-p-hover/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-p-text">{inc.title}</div>
                        <div className="text-[11px] text-p-text-muted">{inc.type}</div>
                        {inc.detail && (
                          <div
                            className="mt-0.5 max-w-[260px] truncate text-[11px] text-p-text-muted"
                            title={inc.detail}
                          >
                            {inc.detail}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {inc.priority ? (
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              PRIORITY_COLORS[inc.priority] ?? 'bg-p-surface-3 text-p-text-muted'
                            }`}
                          >
                            {PRIORITY_LABELS[inc.priority] ?? inc.priority}
                          </span>
                        ) : (
                          <span className="text-p-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            inc.status === 'OPEN'
                              ? 'bg-p-warning-bg text-p-warning'
                              : 'bg-p-positive-bg text-p-positive'
                          }`}
                        >
                          {inc.status === 'OPEN' ? 'Abierta' : 'Resuelta'}
                        </span>
                        {inc.resolvedAt && (
                          <div className="mt-0.5 text-[11px] text-p-text-muted">{fmtDateTime(inc.resolvedAt)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {inc.facturaId ? (
                          <button
                            type="button"
                            onClick={() => handleViewFactura(inc.facturaId!)}
                            className="font-mono text-[11px] text-p-accent hover:underline underline-offset-2"
                            title={`Ver comprobante ${inc.facturaId}`}
                          >
                            {inc.facturaId.slice(0, 8)}…
                          </button>
                        ) : (
                          <span className="text-p-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-p-text-muted">{fmtDateTime(inc.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {inc.status === 'OPEN' && (
                          <button
                            disabled={resolving === inc.id}
                            onClick={() => handleResolve(inc.id)}
                            title="Marcar como resuelta"
                            className="inline-flex items-center gap-1 rounded border border-p-border bg-p-surface px-2.5 py-1 text-[12px] text-p-text hover:bg-p-hover disabled:opacity-50"
                          >
                            <CheckCheck className="h-3 w-3" />
                            {resolving === inc.id ? 'Resolviendo...' : 'Resolver'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginator
              page={result.page}
              pages={result.pages}
              total={result.total}
              pageSize={result.pageSize}
              onPage={(p) => setPage(p)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- page ----------

export default function AdminBillingPage() {
  const router = useRouter();
  const activeTab = parseBandejaTab(router.query.tab);

  const handleChangeTab = (nextTab: BandejaTab) => {
    if (nextTab === activeTab) return;
    void router.replace(
      { pathname: '/admin/facturacion', query: { tab: nextTab } },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AdminRouteShell title="Facturación | Pique Admin" activeItem="Facturacion" fromPath="/admin/facturacion">
      {(user) => {
        const slug = getActiveClubSlug(normalizeSessionUser(user as any));

        if (!slug) {
          return (
            <div className="p-4 text-[13px] text-p-text-muted">
              No se encontró el club activo.
            </div>
          );
        }

        return (
          <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-0 lg:p-6 lg:pb-0">
            <AdminSegmentedControl
              options={BANDEJA_TABS}
              value={activeTab}
              onChange={(value) => handleChangeTab(value as BandejaTab)}
              ariaLabel="Subnavegacion de facturacion"
              className="w-fit"
            />
            <section className="min-h-0 flex-1 overflow-y-auto pb-6 lg:pb-8">
              {activeTab === 'comprobantes' && <ComprobantesTab slug={slug} />}
              {activeTab === 'incidencias' && <IncidenciasTab slug={slug} />}
            </section>
          </div>
        );
      }}
    </AdminRouteShell>
  );
}
