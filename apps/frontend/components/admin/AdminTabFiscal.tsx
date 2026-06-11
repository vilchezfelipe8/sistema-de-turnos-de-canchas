import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveClubSlug } from '../../utils/session';
import { extractErrorMessage } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import {
  getFiscalConfig,
  updateFiscalConfig,
  uploadCertificate,
  createPuntoDeVenta,
  togglePuntoDeVenta,
  type FiscalConfigData,
  type PuntoDeVentaFiscal
} from '../../services/FiscalConfigService';
import { CheckCircle, XCircle, AlertTriangle, ShieldCheck, Plus, ToggleLeft, ToggleRight, Upload, Activity, RefreshCw, Star } from 'lucide-react';
import {
  getFiscalHealth,
  invalidateWsaaAuth,
  type FiscalHealthResult,
  type HealthCheckStatus
} from '../../services/FiscalHealthService';

// ---------- helpers ----------

const IVA_OPTIONS = [
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTO', label: 'Monotributo' },
  { value: 'EXENTO', label: 'Exento' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
  { value: 'OTRO', label: 'Otro' }
];

const formatCuit = (raw: string | null) => {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11) return raw;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d[10]}`;
};

const stripCuit = (v: string) => v.replace(/\D/g, '');

const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const certExpired = (iso: string | null) => {
  if (!iso) return false;
  return new Date(iso) < new Date();
};

const certNearExpiry = (iso: string | null) => {
  if (!iso) return false;
  const days30 = 30 * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() - Date.now() < days30;
};

// ---------- sub-components ----------

const SectionCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5">
    <h3 className="mb-4 text-sm font-semibold text-slate-800">{title}</h3>
    {children}
  </div>
);

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-medium text-slate-600">{label}</label>
    {children}
  </div>
);

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400';

const Toggle = ({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) => (
  <label className={`flex cursor-pointer items-start gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`mt-0.5 flex-shrink-0 w-10 h-6 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow transition-transform mx-0.5 ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
    <span>
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      {description && <span className="block text-xs text-slate-500 mt-0.5">{description}</span>}
    </span>
  </label>
);

const HEALTH_COLORS: Record<HealthCheckStatus, string> = {
  ok: 'text-emerald-600',
  degraded: 'text-amber-600',
  error: 'text-red-600',
  unknown: 'text-slate-400'
};

const HealthStatusIcon = ({ status }: { status: HealthCheckStatus }) => {
  if (status === 'ok') return <CheckCircle size={16} className="text-emerald-600" />;
  if (status === 'error') return <XCircle size={16} className="text-red-600" />;
  return <AlertTriangle size={16} className="text-amber-500" />;
};

const HealthCheckRow = ({ label, check }: { label: string; check: { status: HealthCheckStatus; detail?: string; daysUntilExpiry?: number } }) => (
  <div className="flex items-start gap-1.5">
    <HealthStatusIcon status={check.status} />
    <div>
      <span className="text-xs font-medium text-slate-700">{label}</span>
      {check.detail && <p className={`text-xs mt-0.5 ${HEALTH_COLORS[check.status]}`}>{check.detail}</p>}
      {check.daysUntilExpiry !== undefined && check.daysUntilExpiry >= 0 && !check.detail && (
        <p className="text-xs mt-0.5 text-slate-500">{check.daysUntilExpiry} días restantes</p>
      )}
    </div>
  </div>
);

// ---------- main component ----------

export default function AdminTabFiscal() {
  const { user } = useAuth();
  const slug = useMemo(() => getActiveClubSlug(user as any), [user]);

  const [config, setConfig] = useState<FiscalConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // --- datos fiscales form ---
  const [formDatos, setFormDatos] = useState({
    razonSocial: '',
    cuit: '',
    condicionIva: '',
    modoFacturacion: 'DESHABILITADA' as 'OBLIGATORIA' | 'OPCIONAL' | 'DESHABILITADA',
    ingresosBrutos: '',
    inicioActividadesAt: ''
  });
  const [savingDatos, setSavingDatos] = useState(false);

  // --- flags ---
  const [savingFlag, setSavingFlag] = useState(false);

  // --- certificado ---
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);
  const certFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  // --- puntos de venta ---
  const [newPdv, setNewPdv] = useState('');
  const [newPdvName, setNewPdvName] = useState('');
  const [addingPdv, setAddingPdv] = useState(false);
  const [togglingPdv, setTogglingPdv] = useState<string | null>(null);
  const [settingDefaultPdv, setSettingDefaultPdv] = useState<string | null>(null);

  // --- health check ---
  const [healthResult, setHealthResult] = useState<FiscalHealthResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [invalidatingAuth, setInvalidatingAuth] = useState(false);

  // ---------- load ----------

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await getFiscalConfig(slug);
      setConfig(data);
      if (data) {
        setFormDatos({
          razonSocial: data.razonSocial ?? '',
          cuit: formatCuit(data.cuit),
          condicionIva: data.condicionIva ?? '',
          modoFacturacion: (data.modoFacturacion as 'OBLIGATORIA' | 'OPCIONAL' | 'DESHABILITADA') ?? 'DESHABILITADA',
          ingresosBrutos: data.ingresosBrutos ?? '',
          inicioActividadesAt: data.inicioActividadesAt
            ? new Date(data.inicioActividadesAt).toISOString().slice(0, 10)
            : ''
        });
      }
    } catch (err) {
      setLoadError(extractErrorMessage(err, 'No se pudo cargar la configuración fiscal.'));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  // ---------- save datos fiscales ----------

  const handleSaveDatos = async () => {
    if (!slug) return;
    setSavingDatos(true);
    try {
      const updated = await updateFiscalConfig(slug, {
        razonSocial: formDatos.razonSocial || null,
        cuit: formDatos.cuit ? stripCuit(formDatos.cuit) : null,
        condicionIva: formDatos.condicionIva || null,
        modoFacturacion: formDatos.modoFacturacion,
        ingresosBrutos: formDatos.ingresosBrutos || null,
        inicioActividadesAt: formDatos.inicioActividadesAt
          ? new Date(formDatos.inicioActividadesAt).toISOString()
          : null
      });
      setConfig(updated);
      showAdminToast('Datos guardados.');
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudieron guardar los datos.'));
    } finally {
      setSavingDatos(false);
    }
  };

  // ---------- toggle flags ----------

  const handleToggleFlag = async (field: 'facturacionHabilitada' | 'usaHomologacion' | 'activo', value: boolean) => {
    if (!slug) return;
    setSavingFlag(true);
    try {
      const updated = await updateFiscalConfig(slug, { [field]: value });
      setConfig(updated);
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo actualizar.'));
    } finally {
      setSavingFlag(false);
    }
  };

  // ---------- certificado ----------

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsText(file);
    });

  const handleUploadCert = async () => {
    if (!slug || !certPem || !keyPem) {
      showAdminToast('Ingresá el certificado y la clave privada.');
      return;
    }
    setUploadingCert(true);
    try {
      const result = await uploadCertificate(slug, {
        certificadoPem: certPem.trim(),
        clavePrivadaPem: keyPem.trim(),
        clavePrivadaPassphrase: passphrase.trim() || undefined
      });
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              hasCertificate: true,
              certificadoSerial: result.certificadoSerial,
              certificadoSubject: result.certificadoSubject,
              vencimientoCertificado: result.vencimientoCertificado
            }
          : prev
      );
      setCertPem('');
      setKeyPem('');
      setPassphrase('');
      showAdminToast('Certificado guardado.');
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo guardar el certificado.'));
    } finally {
      setUploadingCert(false);
    }
  };

  // ---------- puntos de venta ----------

  const handleAddPdv = async () => {
    if (!slug || !newPdv) return;
    const num = parseInt(newPdv, 10);
    if (!num || num < 1 || num > 9999) {
      showAdminToast('Ingresá un número de punto de venta válido (1–9999).');
      return;
    }
    setAddingPdv(true);
    try {
      const item = await createPuntoDeVenta(slug, { puntoDeVenta: num, nombre: newPdvName || undefined });
      setConfig((prev) =>
        prev
          ? { ...prev, puntosDeVentaFiscales: [...prev.puntosDeVentaFiscales, item] }
          : prev
      );
      setNewPdv('');
      setNewPdvName('');
      showAdminToast('Punto de venta agregado.');
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo agregar el punto de venta.'));
    } finally {
      setAddingPdv(false);
    }
  };

  const handleCheckHealth = async () => {
    if (!slug) return;
    setCheckingHealth(true);
    try {
      const result = await getFiscalHealth(slug);
      setHealthResult(result);
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo verificar el estado de ARCA.'));
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleInvalidateAuth = async () => {
    if (!slug) return;
    setInvalidatingAuth(true);
    try {
      await invalidateWsaaAuth(slug);
      setHealthResult(null);
      showAdminToast('Cache de autenticación WSAA invalidado.');
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo invalidar la autenticación.'));
    } finally {
      setInvalidatingAuth(false);
    }
  };

  const handleTogglePdv = async (pdv: PuntoDeVentaFiscal) => {
    if (!slug) return;
    setTogglingPdv(pdv.id);
    try {
      const updated = await togglePuntoDeVenta(slug, pdv.id);
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              puntosDeVentaFiscales: prev.puntosDeVentaFiscales.map((p) =>
                p.id === updated.id ? updated : p
              )
            }
          : prev
      );
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo actualizar.'));
    } finally {
      setTogglingPdv(null);
    }
  };

  const handleSetDefaultPdv = async (pdvId: string) => {
    if (!slug) return;
    setSettingDefaultPdv(pdvId);
    try {
      const updated = await updateFiscalConfig(slug, { defaultPuntoDeVentaFiscalId: pdvId });
      setConfig((prev) => prev ? { ...prev, defaultPuntoDeVentaFiscalId: updated.defaultPuntoDeVentaFiscalId } : prev);
      showAdminToast('Punto de venta predeterminado actualizado.');
    } catch (err) {
      showAdminToast(extractErrorMessage(err, 'No se pudo establecer el predeterminado.'));
    } finally {
      setSettingDefaultPdv(null);
    }
  };

  // ---------- render ----------

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-500">
        Cargando configuración fiscal…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-red-600">{loadError}</div>
    );
  }

  const isEnabled = config?.facturacionHabilitada ?? false;
  const isTest = config?.usaHomologacion ?? true;
  const vto = config?.vencimientoCertificado ?? null;
  const certOk = config?.hasCertificate && !certExpired(vto);

  return (
    <div className="flex flex-col gap-5 max-w-2xl">

      {/* Status header */}
      <div className="flex flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {isEnabled ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {isEnabled ? 'Facturación habilitada' : 'Facturación deshabilitada'}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${isTest ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
          {isTest ? <AlertTriangle size={13} /> : <ShieldCheck size={13} />}
          {isTest ? 'Homologación (pruebas)' : 'Producción'}
        </span>
        {config?.hasCertificate && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${certOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {certOk ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
            {certOk ? `Cert. válido hasta ${formatDate(vto)}` : `Cert. vencido ${formatDate(vto)}`}
          </span>
        )}
        {!config?.hasCertificate && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-red-50 text-red-700">
            <AlertTriangle size={13} />Sin certificado
          </span>
        )}
      </div>

      {/* Flags */}
      <SectionCard title="Estado">
        <div className="flex flex-col gap-4">
          <Toggle
            checked={isEnabled}
            onChange={(v) => handleToggleFlag('facturacionHabilitada', v)}
            label="Facturación habilitada"
            description="Permite emitir comprobantes electrónicos via ARCA."
            disabled={savingFlag}
          />
          <Toggle
            checked={isTest}
            onChange={(v) => handleToggleFlag('usaHomologacion', v)}
            label="Modo homologación (pruebas)"
            description="Activo: usa el ambiente de pruebas de ARCA. Desactivar solo cuando esté todo probado."
            disabled={savingFlag}
          />
        </div>
      </SectionCard>

      {/* Datos fiscales */}
      <SectionCard title="Datos fiscales">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldRow label="Razón social">
            <input
              className={inputCls}
              value={formDatos.razonSocial}
              onChange={(e) => setFormDatos((p) => ({ ...p, razonSocial: e.target.value }))}
              placeholder="Nombre o razón social"
            />
          </FieldRow>
          <FieldRow label="CUIT">
            <input
              className={inputCls}
              value={formDatos.cuit}
              onChange={(e) => setFormDatos((p) => ({ ...p, cuit: e.target.value }))}
              placeholder="20-12345678-9"
              inputMode="numeric"
            />
          </FieldRow>
          <FieldRow label="Condición IVA">
            <select
              className={inputCls}
              value={formDatos.condicionIva}
              onChange={(e) => setFormDatos((p) => ({ ...p, condicionIva: e.target.value }))}
            >
              <option value="">— Seleccionar —</option>
              {IVA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Modo de facturación">
            <select
              className={inputCls}
              value={formDatos.modoFacturacion}
              onChange={(e) => setFormDatos((p) => ({ ...p, modoFacturacion: e.target.value as any }))}
            >
              <option value="DESHABILITADA">Deshabilitada — no se emiten comprobantes</option>
              <option value="OPCIONAL">Opcional — el operador decide por cuenta</option>
              <option value="OBLIGATORIA">Obligatoria — se emite automáticamente</option>
            </select>
          </FieldRow>
          <FieldRow label="Ingresos brutos">
            <input
              className={inputCls}
              value={formDatos.ingresosBrutos}
              onChange={(e) => setFormDatos((p) => ({ ...p, ingresosBrutos: e.target.value }))}
              placeholder="Número o 'CM' para convenio"
            />
          </FieldRow>
          <FieldRow label="Inicio de actividades">
            <input
              type="date"
              className={inputCls}
              value={formDatos.inicioActividadesAt}
              onChange={(e) => setFormDatos((p) => ({ ...p, inicioActividadesAt: e.target.value }))}
            />
          </FieldRow>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSaveDatos}
            disabled={savingDatos}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {savingDatos ? 'Guardando…' : 'Guardar datos'}
          </button>
        </div>
      </SectionCard>

      {/* Certificado AFIP */}
      <SectionCard title="Certificado AFIP">
        {config?.hasCertificate && (
          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
            {config.certificadoSerial && <div><span className="font-medium">Serial:</span> {config.certificadoSerial}</div>}
            {config.certificadoSubject && <div><span className="font-medium">CN:</span> {config.certificadoSubject}</div>}
            <div>
              <span className="font-medium">Vence:</span>{' '}
              <span className={certExpired(vto) || certNearExpiry(vto) ? 'text-red-600 font-medium' : ''}>
                {formatDate(vto)}
                {certExpired(vto) ? ' — VENCIDO' : certNearExpiry(vto) ? ' — vence pronto' : ''}
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <FieldRow label="Certificado (.pem / .crt)">
            <div className="flex gap-2">
              <textarea
                className={`${inputCls} h-20 resize-none font-mono text-xs`}
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"
              />
              <button
                type="button"
                onClick={() => certFileRef.current?.click()}
                className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                title="Cargar desde archivo"
              >
                <Upload size={16} />
              </button>
              <input
                ref={certFileRef}
                type="file"
                accept=".pem,.crt,.cer"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setCertPem(await readFile(f));
                }}
              />
            </div>
          </FieldRow>

          <FieldRow label="Clave privada (.key / .pem)">
            <div className="flex gap-2">
              <textarea
                className={`${inputCls} h-20 resize-none font-mono text-xs`}
                value={keyPem}
                onChange={(e) => setKeyPem(e.target.value)}
                placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;…&#10;-----END RSA PRIVATE KEY-----"
              />
              <button
                type="button"
                onClick={() => keyFileRef.current?.click()}
                className="flex-shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
                title="Cargar desde archivo"
              >
                <Upload size={16} />
              </button>
              <input
                ref={keyFileRef}
                type="file"
                accept=".key,.pem"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setKeyPem(await readFile(f));
                }}
              />
            </div>
          </FieldRow>

          <FieldRow label="Passphrase (si la clave está cifrada)">
            <input
              type="password"
              className={inputCls}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Dejar vacío si no tiene passphrase"
              autoComplete="new-password"
            />
          </FieldRow>

          <div className="flex justify-end">
            <button
              onClick={handleUploadCert}
              disabled={uploadingCert || !certPem || !keyPem}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {uploadingCert ? 'Guardando…' : config?.hasCertificate ? 'Reemplazar certificado' : 'Guardar certificado'}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Conexión ARCA */}
      <SectionCard title="Estado de conexión ARCA">
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={handleCheckHealth}
            disabled={checkingHealth}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Activity size={15} />
            {checkingHealth ? 'Verificando…' : 'Probar conexión WSAA'}
          </button>
          <button
            onClick={handleInvalidateAuth}
            disabled={invalidatingAuth}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={15} />
            {invalidatingAuth ? 'Invalidando…' : 'Invalidar cache auth'}
          </button>
        </div>

        {healthResult && (
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <HealthStatusIcon status={healthResult.overall} />
              <span className="text-sm font-medium text-slate-800">
                {healthResult.overall === 'ok' ? 'Conexión operativa' : healthResult.overall === 'degraded' ? 'Conexión degradada' : 'Error de conexión'}
              </span>
              {healthResult.environment && (
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${healthResult.environment === 'produccion' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                  {healthResult.environment === 'produccion' ? 'Producción' : 'Homologación'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {healthResult.checks.config && (
                <HealthCheckRow label="Configuración" check={healthResult.checks.config} />
              )}
              {healthResult.checks.certificate && (
                <HealthCheckRow label="Certificado" check={healthResult.checks.certificate} />
              )}
              {healthResult.checks.wsaa && (
                <HealthCheckRow label="Token WSAA" check={healthResult.checks.wsaa} />
              )}
            </div>
            <p className="text-xs text-slate-400">
              Verificado: {new Date(healthResult.checkedAt).toLocaleTimeString('es-AR')}
            </p>
          </div>
        )}
      </SectionCard>

      {/* Puntos de venta */}
      <SectionCard title="Puntos de venta fiscales">
        {(config?.puntosDeVentaFiscales ?? []).length > 0 ? (
          <ul className="mb-4 divide-y divide-slate-100">
            {(config?.puntosDeVentaFiscales ?? []).map((pdv) => {
              const isDefault = config?.defaultPuntoDeVentaFiscalId === pdv.id;
              return (
                <li key={pdv.id} className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="font-mono font-semibold">{String(pdv.puntoDeVenta).padStart(4, '0')}</span>
                    {pdv.nombre && <span className="text-slate-500">{pdv.nombre}</span>}
                    {isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        <Star size={10} className="fill-amber-500 text-amber-500" />
                        Predeterminado
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {!isDefault && (
                      <button
                        onClick={() => handleSetDefaultPdv(pdv.id)}
                        disabled={settingDefaultPdv === pdv.id}
                        title="Marcar como predeterminado para facturación automática"
                        className="flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40"
                      >
                        <Star size={11} />
                        {settingDefaultPdv === pdv.id ? 'Guardando…' : 'Predeterminar'}
                      </button>
                    )}
                    <button
                      onClick={() => handleTogglePdv(pdv)}
                      disabled={togglingPdv === pdv.id}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${pdv.activo ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {pdv.activo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {pdv.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-slate-500">No hay puntos de venta configurados.</p>
        )}

        <div className="flex gap-2 items-end">
          <FieldRow label="Número">
            <input
              type="number"
              min={1}
              max={9999}
              className={`${inputCls} w-24`}
              value={newPdv}
              onChange={(e) => setNewPdv(e.target.value)}
              placeholder="1"
            />
          </FieldRow>
          <FieldRow label="Nombre (opcional)">
            <input
              className={`${inputCls} w-40`}
              value={newPdvName}
              onChange={(e) => setNewPdvName(e.target.value)}
              placeholder="Ej: Sede central"
            />
          </FieldRow>
          <button
            onClick={handleAddPdv}
            disabled={addingPdv || !newPdv}
            className="mb-0.5 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus size={15} />
            {addingPdv ? 'Agregando…' : 'Agregar'}
          </button>
        </div>
      </SectionCard>

    </div>
  );
}
