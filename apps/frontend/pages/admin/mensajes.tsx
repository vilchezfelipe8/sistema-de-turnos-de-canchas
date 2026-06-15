import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminPageHeader from '../../components/admin/ui/AdminPageHeader';
import AdminPanel from '../../components/admin/ui/AdminPanel';
import { AdminFeedbackBanner } from '../../components/admin/ui/AdminFeedback';
import { fetchWithAuth } from '../../utils/apiClient';
import { getApiUrl } from '../../utils/apiUrl';
import { normalizeApiError, throwApiErrorFromResponse } from '../../utils/apiError';
import { showAdminToast } from '../../utils/adminToast';

type PreflightCheck = {
  key: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  ok: boolean;
  message: string;
};

type PreflightResult = {
  ok: boolean;
  status: 'OK' | 'WARN' | 'FAIL';
  checks: PreflightCheck[];
};

type SummaryResult = {
  totals: {
    last24h: number;
    last7d: number;
  };
  countsByStatus: Record<string, number>;
  countsByRecipientRole: Record<string, number>;
  countsByEventType: Record<string, number>;
  topErrors: Array<{ errorCode: string; count: number }>;
  orphanWebhookCount: number;
  acceptedWithoutWebhookCount: number;
  acceptedStaleMinutes: number;
};

type DeliveryListItem = {
  id: string;
  clubId: number;
  eventType: string;
  recipientRole: string;
  recipientPhoneMasked: string;
  provider: string;
  status: string;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type WebhookEventListItem = {
  id: string;
  eventType: string;
  status: string | null;
  providerMessageId: string | null;
  orphan: boolean;
  createdAt: string;
};

type WhatsappDashboardPayload = {
  preflight: PreflightResult;
  summary: SummaryResult;
  deliveries: {
    items: DeliveryListItem[];
  };
  webhookEvents: {
    items: WebhookEventListItem[];
  };
};

const adminButtonClassName =
  'inline-flex items-center gap-2 rounded-lg border border-p-border bg-p-surface px-3 py-2 text-[12px] font-semibold text-p-text transition hover:border-p-accent hover:text-p-accent disabled:cursor-not-allowed disabled:opacity-60';

const adminChipClassName =
  'inline-flex items-center rounded-full border border-p-border bg-p-surface-2 px-2.5 py-1 text-[11px] font-semibold text-p-text-secondary';

const toneByPreflightStatus = {
  OK: 'success',
  WARN: 'warning',
  FAIL: 'error'
} as const;

const toneByDeliveryStatus: Record<string, string> = {
  ACCEPTED: 'bg-sky-100 text-sky-800 border-sky-200',
  SENT: 'bg-blue-100 text-blue-800 border-blue-200',
  DELIVERED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  READ: 'bg-lime-100 text-lime-800 border-lime-200',
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  SKIPPED: 'bg-amber-100 text-amber-800 border-amber-200',
  QUEUED: 'bg-slate-100 text-slate-700 border-slate-200'
};

const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return 'Sin fecha';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha inválida';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
};

async function fetchJson<T>(path: string, fallbackMessage: string): Promise<T> {
  const response = await fetchWithAuth(`${getApiUrl()}${path}`);
  if (!response.ok) {
    await throwApiErrorFromResponse(response, fallbackMessage);
  }
  return response.json() as Promise<T>;
}

