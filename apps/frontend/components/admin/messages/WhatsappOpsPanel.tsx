import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import AdminPanel from '../ui/AdminPanel';
import { AdminFeedbackBanner } from '../ui/AdminFeedback';
import { fetchWithAuth } from '../../../utils/apiClient';
import { getApiUrl } from '../../../utils/apiUrl';
import { normalizeApiError, throwApiErrorFromResponse } from '../../../utils/apiError';
import { showAdminToast } from '../../../utils/adminToast';

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

/** Panel técnico de WhatsApp (solo equipo Pique: requiere admin global). */
export default function WhatsappOpsPanel() {
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
  const failingChecks = data ? data.preflight.checks.filter((check) => !check.ok) : [];
  const passingChecks = data ? data.preflight.checks.filter((check) => check.ok) : [];
  const failingGroups = groupFailingChecks(failingChecks);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-p-text">Estado técnico de WhatsApp</p>
          <p className="text-[13px] text-p-text-muted">Solo lo ve el equipo de Pique. Sirve para saber qué falta antes de prender los avisos.</p>
        </div>
        <button type="button" className={adminButtonClassName} onClick={() => void load('reload')} disabled={reloading}>
          {reloading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          Actualizar
        </button>
      </div>

      {error ? (
        <AdminFeedbackBanner tone="error" title="No pudimos cargar el panel">
          {error}
        </AdminFeedbackBanner>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-p-border bg-p-surface px-4 py-12">
          <Loader2 size={16} className="animate-spin text-p-accent" />
          <span className="text-[13px] font-medium text-p-text-secondary">Cargando...</span>
        </div>
      ) : null}

      {!loading && data ? (
        <>
          <AdminFeedbackBanner
            tone={toneByPreflightStatus[preflightStatus]}
            title={
              preflightStatus === 'OK'
                ? 'Todo listo para mandar avisos'
                : preflightStatus === 'FAIL'
                  ? `Falta resolver ${failingGroups.length} ${failingGroups.length === 1 ? 'cosa' : 'cosas'} antes de prender los avisos`
                  : `Funciona, pero hay ${failingGroups.length} ${failingGroups.length === 1 ? 'cosa' : 'cosas'} para revisar`
            }
          >
            {preflightStatus === 'OK'
              ? 'El número, las plantillas y la conexión con Meta están bien.'
              : 'Abajo está cada una con qué hacer.'}
          </AdminFeedbackBanner>

          {failingChecks.length > 0 && (
            <section>
              <p className="mb-1.5 px-1 text-[13px] font-semibold text-p-text">Qué falta</p>
              <ul className="divide-y divide-p-border rounded-2xl border border-p-border bg-p-surface">
                {failingGroups.map((group) => (
                  <li key={group.checks[0].key} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        size={15}
                        className={`mt-0.5 flex-none ${group.checks.some((check) => check.severity === 'ERROR') ? 'text-p-error' : 'text-p-warning'}`}
                      />
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-p-text">{group.title}</p>
                        <p className="text-[12px] text-p-text-muted">{group.fix}</p>
                        <details className="mt-1 text-[12px] text-p-text-muted">
                          <summary className="cursor-pointer select-none font-semibold">Detalle técnico</summary>
                          {group.checks.map((check) => (
                            <div key={check.key} className="mt-1">
                              <p className="break-all font-mono text-[11px]">{check.key}</p>
                              <p>{check.message}</p>
                            </div>
                          ))}
                        </details>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {passingChecks.length > 0 && (
            <details className="rounded-2xl border border-p-border bg-p-surface px-4 py-3">
              <summary className="cursor-pointer select-none text-[13px] font-semibold text-p-text">
                <CheckCircle2 size={14} className="mr-1 inline text-p-positive" />
                {passingChecks.length} {passingChecks.length === 1 ? 'chequeo está bien' : 'chequeos están bien'}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {passingChecks.map((check) => (
                  <li key={check.key} className="text-[12px] text-p-text-secondary">
                    <span className="font-semibold text-p-text">{explainCheck(check.key).okTitle}</span>
                    <span className="block break-all font-mono text-[11px] text-p-text-muted">{check.key}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <MetricCard label="Últimas 24 h" value={data.summary.totals.last24h} helper="mensajes" />
            <MetricCard label="Últimos 7 días" value={data.summary.totals.last7d} helper="mensajes" />
            <MetricCard
              label="Sin confirmar"
              value={data.summary.acceptedWithoutWebhookCount}
              helper={`Meta no avisó si llegaron (más de ${data.summary.acceptedStaleMinutes} min)`}
            />
            <MetricCard
              label="Avisos sueltos"
              value={data.summary.orphanWebhookCount}
              helper="Meta avisó de mensajes que no tenemos"
            />
          </div>

          {data.summary.topErrors.length > 0 && (
            <section>
              <p className="mb-1.5 px-1 text-[13px] font-semibold text-p-text">Errores más frecuentes</p>
              <ul className="divide-y divide-p-border rounded-2xl border border-p-border bg-p-surface">
                {data.summary.topErrors.map((item) => (
                  <li key={item.errorCode} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <span className="text-p-text">
                      {explainErrorCode(item.errorCode)}
                      <span className="ml-1 font-mono text-[11px] text-p-text-muted">{item.errorCode}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-p-text">{item.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className="mb-1.5 px-1 text-[13px] font-semibold text-p-text">Últimos mensajes (todos los clubes)</p>
            {data.deliveries.items.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-p-border px-4 py-6 text-center text-[13px] text-p-text-muted">
                Todavía no salió ningún mensaje.
              </p>
            ) : (
              <ul className="divide-y divide-p-border rounded-2xl border border-p-border bg-p-surface">
                {data.deliveries.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-p-text">
                        {EVENT_LABEL[item.eventType] || item.eventType} · {item.recipientRole === 'CLUB_STAFF' ? 'al club' : 'al cliente'}
                      </p>
                      <p className="text-[12px] text-p-text-muted">
                        Club {item.clubId} · {item.recipientPhoneMasked} · {formatDateTime(item.createdAt)}
                      </p>
                      {item.errorCode ? (
                        <p className="text-[12px] text-p-error">
                          {explainErrorCode(item.errorCode)} <span className="font-mono text-[11px]">({item.errorCode})</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      <StatusBadge status={item.status} />
                      {item.status === 'FAILED' && (
                      <button
                        type="button"
                        className={adminButtonClassName}
                        onClick={() => {
                          if (!window.confirm('¿Reenviar este WhatsApp? Le va a llegar de nuevo a esa persona.')) return;
                          void resendDelivery(item.id);
                        }}
                        disabled={resendingId === item.id}
                      >
                        {resendingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                        Reenviar
                      </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="rounded-2xl border border-p-border bg-p-surface px-4 py-3">
            <summary className="cursor-pointer select-none text-[13px] font-semibold text-p-text">
              Avisos de Meta y conteos ({data.webhookEvents.items.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(data.summary.countsByStatus).map(([key, value]) => (
                <span key={`s-${key}`} className={adminChipClassName}>
                  {STATUS_LABEL[key] || key}: {value}
                </span>
              ))}
              {Object.entries(data.summary.countsByEventType).map(([key, value]) => (
                <span key={`e-${key}`} className={adminChipClassName}>
                  {EVENT_LABEL[key] || key}: {value}
                </span>
              ))}
            </div>
            {data.webhookEvents.items.length === 0 ? (
              <p className="mt-2 text-[12px] text-p-text-muted">Meta todavía no mandó avisos.</p>
            ) : (
              <ul className="mt-2 divide-y divide-p-border">
                {data.webhookEvents.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
                    <span className="text-p-text">
                      {item.eventType} · {formatDateTime(item.createdAt)}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={item.status || 'IGNORED'} />
                      {item.orphan ? (
                        <span className="inline-flex items-center gap-1 text-p-warning">
                          <AlertTriangle size={12} />
                          Sin mensaje
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-p-positive">
                          <CheckCircle2 size={12} />
                          Asociado
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      ) : null}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  BOOKING_CREATED: 'Reserva hecha',
  BOOKING_CANCELLED: 'Reserva cancelada',
  BOOKING_PENDING_WARNING: 'Aviso antes de cancelar',
  ACCOUNT_VERIFICATION_CODE: 'Código de la app',
};

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Por salir',
  ACCEPTED: 'Aceptado por Meta',
  SENT: 'Enviado',
  DELIVERED: 'Llegó',
  READ: 'Leído',
  FAILED: 'Falló',
  SKIPPED: 'No se mandó',
  IGNORED: 'Ignorado',
};

const TEMPLATE_LABEL: Record<string, string> = {
  customer_booking_created_v1: 'Reserva hecha (al cliente)',
  customer_booking_cancelled_v1: 'Reserva cancelada (al cliente)',
  customer_booking_pending_warning_v1: 'Aviso antes de cancelar (al cliente)',
  staff_booking_created_v1: 'Nueva reserva (al club)',
  staff_booking_cancelled_v1: 'Reserva cancelada (al club)',
  staff_booking_pending_warning_v1: 'Reserva sin confirmar (al club)',
};

/** Cada chequeo en palabras: qué pasa y qué hacer. */
const explainCheck = (key: string): { title: string; fix: string; okTitle: string } => {
  if (key.startsWith('template.')) {
    const name = key.slice('template.'.length);
    const label = TEMPLATE_LABEL[name] || name;
    return {
      title: `Falta la plantilla "${label}"`,
      fix: 'Crearla y aprobarla en Meta, y cargarla activa en Pique.',
      okTitle: `Plantilla "${label}" lista`,
    };
  }
  switch (key) {
    case 'sender.exists':
      return { title: 'No está cargado el número de WhatsApp de Pique', fix: 'Correr el script de alta de WhatsApp (bootstrapWhatsappCloudApi).', okTitle: 'Número de Pique cargado' };
    case 'sender.active':
      return { title: 'El número de Pique no está activo', fix: 'Activarlo cuando Meta lo apruebe.', okTitle: 'Número de Pique activo' };
    case 'sender.phoneNumberId':
      return { title: 'Falta el ID del número en Meta', fix: 'Copiarlo de Meta (WhatsApp > API) y cargarlo en el número de Pique.', okTitle: 'ID del número cargado' };
    case 'sender.wabaId':
      return { title: 'Falta el ID de la cuenta de WhatsApp Business', fix: 'Copiarlo de Meta y cargarlo en el número de Pique.', okTitle: 'Cuenta de WhatsApp Business cargada' };
    case 'sender.tokenSecretRef':
    case 'sender.tokenEnv':
      return { title: 'Falta el token de acceso de Meta', fix: 'Cargar el token en las variables del servidor y referenciarlo en el número de Pique.', okTitle: 'Token de Meta cargado' };
    case 'webhook.verifyToken':
      return { title: 'Meta no puede avisarnos si los mensajes llegan', fix: 'Revisar el token de verificación del webhook en Meta y en el servidor.', okTitle: 'Meta puede avisarnos si los mensajes llegan' };
    default:
      return { title: key, fix: 'Ver el detalle técnico.', okTitle: key };
  }
};

/**
 * Junta los chequeos que dicen lo mismo (ej. los dos del token) y, si falta el número de Pique,
 * mete adentro todo lo del número: no tiene sentido pedir su ID si el número no existe.
 */
const groupFailingChecks = (checks: PreflightCheck[]) => {
  const senderMissing = checks.some((check) => check.key === 'sender.exists');
  const groups: Array<{ title: string; fix: string; checks: PreflightCheck[] }> = [];
  for (const check of checks) {
    const explained =
      senderMissing && check.key.startsWith('sender.') ? explainCheck('sender.exists') : explainCheck(check.key);
    const existing = groups.find((group) => group.title === explained.title);
    if (existing) existing.checks.push(check);
    else groups.push({ title: explained.title, fix: explained.fix, checks: [check] });
  }
  return groups;
};

/** Códigos de error de Meta más comunes, en palabras. */
const explainErrorCode = (code: string): string => {
  switch (String(code)) {
    case '131026':
      return 'El número no tiene WhatsApp';
    case '131047':
      return 'Pasaron más de 24 h sin respuesta del cliente';
    case '131051':
      return 'Tipo de mensaje no soportado';
    case '132000':
    case '132001':
      return 'Problema con la plantilla';
    case '130429':
      return 'Demasiados mensajes seguidos';
    case '190':
      return 'El token de Meta venció';
    default:
      return 'Error de WhatsApp';
  }
};

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
      {STATUS_LABEL[status] || status}
    </span>
  );
}
