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

const formatDateTime = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
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
        description="Conectá la cuenta de Mercado Pago del club para habilitar el pago online de reservas."
      >
        {error ? (
          <AdminFeedbackBanner tone="error" className="mb-3">
            {error}
          </AdminFeedbackBanner>
        ) : null}

        <div className="rounded-2xl border border-p-border bg-p-surface-2 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-p-border bg-p-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-p-text-secondary">
                <CreditCard size={13} />
                Mercado Pago
              </div>
              <div>
                <p className="text-[15px] font-semibold text-p-text">
                  {loading ? 'Cargando...' : integrationStatusLabel(mercadoPago?.status || 'DISCONNECTED')}
                </p>
                <p className="mt-1 text-[13px] text-p-text-secondary">
                  El dinero de las reservas online entra directo a la cuenta conectada del club.
                </p>
              </div>

              <dl className="grid gap-2 text-[12px] text-p-text-secondary md:grid-cols-2">
                <div>
                  <dt className="font-semibold text-p-text">Conectado por</dt>
                  <dd>{mercadoPago?.connectedBy ? fullName(mercadoPago) : '—'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-p-text">Última actualización</dt>
                  <dd>{mercadoPago ? formatDateTime(mercadoPago.updatedAt) : '—'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-p-text">Usuario externo</dt>
                  <dd>{mercadoPago?.externalUserId || '—'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-p-text">Desconectado</dt>
                  <dd>{mercadoPago?.disconnectedAt ? formatDateTime(mercadoPago.disconnectedAt) : '—'}</dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={clubSlug ? ClubAdminService.getMercadoPagoConnectUrl(clubSlug) : '#'}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 text-[12px] font-semibold !text-ink-50 transition hover:bg-ink-800"
                aria-disabled={!clubSlug}
              >
                <PlugZap size={14} />
                {mercadoPago?.connected ? 'Reconectar Mercado Pago' : 'Conectar Mercado Pago'}
              </a>
              {mercadoPago?.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-p-border px-4 text-[12px] font-semibold text-p-text transition hover:bg-p-error-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Link2Off size={14} />
                  {disconnecting ? 'Desconectando...' : 'Desconectar'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <AdminFeedbackBanner tone="info" compact>
            No mostramos tokens ni credenciales. La conexión queda limitada al club activo y el checkout público usa el saldo real de la cuenta BOOKING.
          </AdminFeedbackBanner>
        </div>
      </AdminPanel>
    </div>
  );
}