export default function AdminMessagesPage() {
  const [data, setData] = useState<WhatsappDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (
    mode: 'initial' | 'reload' = 'initial',
    options?: { silentSuccess?: boolean }
  ) => {
    if (mode === 'initial') setLoading(true);
    else setReloading(true);
    setError(null);

    try {
      const [preflight, summary, deliveries, webhookEvents] = await Promise.all([
        fetchJson<PreflightResult>(
          '/api/admin/whatsapp/preflight',
          'No se pudo cargar el preflight de WhatsApp.'
        ),
        fetchJson<SummaryResult>(
          '/api/admin/whatsapp/summary',
          'No se pudo cargar el resumen de WhatsApp.'
        ),
        fetchJson<{ items: DeliveryListItem[] }>(
          '/api/admin/whatsapp/deliveries?limit=10',
          'No se pudieron cargar los deliveries de WhatsApp.'
        ),
        fetchJson<{ items: WebhookEventListItem[] }>(
          '/api/admin/whatsapp/webhook-events?limit=10',
          'No se pudieron cargar los eventos webhook de WhatsApp.'
        )
      ]);

      setData({ preflight, summary, deliveries, webhookEvents });
      if (mode === 'reload' && !options?.silentSuccess) {
        showAdminToast('Panel de WhatsApp actualizado.', 'success');
      }
    } catch (rawError) {
      const parsed = normalizeApiError(
        rawError,
        'No se pudo cargar el panel operativo de WhatsApp.'
      );
      setError(parsed.message);
      if (mode === 'reload') {
        showAdminToast(parsed.message, 'error');
      }
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  useEffect(() => {
    void load('initial');
  }, []);

  const resendDelivery = async (deliveryId: string) => {
    setResendingId(deliveryId);
    try {
      const response = await fetchWithAuth(
        `${getApiUrl()}/api/admin/whatsapp/deliveries/${encodeURIComponent(deliveryId)}/resend`,
        { method: 'POST' }
      );
      if (!response.ok) {
        await throwApiErrorFromResponse(
          response,
          'No se pudo reenviar el delivery de WhatsApp.'
        );
      }
      showAdminToast('Delivery reenviado al outbox V2.', 'success');
      await load('reload', { silentSuccess: true });
    } catch (rawError) {
      const parsed = normalizeApiError(
        rawError,
        'No se pudo reenviar el delivery de WhatsApp.'
      );
      showAdminToast(parsed.message, 'error');
    } finally {
      setResendingId(null);
    }
  };

  const preflightStatus = data?.preflight.status ?? 'WARN';

  return (
    <AdminRouteShell
      title="Mensajes | Pique Admin"
      activeItem="Mensajes"
      fromPath="/admin/mensajes"
    >
      <section className="h-full min-h-0 overflow-y-auto p-4 pb-20 lg:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <AdminPageHeader
            eyebrow="Operaciones"
            title="Mensajes y WhatsApp"
            description="Visibilidad operativa del pipeline Cloud API: preflight, deliveries recientes, webhooks y señales de rollout."
            actions={(
              <button
                type="button"
                className={adminButtonClassName}
                onClick={() => {
                  void load('reload');
                }}
                disabled={reloading}
              >
                {reloading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                Actualizar
              </button>
            )}
          />

          {error ? (
            <AdminFeedbackBanner tone="error" title="No pudimos cargar el panel">
              {error}
            </AdminFeedbackBanner>
          ) : null}

          {loading ? (
            <AdminPanel className="overflow-hidden" bodyClassName="flex items-center justify-center gap-2 px-4 py-12">
              <Loader2 size={16} className="animate-spin text-p-accent" />
              <span className="text-[13px] font-medium text-p-text-secondary">
                Cargando operación de WhatsApp...
              </span>
            </AdminPanel>
          ) : null}

          {!loading && data ? (
            <>
              <AdminFeedbackBanner tone={toneByPreflightStatus[preflightStatus]} title="Estado de readiness">
                <>
                  Preflight <strong>{data.preflight.status}</strong>. Checks: {data.preflight.checks.length}.
                </>
              </AdminFeedbackBanner>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Deliveries 24h"
                  value={data.summary.totals.last24h}
                  helper="Actividad reciente"
                />
                <MetricCard
                  label="Deliveries 7d"
                  value={data.summary.totals.last7d}
                  helper="Ventana operativa"
                />
                <MetricCard
                  label="Accepted sin webhook"
                  value={data.summary.acceptedWithoutWebhookCount}
                  helper={`Más viejos que ${data.summary.acceptedStaleMinutes} min`}
                />
                <MetricCard
                  label="Webhooks huérfanos"
                  value={data.summary.orphanWebhookCount}
                  helper="Eventos sin delivery asociado"
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
                <AdminPanel
                  title="Preflight"
                  description="Readiness real antes de encender o ampliar rollout."
                  bodyClassName="overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-p-border text-left text-[12px]">
                      <thead className="bg-p-surface-2 text-p-text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Check</th>
                          <th className="px-4 py-3 font-semibold">Severidad</th>
                          <th className="px-4 py-3 font-semibold">Estado</th>
                          <th className="px-4 py-3 font-semibold">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-p-border">
                        {data.preflight.checks.map((check) => (
                          <tr key={check.key} className="align-top">
                            <td className="px-4 py-3 font-semibold text-p-text">{check.key}</td>
                            <td className="px-4 py-3 text-p-text-secondary">{check.severity}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={check.ok ? 'OK' : 'FAIL'} />
                            </td>
                            <td className="px-4 py-3 text-p-text-secondary">{check.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AdminPanel>

                <AdminPanel
                  title="Resumen operativo"
                  description="Conteos por estado, rol y evento."
                >
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.summary.countsByStatus).map(([key, value]) => (
                      <span key={key} className={adminChipClassName}>
                        Estado {key}: {value}
                      </span>
                    ))}
                    {Object.entries(data.summary.countsByRecipientRole).map(([key, value]) => (
                      <span key={key} className={adminChipClassName}>
                        Rol {key}: {value}
                      </span>
                    ))}
                    {Object.entries(data.summary.countsByEventType).map(([key, value]) => (
                      <span key={key} className={adminChipClassName}>
                        Evento {key}: {value}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-[12px] font-semibold text-p-text">Errores más frecuentes</p>
                    {data.summary.topErrors.length > 0 ? (
                      data.summary.topErrors.map((item) => (
                        <div
                          key={item.errorCode}
                          className="flex items-center justify-between rounded-lg border border-p-border bg-p-surface-2 px-3 py-2 text-[12px]"
                        >
                          <span className="font-semibold text-p-text">{item.errorCode}</span>
                          <span className="text-p-text-secondary">{item.count}</span>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-p-border px-3 py-3 text-[12px] text-p-text-muted">
                        No hay errores registrados en la ventana actual.
                      </div>
                    )}
                  </div>
                </AdminPanel>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <AdminPanel
                  title="Deliveries recientes"
                  description="Últimos 10 deliveries del pipeline WhatsApp."
                  bodyClassName="overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-p-border text-left text-[12px]">
                      <thead className="bg-p-surface-2 text-p-text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Estado</th>
                          <th className="px-4 py-3 font-semibold">Evento</th>
                          <th className="px-4 py-3 font-semibold">Rol</th>
                          <th className="px-4 py-3 font-semibold">Destino</th>
                          <th className="px-4 py-3 font-semibold">Fecha</th>
                          <th className="px-4 py-3 font-semibold">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-p-border">
                        {data.deliveries.items.map((item) => (
                          <tr key={item.id} className="align-top">
                            <td className="px-4 py-3">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-p-text">{item.eventType}</div>
                              <div className="mt-1 text-p-text-muted">{item.provider}</div>
                            </td>
                            <td className="px-4 py-3 text-p-text-secondary">{item.recipientRole}</td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-p-text">{item.recipientPhoneMasked}</div>
                              {item.errorCode ? (
                                <div className="mt-1 text-p-error">{item.errorCode}</div>
                              ) : item.providerMessageId ? (
                                <div className="mt-1 text-p-text-muted">{item.providerMessageId}</div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-p-text-secondary">{formatDateTime(item.createdAt)}</td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                className={adminButtonClassName}
                                onClick={() => {
                                  void resendDelivery(item.id);
                                }}
                                disabled={resendingId === item.id}
                              >
                                {resendingId === item.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <RefreshCcw size={14} />
                                )}
                                Reenviar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AdminPanel>

                <AdminPanel
                  title="Webhook events recientes"
                  description="Últimos 10 eventos procesados desde Meta."
                  bodyClassName="overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-p-border text-left text-[12px]">
                      <thead className="bg-p-surface-2 text-p-text-muted">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Tipo</th>
                          <th className="px-4 py-3 font-semibold">Estado</th>
                          <th className="px-4 py-3 font-semibold">Asociación</th>
                          <th className="px-4 py-3 font-semibold">Fecha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-p-border">
                        {data.webhookEvents.items.map((item) => (
                          <tr key={item.id} className="align-top">
                            <td className="px-4 py-3 font-semibold text-p-text">{item.eventType}</td>
                            <td className="px-4 py-3">
                              <StatusBadge status={item.status || 'IGNORED'} />
                            </td>
                            <td className="px-4 py-3">
                              {item.orphan ? (
                                <span className="inline-flex items-center gap-1 text-p-warning">
                                  <AlertTriangle size={12} />
                                  Huérfano
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-p-positive">
                                  <CheckCircle2 size={12} />
                                  Asociado
                                </span>
                              )}
                              {item.providerMessageId ? (
                                <div className="mt-1 text-p-text-muted">{item.providerMessageId}</div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-p-text-secondary">{formatDateTime(item.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AdminPanel>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </AdminRouteShell>
  );
}

function MetricCard({
  label,
  value,
  helper
}: {
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <AdminPanel>
      <div className="space-y-1">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-p-text-muted">{label}</p>
        <p className="text-[28px] font-semibold leading-none text-p-text">{value}</p>
        <p className="text-[12px] text-p-text-secondary">{helper}</p>
      </div>
    </AdminPanel>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    toneByDeliveryStatus[status] || 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone}`}
    >
      {status}
    </span>
  );
}
