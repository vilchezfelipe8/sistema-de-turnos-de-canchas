import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Link2, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { PaymentGatewayService, type FiscalDocument, type GatewayTransaction, type PaymentProviderAccount } from '../../services/PaymentGatewayService';

export default function ClubPaymentsFiscalSettings() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<PaymentProviderAccount[]>([]);
  const [transactions, setTransactions] = useState<GatewayTransaction[]>([]);
  const [fiscalDocs, setFiscalDocs] = useState<FiscalDocument[]>([]);

  const [displayName, setDisplayName] = useState('Mercado Pago');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const [reprocessExternalId, setReprocessExternalId] = useState('');
  const [reprocessProviderAccountId, setReprocessProviderAccountId] = useState('');
  const [reprocessPaymentHint, setReprocessPaymentHint] = useState('');

  const mpAccounts = useMemo(
    () => accounts.filter((account) => account.provider === 'MERCADOPAGO'),
    [accounts]
  );

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [accountRows, txRows, docRows] = await Promise.all([
        PaymentGatewayService.listProviderAccounts(),
        PaymentGatewayService.listGatewayTransactions({ take: 30 }),
        PaymentGatewayService.listFiscalDocuments({ take: 30 })
      ]);

      setAccounts(accountRows);
      setTransactions(txRows);
      setFiscalDocs(docRows);
      if (!reprocessProviderAccountId && accountRows.length > 0) {
        setReprocessProviderAccountId(accountRows[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar configuracion de cobros');
    } finally {
      setLoading(false);
    }
  }, [reprocessProviderAccountId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCreateMpAccount = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      await PaymentGatewayService.createProviderAccount({
        provider: 'MERCADOPAGO',
        displayName: displayName.trim() || 'Mercado Pago',
        webhookSecretEncrypted: webhookSecret.trim() || undefined,
        isDefault
      });
      setWebhookSecret('');
      setIsDefault(false);
      setSuccess('Cuenta proveedora creada');
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No se pudo crear la cuenta de Mercado Pago');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectOAuth = async (providerAccountId: string) => {
    try {
      setLoading(true);
      setError(null);
      const result = await PaymentGatewayService.getMercadoPagoOAuthStartUrl(providerAccountId);
      window.location.href = result.authorizationUrl;
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar la vinculacion OAuth');
      setLoading(false);
    }
  };

  const handleToggleStatus = async (account: PaymentProviderAccount) => {
    try {
      setLoading(true);
      setError(null);
      const nextStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await PaymentGatewayService.updateProviderAccountStatus(account.id, { status: nextStatus });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No se pudo actualizar el estado de la cuenta');
      setLoading(false);
    }
  };

  const handleSetDefault = async (accountId: string) => {
    try {
      setLoading(true);
      setError(null);
      await PaymentGatewayService.updateProviderAccountStatus(accountId, { status: 'ACTIVE', isDefault: true });
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No se pudo marcar cuenta por defecto');
      setLoading(false);
    }
  };

  const handleReprocess = async () => {
    try {
      if (!reprocessExternalId.trim()) {
        setError('Ingresa el externalId de Mercado Pago para reprocesar');
        return;
      }
      if (!reprocessProviderAccountId.trim()) {
        setError('Selecciona una cuenta proveedora');
        return;
      }

      setLoading(true);
      setError(null);
      setSuccess(null);
      await PaymentGatewayService.reprocessMercadoPagoTransaction(reprocessExternalId.trim(), {
        providerAccountId: reprocessProviderAccountId,
        paymentIdHint: reprocessPaymentHint.trim() || undefined
      });
      setSuccess('Transaccion reprocesada correctamente');
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No se pudo reprocesar la transaccion');
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#347048]/10 p-6 rounded-[1.5rem] border-2 border-[#347048]/20 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#347048]">
          <CreditCard size={18} strokeWidth={3} />
          <h3 className="text-xs font-black uppercase tracking-[0.2em]">Cobros y Fiscal por Club</h3>
        </div>
        <button
          type="button"
          onClick={loadAll}
          className="h-10 px-3 rounded-xl bg-white text-[#347048] border border-[#347048]/20 text-[11px] font-black uppercase tracking-widest flex items-center gap-2"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-[#B9CF32]/40 bg-[#B9CF32]/20 px-3 py-2 text-[12px] font-bold text-[#347048]">{success}</div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-white/50 rounded-2xl border border-white p-4 space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048]">Cuenta Mercado Pago</p>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Nombre de la cuenta"
            className="w-full h-11 rounded-xl px-3 border-2 border-transparent focus:border-[#B9CF32] text-[#347048] font-black text-sm"
          />
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="Webhook secret (opcional)"
            className="w-full h-11 rounded-xl px-3 border-2 border-transparent focus:border-[#B9CF32] text-[#347048] font-black text-sm"
          />
          <label className="flex items-center gap-2 text-[#347048] text-sm font-black">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Cuenta por defecto
          </label>
          <button
            type="button"
            onClick={handleCreateMpAccount}
            className="w-full h-11 rounded-xl bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] text-[11px] font-black uppercase tracking-widest"
            disabled={loading}
          >
            Crear cuenta
          </button>
        </div>

        <div className="bg-white/50 rounded-2xl border border-white p-4 space-y-3">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048]">Reproceso manual</p>
          <select
            value={reprocessProviderAccountId}
            onChange={(e) => setReprocessProviderAccountId(e.target.value)}
            className="w-full h-11 rounded-xl px-3 border-2 border-transparent focus:border-[#B9CF32] text-[#347048] font-black text-sm"
          >
            <option value="">Seleccionar cuenta...</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} ({account.provider}) {account.isDefault ? '· default' : ''}
              </option>
            ))}
          </select>
          <input
            value={reprocessExternalId}
            onChange={(e) => setReprocessExternalId(e.target.value)}
            placeholder="ExternalId Mercado Pago"
            className="w-full h-11 rounded-xl px-3 border-2 border-transparent focus:border-[#B9CF32] text-[#347048] font-black text-sm"
          />
          <input
            value={reprocessPaymentHint}
            onChange={(e) => setReprocessPaymentHint(e.target.value)}
            placeholder="PaymentId local (opcional)"
            className="w-full h-11 rounded-xl px-3 border-2 border-transparent focus:border-[#B9CF32] text-[#347048] font-black text-sm"
          />
          <button
            type="button"
            onClick={handleReprocess}
            className="w-full h-11 rounded-xl bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
            disabled={loading}
          >
            <Wrench size={14} />
            Reprocesar
          </button>
        </div>
      </div>

      <div className="bg-white/50 rounded-2xl border border-white p-4">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-3">Cuentas proveedoras del club</p>
        {accounts.length === 0 ? (
          <p className="text-[11px] font-bold text-[#347048]/60">No hay cuentas configuradas.</p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-auto pr-1">
            {accounts.map((account) => (
              <div key={account.id} className="rounded-xl border border-white bg-[#EBE1D8] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-[#347048]">{account.displayName}</p>
                  <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-white text-[#347048]">
                    {account.provider} · {account.status}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-[#347048]/70 mt-1">
                  {account.isDefault ? 'Cuenta por defecto · ' : ''}Merchant: {account.externalMerchantId || 'sin vincular'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {account.provider === 'MERCADOPAGO' ? (
                    <button
                      type="button"
                      onClick={() => handleConnectOAuth(account.id)}
                      className="h-9 px-3 rounded-lg bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] text-[10px] font-black uppercase tracking-widest flex items-center gap-1"
                    >
                      <Link2 size={12} />
                      Conectar OAuth
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(account)}
                    className="h-9 px-3 rounded-lg bg-white text-[#347048] text-[10px] font-black uppercase tracking-widest"
                  >
                    {account.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}
                  </button>
                  {!account.isDefault ? (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(account.id)}
                      className="h-9 px-3 rounded-lg bg-white text-[#347048] text-[10px] font-black uppercase tracking-widest"
                    >
                      Marcar default
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-white/50 rounded-2xl border border-white p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-3">Transacciones gateway</p>
          {transactions.length === 0 ? (
            <p className="text-[11px] font-bold text-[#347048]/60">Sin transacciones.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-auto pr-1">
              {transactions.map((tx) => (
                <div key={tx.id} className="rounded-xl border border-white bg-[#EBE1D8] p-3">
                  <p className="text-sm font-black text-[#347048]">{tx.provider} · {tx.type} · {tx.status}</p>
                  <p className="text-[11px] font-bold text-[#347048]/70">externalId: {tx.externalId}</p>
                  <p className="text-[11px] font-bold text-[#347048]/70">
                    {tx.currency} {Number(tx.amount || 0).toFixed(2)} {tx.paymentId ? `· payment ${tx.paymentId}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white/50 rounded-2xl border border-white p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#347048] mb-3 flex items-center gap-2">
            <ShieldCheck size={14} />
            Documentos fiscales
          </p>
          {fiscalDocs.length === 0 ? (
            <p className="text-[11px] font-bold text-[#347048]/60">Sin documentos fiscales.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-auto pr-1">
              {fiscalDocs.map((doc) => (
                <div key={doc.id} className="rounded-xl border border-white bg-[#EBE1D8] p-3">
                  <p className="text-sm font-black text-[#347048]">{doc.type} · {doc.status}</p>
                  <p className="text-[11px] font-bold text-[#347048]/70">
                    {doc.currency} {Number(doc.totalAmount || 0).toFixed(2)} · CAE {doc.cae || '-'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] font-bold text-[#347048]/70">
        Cada configuracion se aplica al club activo del admin (aislado por club).
      </p>
    </div>
  );
}
