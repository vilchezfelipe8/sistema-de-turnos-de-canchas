import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AlertTriangle, ExternalLink, RotateCcw, X } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminFeedbackBanner } from '../../components/admin/ui/AdminFeedback';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import {
  listFacturas,
  retryFactura,
  createCreditNote,
  listIncidents,
  resolveIncident,
  type FacturaSummary,
  type FacturaStatusFilter,
  type FiscalIncident,
  type PaginatedResult,
} from '../../services/FiscalBandejaService';
import { getFiscalConfig, type FiscalConfigData } from '../../services/FiscalConfigService';
import {
  FACTURA_ACTION_HINT,
  FACTURA_TONE_CLASS,
  facturaStateText,
  type FacturaTone,
} from '../../modules/facturacion/fiscalTexts';

// Facturación: las facturas que salieron, las que no y qué hacer con cada una.

// ---------- textos ----------

type ListFilter = '' | 'PROBLEMS' | 'IN_PROGRESS' | 'ISSUED';

const FILTERS: Array<{ value: ListFilter; label: string; countKey: 'all' | 'problems' | 'inProgress' | 'issued' }> = [
  { value: '', label: 'Todas', countKey: 'all' },
  { value: 'PROBLEMS', label: 'No salieron', countKey: 'problems' },
  { value: 'IN_PROGRESS', label: 'Saliendo', countKey: 'inProgress' },
  { value: 'ISSUED', label: 'Emitidas', countKey: 'issued' },
];

const parseFilter = (value: unknown): ListFilter => {
  const raw = String(value || '');
  return raw === 'PROBLEMS' || raw === 'IN_PROGRESS' || raw === 'ISSUED' ? raw : '';
};

type RowState = { label: string; tone: FacturaTone };

const isIssued = (f: FacturaSummary) => f.status === 'APPROVED' || f.status === 'APPROVED_WITH_OBSERVATIONS';
const isAnnulled = (f: FacturaSummary) =>
  f.kind === 'INVOICE' && (f.notasCreditoAsociadas ?? []).some((nc) => nc.status === 'APPROVED' || nc.status === 'APPROVED_WITH_OBSERVATIONS');
const annulInProgress = (f: FacturaSummary) =>
  f.kind === 'INVOICE' && (f.notasCreditoAsociadas ?? []).some((nc) => nc.status === 'PENDING' || nc.status === 'PROCESSING');

const rowState = (f: FacturaSummary): RowState => {
  if (isAnnulled(f)) return { label: 'Anulada', tone: 'muted' };
  return facturaStateText(f.status);
};

const TONE_CLASS = FACTURA_TONE_CLASS;
const ACTION_HINT = FACTURA_ACTION_HINT;

const INCIDENT_TEXT: Record<string, { title: string; hint: string }> = {
  MAX_RETRIES_EXCEEDED: {
    title: 'Una factura no salió después de varios intentos',
    hint: 'Probá Reintentar. Si sigue fallando, probá la conexión en Ajustes → Facturación.',
  },
  REQUIRE_MANUAL_RECONCILIATION: {
    title: 'Puede haber una factura duplicada',
    hint: 'ARCA ya tenía un número que Pique no registró. Fijate en la web de ARCA antes de reintentar.',
  },
  CERT_EXPIRY: {
    title: 'El certificado de ARCA vence pronto',
    hint: 'Sacá uno nuevo en ARCA y cargalo en Ajustes → Facturación.',
  },
  REQUIRE_RECEIVER_DATA_FIX: { title: 'ARCA rechazó los datos de un cliente', hint: ACTION_HINT.REQUIRE_RECEIVER_DATA_FIX },
  REQUIRE_ADMIN_CONFIGURATION_FIX: { title: 'ARCA rechazó la configuración del club', hint: ACTION_HINT.REQUIRE_ADMIN_CONFIGURATION_FIX },
  REQUIRE_ENGINEERING_REVIEW: { title: 'Un error que tiene que revisar Pique', hint: ACTION_HINT.REQUIRE_ENGINEERING_REVIEW },
};

const RETRYABLE = new Set(['PENDING', 'TECHNICAL_ERROR']);

