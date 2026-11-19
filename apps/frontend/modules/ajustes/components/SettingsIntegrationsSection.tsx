import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { CreditCard, Link2Off, Lock, PlugZap } from 'lucide-react';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import { AdminFeedbackBanner } from '../../../components/admin/ui/AdminFeedback';
import { useAuth } from '../../../contexts/AuthContext';
import { ClubAdminService, type AdminClubPaymentIntegration } from '../../../services/ClubAdminService';
import { showAdminToast } from '../../../utils/adminToast';
import { extractErrorMessage } from '../../../utils/uiError';
import { getActiveClubSlug, hasAdminAccess } from '../../../utils/session';

const integrationStatusLabel = (status: AdminClubPaymentIntegration['status']) => {
  if (status === 'CONNECTED') return 'Conectado';
  if (status === 'EXPIRED') return 'Expirado';
  if (status === 'ERROR') return 'Con error';
  return 'Desconectado';
};

/** "7 nov 2026". Fechas vacías (o la fecha 0 = 31/12/69) no se muestran. */
const formatDay = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return '';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
};

const fullName = (integration: AdminClubPaymentIntegration) => {
  const first = String(integration.connectedBy?.firstName || '').trim();
  const last = String(integration.connectedBy?.lastName || '').trim();
  const name = `${first} ${last}`.trim();
  return name || integration.connectedBy?.email || '—';
};

export default function SettingsIntegrationsSection() {
  const router = useRouter();
  const { user } = useAuth();
  const clubSlug = useMemo(() => getActiveClubSlug(user as any), [user]);
  const canManage = hasAdminAccess(user as any);
  const [integrations, setIntegrations] = useState<AdminClubPaymentIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  const mercadoPago = integrations.find((item) => item.provider === 'MERCADO_PAGO') || null;

  const loadIntegrations = async (silent = false) => {
    if (!clubSlug) return;
    if (!silent) setLoading(true);
    try {
      const items = await ClubAdminService.listPaymentIntegrations(clubSlug);
      setIntegrations(items);
      setError('');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudieron cargar las integraciones del club.'));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadIntegrations();
  }, [clubSlug]);

  useEffect(() => {
    const provider = String(router.query.provider || '').trim().toLowerCase();
    const status = String(router.query.integrationStatus || '').trim().toLowerCase();
    if (provider !== 'mercadopago' || !status) return;

    if (status === 'connected') {
      showAdminToast('Mercado Pago quedó conectado.');
    } else if (status === 'disconnected') {
      showAdminToast('Mercado Pago quedó desconectado.');
    } else if (status === 'error') {
      setError('No se pudo completar la conexión con Mercado Pago.');
    }

    const nextQuery = { ...router.query } as Record<string, unknown>;
    delete nextQuery.provider;
    delete nextQuery.integrationStatus;
    delete nextQuery.club;
    void router.replace({ pathname: router.pathname, query: nextQuery as any }, undefined, { shallow: true });
    void loadIntegrations(true);
  }, [router]);

  const handleDisconnect = async () => {
    if (!clubSlug || disconnecting) return;
    setDisconnecting(true);
    try {
      await ClubAdminService.disconnectMercadoPago(clubSlug);
      await loadIntegrations(true);
      showAdminToast('Mercado Pago quedó desconectado.');
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo desconectar Mercado Pago.'));
    } finally {
      setDisconnecting(false);
    }
  };

  if (!canManage) {
    return (
      <AdminEmptyState
        title="Sin permiso para integraciones"
        description="Solo owner y admin pueden conectar proveedores de pago del club."
      />
    );
  }

  const status = mercadoPago?.status || 'DISCONNECTED';
  const connected = Boolean(mercadoPago?.connected) && status === 'CONNECTED';
  const needsReconnect = status === 'EXPIRED' || status === 'ERROR';
  const connectedOn = formatDay(mercadoPago?.updatedAt);
  const statusTone = connected
    ? 'bg-p-positive-bg text-p-positive'
    : needsReconnect
      ? 'bg-p-warning-bg text-p-warning'
      : 'bg-p-surface-2 text-p-text-muted';
  const statusDot = connected ? 'bg-p-positive' : needsReconnect ? 'bg-p-warning' : 'bg-p-text-muted';

  return (
    <div className="space-y-4">
      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <section className="overflow-hidden rounded-xl border border-p-border bg-p-surface">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#009EE3]/10 text-[#009EE3]">
            <CreditCard size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold text-p-text">Mercado Pago</p>
              {!loading && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                  {integrationStatusLabel(status)}
                </span>
              )}
            </div>
            {loading ? (
              <p className="mt-1 h-4 w-64 animate-pulse rounded bg-p-surface-2" />
            ) : connected ? (
              <p className="mt-0.5 text-[13px] text-p-text-muted">
                Las reservas y señas que se pagan desde la app entran directo a esta cuenta.
                {mercadoPago?.connectedBy ? ` Lo conectó ${fullName(mercadoPago)}${connectedOn ? ` el ${connectedOn}` : ''}.` : ''}
              </p>
            ) : needsReconnect ? (
              <p className="mt-0.5 text-[13px] font-medium text-p-warning">
                Se cortó la conexión. Volvé a conectarlo para seguir cobrando desde la app.
              </p>
            ) : (
              <p className="mt-0.5 text-[13px] text-p-text-muted">
                Los jugadores pagan reservas y señas desde la app y la plata entra directo a la cuenta del club.
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {mercadoPago?.connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-p-border px-3 text-[12px] font-semibold text-p-text-secondary transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Link2Off size={14} />
                {disconnecting ? 'Desconectando…' : 'Desconectar'}
              </button>
            ) : null}
            {!connected && (
              <a
                href={clubSlug ? ClubAdminService.getMercadoPagoConnectUrl(clubSlug) : '#'}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-ink-900 px-3.5 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800"
                aria-disabled={!clubSlug}
              >
                <PlugZap size={14} />
                {needsReconnect ? 'Volver a conectar' : 'Conectar'}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-p-border bg-p-surface-2/60 px-5 py-2.5 text-[12px] text-p-text-muted">
          <Lock size={13} className="shrink-0" />
          Te conectás en Mercado Pago: Pique nunca ve ni guarda tu clave.
        </div>
      </section>
    </div>
  );
}
