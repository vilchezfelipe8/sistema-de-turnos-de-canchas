import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { CreditCard, Link2Off, PlugZap } from 'lucide-react';
import AdminEmptyState from '../../../components/admin/ui/AdminEmptyState';
import AdminPanel from '../../../components/admin/ui/AdminPanel';
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

  return (
    <div className="space-y-4">
      <AdminPanel
        title="Integraciones"
        description="Servicios conectados al club."
      >
        {error ? (
          <AdminFeedbackBanner tone="error" className="mb-3">
            {error}
          </AdminFeedbackBanner>
        ) : null}

        {(() => {
          const status = mercadoPago?.status || 'DISCONNECTED';
          const connected = Boolean(mercadoPago?.connected) && status === 'CONNECTED';
          const needsReconnect = status === 'EXPIRED' || status === 'ERROR';
          const connectedOn = formatDay(mercadoPago?.updatedAt);
          return (
            <div className="rounded-2xl border border-p-border p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <CreditCard size={16} className="text-p-text-muted" />
                    <p className="text-[15px] font-semibold text-p-text">Mercado Pago</p>
                    {!loading && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          connected
                            ? 'bg-p-positive-bg text-p-positive'
                            : needsReconnect
                              ? 'bg-p-warning-bg text-p-warning'
                              : 'bg-p-surface-3 text-p-text-secondary'
                        }`}
                      >
                        {integrationStatusLabel(status)}
                      </span>
                    )}
                  </div>
                  {loading ? (
                    <p className="text-[13px] text-p-text-muted">Cargando...</p>
                  ) : connected ? (
                    <p className="text-[13px] text-p-text-secondary">
                      La plata de las reservas y señas que se pagan desde la app entra directo a esta cuenta.
                      {mercadoPago?.connectedBy ? ` Lo conectó ${fullName(mercadoPago)}${connectedOn ? ` el ${connectedOn}` : ''}.` : ''}
                    </p>
                  ) : needsReconnect ? (
                    <p className="text-[13px] font-medium text-p-warning">
                      La conexión se cortó. Volvé a conectarlo para seguir cobrando desde la app.
                    </p>
                  ) : (
                    <p className="text-[13px] text-p-text-secondary">
                      Conectalo para que los jugadores puedan pagar reservas y señas desde la app. La plata entra directo a la
                      cuenta del club.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={clubSlug ? ClubAdminService.getMercadoPagoConnectUrl(clubSlug) : '#'}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 text-[13px] font-semibold !text-ink-50 transition hover:bg-ink-800"
                    aria-disabled={!clubSlug}
                  >
                    <PlugZap size={14} />
                    {connected || needsReconnect ? 'Volver a conectar' : 'Conectar Mercado Pago'}
                  </a>
                  {mercadoPago?.connected ? (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-p-border px-4 text-[13px] font-semibold text-p-text transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Link2Off size={14} />
                      {disconnecting ? 'Desconectando...' : 'Desconectar'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })()}

        <p className="mt-3 text-[12px] text-p-text-muted">Pique nunca ve ni guarda tu clave de Mercado Pago.</p>
      </AdminPanel>
    </div>
  );
}