const formatMoney = (value: number | string | null) => `$${Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const formatDate = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date
    .toLocaleDateString('es-AR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
    .replace(/\./g, '');
};

const voucherNumber = (pdv: number | null | undefined, number: number | null | undefined) =>
  pdv && number ? `${String(pdv).padStart(4, '0')}-${String(number).padStart(8, '0')}` : '';

const voucherTitle = (f: FacturaSummary) => {
  const base = f.kind === 'CREDIT_NOTE' ? 'Nota de crédito' : `Factura${f.voucherClass ? ` ${f.voucherClass}` : ''}`;
  const number = voucherNumber(f.puntoDeVenta, f.numeroComprobante);
  return number ? `${base} ${number}` : base;
};

// ---------- fila ----------

function InvoiceRow({
  factura,
  busy,
  onRetry,
  onAnnul,
}: {
  factura: FacturaSummary;
  busy: boolean;
  onRetry: () => void;
  onAnnul: () => void;
}) {
  const [confirmAnnul, setConfirmAnnul] = useState(false);
  const state = rowState(factura);
  const canAnnul = factura.kind === 'INVOICE' && isIssued(factura) && !isAnnulled(factura) && !annulInProgress(factura);
  const problem = state.tone === 'problem';
  const original = factura.comprobanteAsociado;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-p-text">{factura.receptorNombre || 'Consumidor final'}</p>
          <p className="mt-0.5 text-[12px] text-p-text-muted">
            {voucherTitle(factura)} · {formatDate(factura.fechaEmision || factura.createdAt)}
          </p>
          {factura.kind === 'CREDIT_NOTE' && original && (
            <p className="mt-0.5 text-[12px] text-p-text-muted">
              Anula la {(original.comprobanteDescripcion || 'factura').replace(/^Factura/, 'factura')} {voucherNumber(original.puntoDeVenta, original.numeroComprobante)}
            </p>
          )}
          {annulInProgress(factura) && <p className="mt-0.5 text-[12px] text-p-text-muted">Anulándose…</p>}
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-[14px] font-semibold tabular-nums ${
              state.tone === 'muted' ? 'text-p-text-muted line-through' : 'text-p-text'
            }`}
          >
            {factura.kind === 'CREDIT_NOTE' ? '−' : ''}
            {formatMoney(factura.importeTotal)}
          </p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[state.tone]}`}>{state.label}</span>
        </div>
      </div>

      {problem && (
        <div className="mt-2 rounded-lg bg-p-surface-2 px-3 py-2">
          {factura.suggestedAction && ACTION_HINT[factura.suggestedAction] && (
            <p className="text-[12px] font-semibold text-p-text">{ACTION_HINT[factura.suggestedAction]}</p>
          )}
          {factura.mensajeError && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-[12px] text-p-text-muted">Qué dijo ARCA</summary>
              <p className="mt-1 break-words text-[12px] text-p-text-secondary">{factura.mensajeError}</p>
            </details>
          )}
        </div>
      )}

      {(factura.pdfUrl || RETRYABLE.has(factura.status) || canAnnul) && !confirmAnnul && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {factura.pdfUrl && (
            <a
              href={factura.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-p-text hover:underline"
            >
              <ExternalLink size={12} />
              Ver comprobante
            </a>
          )}
          {RETRYABLE.has(factura.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-p-text hover:underline disabled:opacity-50"
            >
              <RotateCcw size={12} />
              {busy ? 'Reintentando…' : 'Reintentar'}
            </button>
          )}
          {canAnnul && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmAnnul(true)}
              className="text-[12px] font-semibold text-p-text-muted hover:text-[var(--error-fg)] hover:underline disabled:opacity-50"
            >
              Anular factura
            </button>
          )}
        </div>
      )}

      {confirmAnnul && (
        <div className="mt-2 rounded-xl border border-p-border bg-p-surface-2 px-3 py-3">
          <p className="text-[13px] font-semibold text-p-text">¿Anular esta factura?</p>
          <p className="mt-1 text-[12px] text-p-text-secondary">
            Se emite una nota de crédito por {formatMoney(factura.importeTotal)} a {factura.receptorNombre || 'Consumidor final'}. No se puede deshacer. La plata
            no se devuelve sola: si corresponde, hacé la devolución en Caja.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmAnnul(false);
                onAnnul();
              }}
              className="inline-flex h-9 items-center rounded-lg bg-ink-900 px-3 text-[12px] font-semibold !text-ink-50 hover:bg-ink-800 disabled:opacity-50"
            >
              Sí, anular
            </button>
            <button
              type="button"
              onClick={() => setConfirmAnnul(false)}
              className="inline-flex h-9 items-center rounded-lg border border-p-border bg-p-surface px-3 text-[12px] font-semibold text-p-text hover:bg-p-surface-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------- contenido ----------

function BillingContent({ slug }: { slug: string }) {
  const router = useRouter();
  const filter = parseFilter(router.query.estado);
  const facturaIdFilter = String(router.query.facturaId || '').trim() || undefined;

  const [config, setConfig] = useState<FiscalConfigData | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [incidents, setIncidents] = useState<FiscalIncident[]>([]);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PaginatedResult<FacturaSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await listFacturas(slug, { status: (filter || undefined) as FacturaStatusFilter | undefined, facturaId: facturaIdFilter, page }));
    } catch (err) {
      reportUiError({ area: 'AdminBillingPage', action: 'loadList' }, err);
      setError(extractErrorMessage(err, 'No se pudieron cargar las facturas.'));
    } finally {
      setLoading(false);
    }
  }, [slug, filter, facturaIdFilter, page]);

  const loadIncidents = useCallback(async () => {
    try {
      setIncidents((await listIncidents(slug, { status: 'OPEN' })).items);
    } catch (err) {
      reportUiError({ area: 'AdminBillingPage', action: 'loadIncidents' }, err);
    }
  }, [slug]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadIncidents();
    getFiscalConfig(slug)
      .then(setConfig)
      .catch((err) => reportUiError({ area: 'AdminBillingPage', action: 'loadConfig' }, err))
      .finally(() => setConfigLoaded(true));
  }, [slug, loadIncidents]);

  const setQuery = (next: { estado?: ListFilter; facturaId?: string }) => {
    const query: Record<string, string> = {};
    if (next.estado) query.estado = next.estado;
    if (next.facturaId) query.facturaId = next.facturaId;
    setPage(1);
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };

  const handleRetry = async (factura: FacturaSummary) => {
    if (busyId) return;
    try {
      setBusyId(factura.id);
      await retryFactura(slug, factura.id);
      showAdminToast('Reintentando. En un rato se actualiza.');
      await loadList();
    } catch (err) {
      reportUiError({ area: 'AdminBillingPage', action: 'retry' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo reintentar.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleAnnul = async (factura: FacturaSummary) => {
    if (busyId) return;
    try {
      setBusyId(factura.id);
      await createCreditNote(slug, factura.id);
      showAdminToast('Anulando: la nota de crédito sale en un rato.');
      await loadList();
    } catch (err) {
      reportUiError({ area: 'AdminBillingPage', action: 'annul' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo anular la factura.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveIncident = async (incident: FiscalIncident) => {
    try {
      await resolveIncident(slug, incident.id);
      setIncidents((prev) => prev.filter((item) => item.id !== incident.id));
    } catch (err) {
      reportUiError({ area: 'AdminBillingPage', action: 'resolveIncident' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo marcar como revisado.'));
    }
  };

  const summary = result?.summary;
  const billingOn = Boolean(config?.facturacionHabilitada && config.modoFacturacion && config.modoFacturacion !== 'DESHABILITADA');
  const items = result?.items ?? [];

  return (
    <section className="h-full min-h-0 overflow-y-auto p-4 pb-20 lg:p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[22px] font-bold text-p-text">Facturación</h1>
            <p className="text-[13px] text-p-text-muted">
              {summary && summary.monthInvoiceCount > 0
                ? `Este mes: ${summary.monthInvoiceCount} ${summary.monthInvoiceCount === 1 ? 'factura' : 'facturas'} · ${formatMoney(summary.monthNetTotal)} facturado`
                : 'Las facturas electrónicas que emite el club.'}
            </p>
          </div>
          <Link href="/admin/ajustes?tab=facturacion" className="text-[13px] font-semibold text-p-text-secondary hover:underline">
            Configurar
          </Link>
        </div>

        {configLoaded && !billingOn && (
          <AdminFeedbackBanner tone="info">
            {config ? 'La facturación está apagada.' : 'Todavía no configuraste la facturación.'}{' '}
            <Link href="/admin/ajustes?tab=facturacion" className="font-semibold underline">
              {config ? 'Prenderla' : 'Configurarla'}
            </Link>
          </AdminFeedbackBanner>
        )}
        {configLoaded && billingOn && config?.usaHomologacion && (
          <AdminFeedbackBanner tone="warning">Modo prueba: estas facturas no tienen validez fiscal.</AdminFeedbackBanner>
        )}

        {incidents.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-p-warning bg-p-warning-bg">
            <p className="flex items-center gap-1.5 px-4 pt-3 text-[13px] font-semibold text-p-warning">
              <AlertTriangle size={15} />
              Para revisar
            </p>
            <ul className="divide-y divide-p-warning/20">
              {incidents.map((incident) => {
                const text = INCIDENT_TEXT[incident.type] ?? { title: incident.title, hint: incident.detail || '' };
                return (
                  <li key={incident.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-p-text">{text.title}</p>
                      {text.hint && <p className="mt-0.5 text-[12px] text-p-text-secondary">{text.hint}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {incident.facturaId && (
                        <button
                          type="button"
                          onClick={() => setQuery({ facturaId: incident.facturaId! })}
                          className="text-[12px] font-semibold text-p-text hover:underline"
                        >
                          Ver factura
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleResolveIncident(incident)}
                        className="text-[12px] font-semibold text-p-text-muted hover:underline"
                      >
                        Ya lo revisé
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {facturaIdFilter ? (
          <div className="flex w-fit items-center gap-2 rounded-full border border-p-border bg-p-surface py-1 pl-3 pr-1.5 text-[12px] font-semibold text-p-text">
            Mostrando una factura
            <button
              type="button"
              aria-label="Ver todas"
              onClick={() => setQuery({ estado: filter })}
              className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-p-surface-2"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((option) => {
              const count = summary ? summary[option.countKey] : null;
              const selected = filter === option.value;
              const alert = option.value === 'PROBLEMS' && (count ?? 0) > 0;
              return (
                <button
                  key={option.value || 'all'}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setQuery({ estado: option.value })}
                  className={`h-8 rounded-full border px-3 text-[12px] font-semibold transition ${
                    selected ? 'border-ink-900 bg-ink-900 text-ink-50' : 'border-p-border bg-p-surface text-p-text-secondary hover:bg-p-surface-2'
                  }`}
                >
                  {option.label}
                  {count !== null && count > 0 && (
                    <span className={`ml-1.5 tabular-nums ${alert && !selected ? 'text-[var(--error-fg)]' : ''}`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <AdminFeedbackBanner tone="error">
            {error}{' '}
            <button type="button" className="font-semibold underline" onClick={() => void loadList()}>
              Reintentar
            </button>
          </AdminFeedbackBanner>
        )}

        <div className="overflow-hidden rounded-xl border border-p-border bg-p-surface">
          {loading && !result ? (
            <p className="px-4 py-8 text-center text-[13px] text-p-text-muted">Cargando…</p>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[14px] font-semibold text-p-text">
                {filter === 'PROBLEMS' ? 'No hay facturas con problemas' : filter ? 'No hay facturas acá' : 'Todavía no hay facturas'}
              </p>
              {!filter && billingOn && (
                <p className="mt-1 text-[13px] text-p-text-muted">
                  {config?.modoFacturacion === 'OBLIGATORIA'
                    ? 'Van a aparecer acá cuando cobres.'
                    : 'Emitilas desde la cuenta de cada cliente con "Emitir factura".'}
                </p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-p-border">
              {items.map((factura) => (
                <InvoiceRow
                  key={factura.id}
                  factura={factura}
                  busy={busyId === factura.id}
                  onRetry={() => void handleRetry(factura)}
                  onAnnul={() => void handleAnnul(factura)}
                />
              ))}
            </ul>
          )}
          {result && result.pages > 1 && (
            <div className="flex items-center justify-between border-t border-p-border px-4 py-2.5 text-[12px]">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
                className="font-semibold text-p-text hover:underline disabled:opacity-40"
              >
                Más nuevas
              </button>
              <span className="text-p-text-muted">
                Página {result.page} de {result.pages}
              </span>
              <button
                type="button"
                disabled={page >= result.pages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="font-semibold text-p-text hover:underline disabled:opacity-40"
              >
                Más viejas
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- página ----------

export default function AdminBillingPage() {
  return (
    <AdminRouteShell title="Facturación | Pique Admin" activeItem="Facturacion" fromPath="/admin/facturacion">
      {(user) => {
        const slug = getActiveClubSlug(normalizeSessionUser(user as any));
        if (!slug) return <div className="p-4 text-[13px] text-p-text-muted">No se encontró el club activo.</div>;
        return <BillingContent slug={slug} />;
      }}
    </AdminRouteShell>
  );
}
