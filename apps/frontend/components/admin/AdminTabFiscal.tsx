import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, FileUp, Plus, Star } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getActiveClubSlug } from '../../utils/session';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import { AdminFeedbackBanner } from './ui/AdminFeedback';
import {
  getFiscalConfig,
  updateFiscalConfig,
  uploadCertificate,
  createPuntoDeVenta,
  togglePuntoDeVenta,
  type FiscalConfigData,
  type FiscalConfigUpdateInput,
  type PuntoDeVentaFiscal,
} from '../../services/FiscalConfigService';
import { getFiscalHealth, invalidateWsaaAuth, type FiscalHealthResult, type HealthCheck } from '../../services/FiscalHealthService';

// Ajustes > Facturación: dejar el club listo para facturar con ARCA, paso a paso.

// ---------- helpers ----------

const IVA_OPTIONS = [
  { value: 'MONOTRIBUTO', label: 'Monotributo' },
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable inscripto' },
  { value: 'EXENTO', label: 'Exento' },
];

type BillingMode = 'NONE' | 'MANUAL' | 'AUTO';

const BILLING_MODES: Array<{ value: BillingMode; title: string; description: string }> = [
  { value: 'NONE', title: 'No facturo', description: 'Pique no emite facturas.' },
  { value: 'MANUAL', title: 'A mano', description: 'Tocás "Emitir factura" en la cuenta que quieras.' },
  { value: 'AUTO', title: 'Sola al cobrar', description: 'Cada cobro sale facturado a Consumidor final.' },
];

const billingModeOf = (config: FiscalConfigData | null): BillingMode => {
  if (!config?.facturacionHabilitada || !config.modoFacturacion || config.modoFacturacion === 'DESHABILITADA') return 'NONE';
  return config.modoFacturacion === 'OBLIGATORIA' ? 'AUTO' : 'MANUAL';
};

const billingModeUpdate = (mode: BillingMode): FiscalConfigUpdateInput => {
  if (mode === 'AUTO') return { facturacionHabilitada: true, modoFacturacion: 'OBLIGATORIA' };
  if (mode === 'MANUAL') return { facturacionHabilitada: true, modoFacturacion: 'OPCIONAL' };
  return { facturacionHabilitada: false, modoFacturacion: 'DESHABILITADA' };
};

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const formatCuit = (raw: string | null | undefined) => {
  const digits = onlyDigits(raw || '');
  if (digits.length !== 11) return raw || '';
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits[10]}`;
};

const formatDate = (iso: string | null) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '');
};

const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
};

const pdvNumber = (value: number) => String(value).padStart(4, '0');

// Lo que devuelve "probar conexión", dicho en simple.
const healthCheckText = (key: 'config' | 'certificate' | 'wsaa', check?: HealthCheck) => {
  if (!check || check.status === 'unknown') return { ok: false, text: 'No se pudo revisar.' };
  if (key === 'config') return check.status === 'ok' ? { ok: true, text: 'Datos del club cargados.' } : { ok: false, text: 'Faltan los datos del club.' };
  if (key === 'certificate') {
    if (check.status === 'ok') return { ok: true, text: 'Certificado vigente.' };
    if (check.status === 'error') return { ok: false, text: 'El certificado está vencido. Cargá uno nuevo.' };
    return { ok: false, text: check.detail === 'Sin certificado cargado.' ? 'Falta cargar el certificado.' : check.detail || 'Revisá el certificado.' };
  }
  return check.status === 'ok'
    ? { ok: true, text: 'ARCA aceptó el certificado.' }
    : { ok: false, text: `ARCA no respondió bien: ${check.detail || 'sin detalle'}.` };
};

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });

// ---------- estilos ----------

const inputClass =
  'h-10 w-full rounded-lg border border-p-border bg-p-surface px-3 text-[13px] text-p-text outline-none focus:border-p-text-secondary disabled:opacity-60';
const labelClass = 'block text-[12px] font-semibold text-p-text-secondary';
const primaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 text-[13px] font-semibold !text-ink-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-p-border bg-p-surface px-4 text-[13px] font-semibold text-p-text transition hover:bg-p-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

// ---------- piezas ----------

function StepCard({
  number,
  done,
  title,
  description,
  children,
  id,
}: {
  number: number;
  done: boolean;
  title: string;
  description: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-xl border border-p-border bg-p-surface">
      <div className="flex items-start gap-3 border-b border-p-border px-4 py-3 sm:px-5">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
            done ? 'bg-p-positive-bg text-p-positive' : 'bg-p-surface-2 text-p-text-secondary'
          }`}
        >
          {done ? <Check size={14} strokeWidth={3} /> : number}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-p-text">{title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-p-text-muted">{description}</p>
        </div>
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function FilePicker({
  label,
  accept,
  fileName,
  onPick,
  disabled,
}: {
  label: string;
  accept: string;
  fileName: string;
  onPick: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button type="button" className={secondaryButtonClass} disabled={disabled} onClick={() => inputRef.current?.click()}>
        <FileUp size={15} />
        {label}
      </button>
      <span className={`min-w-0 truncate text-[12px] ${fileName ? 'text-p-text' : 'text-p-text-muted'}`}>
        {fileName || 'Ningún archivo elegido'}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

// ---------- componente ----------

export default function AdminTabFiscal() {
  const { user } = useAuth();
  const slug = useMemo(() => getActiveClubSlug(user as any), [user]);

  const [config, setConfig] = useState<FiscalConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Paso 1: datos
  const [fiscalForm, setFiscalForm] = useState({ razonSocial: '', cuit: '', condicionIva: '', ingresosBrutos: '', inicioActividadesAt: '' });
  const [fiscalFormError, setFiscalFormError] = useState('');
  const [savingFiscalForm, setSavingFiscalForm] = useState(false);

  // Paso 2: certificado
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [certFileName, setCertFileName] = useState('');
  const [keyFileName, setKeyFileName] = useState('');
  const [keyPassword, setKeyPassword] = useState('');
  const [certPasteOpen, setCertPasteOpen] = useState(false);
  const [certReplaceOpen, setCertReplaceOpen] = useState(false);
  const [certError, setCertError] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);

  // Paso 3: punto de venta
  const [newPdvNumber, setNewPdvNumber] = useState('');
  const [newPdvName, setNewPdvName] = useState('');
  const [pdvError, setPdvError] = useState('');
  const [addingPdv, setAddingPdv] = useState(false);
  const [busyPdvId, setBusyPdvId] = useState<string | null>(null);

  // Paso 4: probar
  const [health, setHealth] = useState<FiscalHealthResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [resettingAuth, setResettingAuth] = useState(false);

  // Cuándo facturar / pruebas o real
  const [savingMode, setSavingMode] = useState(false);
  const [confirmRealOpen, setConfirmRealOpen] = useState(false);

  const applyConfig = useCallback((data: FiscalConfigData | null) => {
    setConfig(data);
    setFiscalForm({
      razonSocial: data?.razonSocial ?? '',
      cuit: formatCuit(data?.cuit),
      condicionIva: data?.condicionIva ?? '',
      ingresosBrutos: data?.ingresosBrutos ?? '',
      inicioActividadesAt: data?.inicioActividadesAt ? new Date(data.inicioActividadesAt).toISOString().slice(0, 10) : '',
    });
  }, []);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setLoadError('');
    try {
      applyConfig(await getFiscalConfig(slug));
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'load' }, err);
      setLoadError(extractErrorMessage(err, 'No se pudo cargar la facturación del club.'));
    } finally {
      setLoading(false);
    }
  }, [slug, applyConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------- estado de los pasos ----------

  const activePdvs = (config?.puntosDeVentaFiscales ?? []).filter((pdv) => pdv.activo);
  const defaultPdv = activePdvs.find((pdv) => pdv.id === config?.defaultPuntoDeVentaFiscalId) ?? null;
  const certDays = daysUntil(config?.vencimientoCertificado ?? null);
  const certExpired = Boolean(config?.hasCertificate && certDays !== null && certDays < 0);

  const dataDone = Boolean(config?.razonSocial && config?.cuit && config?.condicionIva);
  const certDone = Boolean(config?.hasCertificate && !certExpired);
  const pdvDone = Boolean(defaultPdv);
  const testDone = health?.overall === 'ok';
  const readyToBill = dataDone && certDone && pdvDone;
  const mode = billingModeOf(config);
  const isTest = config?.usaHomologacion ?? true;

  const missing = [
    !dataDone && 'los datos del club',
    !certDone && (certExpired ? 'un certificado nuevo' : 'el certificado'),
    !pdvDone && 'el punto de venta',
  ].filter(Boolean) as string[];

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // ---------- acciones ----------

  const saveConfig = async (patch: FiscalConfigUpdateInput) => {
    if (!slug) throw new Error('Sin club activo.');
    const updated = await updateFiscalConfig(slug, patch);
    setConfig(updated);
    return updated;
  };

  const handleSaveFiscalForm = async () => {
    if (savingFiscalForm) return;
    const cuitDigits = onlyDigits(fiscalForm.cuit);
    if (!fiscalForm.razonSocial.trim()) return setFiscalFormError('Falta la razón social (como figura en ARCA).');
    if (cuitDigits.length !== 11) return setFiscalFormError('El CUIT tiene que tener 11 números.');
    if (!fiscalForm.condicionIva) return setFiscalFormError('Elegí si el club es monotributista, responsable inscripto o exento.');
    try {
      setSavingFiscalForm(true);
      setFiscalFormError('');
      const updated = await saveConfig({
        razonSocial: fiscalForm.razonSocial.trim(),
        cuit: cuitDigits,
        condicionIva: fiscalForm.condicionIva,
        ingresosBrutos: fiscalForm.ingresosBrutos.trim() || null,
        inicioActividadesAt: fiscalForm.inicioActividadesAt ? new Date(fiscalForm.inicioActividadesAt).toISOString() : null,
      });
      applyConfig(updated);
      showAdminToast('Datos del club guardados.');
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'saveFiscalForm' }, err);
      setFiscalFormError(extractErrorMessage(err, 'No se pudieron guardar los datos.'));
    } finally {
      setSavingFiscalForm(false);
    }
  };

  const pickFile = async (file: File, target: 'cert' | 'key') => {
    try {
      const text = await readFileText(file);
      if (target === 'cert') {
        setCertPem(text);
        setCertFileName(file.name);
      } else {
        setKeyPem(text);
        setKeyFileName(file.name);
      }
      setCertError('');
    } catch (err) {
      setCertError(extractErrorMessage(err, 'No se pudo leer el archivo.'));
    }
  };

  const handleUploadCert = async () => {
    if (!slug || uploadingCert) return;
    if (!certPem.includes('BEGIN CERTIFICATE')) return setCertError('El certificado no parece válido: tiene que ser el archivo .crt que te dio ARCA.');
    if (!keyPem.includes('PRIVATE KEY')) return setCertError('La clave no parece válida: tiene que ser el archivo .key que generaste para pedir el certificado.');
    try {
      setUploadingCert(true);
      setCertError('');
      const result = await uploadCertificate(slug, {
        certificadoPem: certPem.trim(),
        clavePrivadaPem: keyPem.trim(),
        clavePrivadaPassphrase: keyPassword.trim() || undefined,
      });
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              hasCertificate: true,
              certificadoSerial: result.certificadoSerial,
              certificadoSubject: result.certificadoSubject,
              vencimientoCertificado: result.vencimientoCertificado,
            }
          : prev
      );
      setCertPem('');
      setKeyPem('');
      setCertFileName('');
      setKeyFileName('');
      setKeyPassword('');
      setCertPasteOpen(false);
      setCertReplaceOpen(false);
      setHealth(null);
      showAdminToast('Certificado guardado.');
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'uploadCertificate' }, err);
      setCertError(extractErrorMessage(err, 'No se pudo guardar el certificado.'));
    } finally {
      setUploadingCert(false);
    }
  };

  const handleAddPdv = async () => {
    if (!slug || addingPdv) return;
    const number = Number(newPdvNumber);
    if (!Number.isInteger(number) || number < 1 || number > 9999) return setPdvError('El número tiene que ser entre 1 y 9999.');
    try {
      setAddingPdv(true);
      setPdvError('');
      const item = await createPuntoDeVenta(slug, { puntoDeVenta: number, nombre: newPdvName.trim() || undefined });
      setConfig((prev) => (prev ? { ...prev, puntosDeVentaFiscales: [...prev.puntosDeVentaFiscales, item] } : prev));
      setNewPdvNumber('');
      setNewPdvName('');
      showAdminToast(`Punto de venta ${pdvNumber(number)} agregado.`);
      // El primero queda como principal: sin principal no se puede facturar.
      if (!defaultPdv) await saveConfig({ defaultPuntoDeVentaFiscalId: item.id });
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'addPdv' }, err);
      setPdvError(extractErrorMessage(err, 'No se pudo agregar el punto de venta.'));
    } finally {
      setAddingPdv(false);
    }
  };

  const handleSetDefaultPdv = async (pdv: PuntoDeVentaFiscal) => {
    if (busyPdvId) return;
    try {
      setBusyPdvId(pdv.id);
      setPdvError('');
      await saveConfig({ defaultPuntoDeVentaFiscalId: pdv.id });
      showAdminToast(`Se factura con el ${pdvNumber(pdv.puntoDeVenta)}.`);
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'setDefaultPdv' }, err);
      setPdvError(extractErrorMessage(err, 'No se pudo cambiar el punto de venta.'));
    } finally {
      setBusyPdvId(null);
    }
  };

  const handleTogglePdv = async (pdv: PuntoDeVentaFiscal) => {
    if (!slug || busyPdvId) return;
    try {
      setBusyPdvId(pdv.id);
      setPdvError('');
      const updated = await togglePuntoDeVenta(slug, pdv.id);
      setConfig((prev) =>
        prev ? { ...prev, puntosDeVentaFiscales: prev.puntosDeVentaFiscales.map((item) => (item.id === updated.id ? updated : item)) } : prev
      );
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'togglePdv' }, err);
      setPdvError(extractErrorMessage(err, 'No se pudo cambiar el punto de venta.'));
    } finally {
      setBusyPdvId(null);
    }
  };

  const handleCheckHealth = async () => {
    if (!slug || checkingHealth) return;
    try {
      setCheckingHealth(true);
      setHealth(await getFiscalHealth(slug));
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'checkHealth' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo probar la conexión con ARCA.'));
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleResetAuth = async () => {
    if (!slug || resettingAuth) return;
    try {
      setResettingAuth(true);
      await invalidateWsaaAuth(slug);
      setHealth(null);
      showAdminToast('Listo. La próxima factura vuelve a pedir permiso a ARCA.');
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'resetAuth' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo pedir permiso de nuevo.'));
    } finally {
      setResettingAuth(false);
    }
  };

  const handleChangeMode = async (next: BillingMode) => {
    if (next === mode || savingMode) return;
    try {
      setSavingMode(true);
      await saveConfig(billingModeUpdate(next));
      showAdminToast(next === 'NONE' ? 'Facturación apagada.' : next === 'AUTO' ? 'Ahora cada cobro sale facturado.' : 'Listo: facturás a mano desde la cuenta.');
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'changeMode' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo cambiar cuándo facturás.'));
    } finally {
      setSavingMode(false);
    }
  };

  const handleChangeEnvironment = async (test: boolean) => {
    if (test === isTest || savingMode) return;
    try {
      setSavingMode(true);
      setConfirmRealOpen(false);
      await saveConfig({ usaHomologacion: test });
      setHealth(null);
      showAdminToast(test ? 'Volviste a modo prueba.' : 'Listo: las facturas ahora son reales.');
    } catch (err) {
      reportUiError({ area: 'AdminTabFiscal', action: 'changeEnvironment' }, err);
      showAdminToast(extractErrorMessage(err, 'No se pudo cambiar el modo.'));
    } finally {
      setSavingMode(false);
    }
  };

  // ---------- render ----------

  if (loading) {
    return <div className="flex h-40 items-center justify-center text-[13px] text-p-text-muted">Cargando facturación…</div>;
  }

  if (loadError) {
    return (
      <AdminFeedbackBanner tone="error">
        {loadError}{' '}
        <button type="button" className="font-semibold underline" onClick={() => void load()}>
          Reintentar
        </button>
      </AdminFeedbackBanner>
    );
  }

  const hasConfig = Boolean(config);
  const certFormVisible = !config?.hasCertificate || certReplaceOpen || certExpired;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {/* ── Resumen y cuándo facturar ── */}
      <section className="overflow-hidden rounded-xl border border-p-border bg-p-surface">
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[15px] font-semibold text-p-text">Facturación electrónica con ARCA</p>
          {readyToBill ? (
            <p className="mt-1 text-[13px] text-p-text-secondary">
              {mode === 'NONE'
                ? 'El club está listo. Elegí cuándo querés facturar.'
                : isTest
                ? 'Facturando en modo prueba: las facturas no tienen validez.'
                : `Facturando con el punto de venta ${pdvNumber(defaultPdv!.puntoDeVenta)}.`}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-p-text-secondary">
              Para empezar a facturar falta cargar {missing.length > 1 ? `${missing.slice(0, -1).join(', ')} y ${missing[missing.length - 1]}` : missing[0]}.
            </p>
          )}

          {!readyToBill && (
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { id: 'fiscal-paso-datos', label: 'Datos del club', done: dataDone },
                { id: 'fiscal-paso-certificado', label: 'Certificado', done: certDone },
                { id: 'fiscal-paso-punto', label: 'Punto de venta', done: pdvDone },
              ].map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => scrollTo(step.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition ${
                    step.done
                      ? 'border-transparent bg-p-positive-bg text-p-positive'
                      : 'border-p-border bg-p-surface text-p-text hover:bg-p-surface-2'
                  }`}
                >
                  {step.done ? <Check size={13} strokeWidth={3} /> : <span className="text-p-text-muted">{index + 1}.</span>}
                  {step.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-p-border px-4 py-4 sm:px-5">
          <p className="text-[13px] font-semibold text-p-text">¿Cuándo facturás?</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {BILLING_MODES.map((option) => {
              const selected = mode === option.value;
              const locked = option.value !== 'NONE' && !readyToBill;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  disabled={savingMode || locked}
                  onClick={() => void handleChangeMode(option.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${
                    selected ? 'border-ink-900 bg-p-surface-2 ring-1 ring-ink-900' : 'border-p-border bg-p-surface hover:bg-p-surface-2'
                  } ${locked ? 'opacity-50' : ''}`}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-p-text">
                    {selected && <Check size={14} strokeWidth={3} />}
                    {option.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-p-text-muted">{option.description}</span>
                </button>
              );
            })}
          </div>
          {!readyToBill && <p className="mt-2 text-[12px] text-p-text-muted">Se habilita cuando completes los pasos de abajo.</p>}
        </div>

        {hasConfig && (
          <div className="border-t border-p-border px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-p-text">{isTest ? 'Modo prueba' : 'Facturas reales'}</p>
                <p className="mt-0.5 text-[12px] text-p-text-muted">
                  {isTest
                    ? 'Las facturas van al entorno de prueba de ARCA y no tienen validez. Usalo para ver que todo ande.'
                    : 'Las facturas tienen validez fiscal. Una factura emitida no se borra: se anula con una nota de crédito.'}
                </p>
              </div>
              {isTest ? (
                <button type="button" className={secondaryButtonClass} disabled={savingMode || !readyToBill} onClick={() => setConfirmRealOpen(true)}>
                  Pasar a facturas reales
                </button>
              ) : (
                <button type="button" className={secondaryButtonClass} disabled={savingMode} onClick={() => void handleChangeEnvironment(true)}>
                  Volver a modo prueba
                </button>
              )}
            </div>
            {confirmRealOpen && isTest && (
              <div className="mt-3 rounded-xl border border-p-warning bg-p-warning-bg px-3 py-3">
                <p className="text-[13px] font-semibold text-p-warning">¿Pasar a facturas reales?</p>
                <p className="mt-1 text-[12px] text-p-warning">
                  Desde ahora cada factura que emitas va a ARCA de verdad. Hacelo cuando ya hayas probado y el certificado sea el de producción (no el de prueba).
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={primaryButtonClass} disabled={savingMode} onClick={() => void handleChangeEnvironment(false)}>
                    Sí, facturas reales
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={() => setConfirmRealOpen(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Paso 1: datos ── */}
      <StepCard
        id="fiscal-paso-datos"
        number={1}
        done={dataDone}
        title="Datos del club ante ARCA"
        description="Como figuran en tu constancia de inscripción. Salen impresos en cada factura."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={labelClass}>Razón social</span>
            <input
              className={`${inputClass} mt-1`}
              value={fiscalForm.razonSocial}
              onChange={(event) => setFiscalForm((prev) => ({ ...prev, razonSocial: event.target.value }))}
              placeholder="Ej: Las Tejas SRL"
            />
          </label>
          <label>
            <span className={labelClass}>CUIT</span>
            <input
              className={`${inputClass} mt-1`}
              value={fiscalForm.cuit}
              onChange={(event) => setFiscalForm((prev) => ({ ...prev, cuit: event.target.value }))}
              onBlur={() => setFiscalForm((prev) => ({ ...prev, cuit: formatCuit(prev.cuit) }))}
              placeholder="30-12345678-9"
              inputMode="numeric"
            />
          </label>
          <label>
            <span className={labelClass}>Ante el IVA el club es</span>
            <select
              className={`${inputClass} mt-1`}
              value={fiscalForm.condicionIva}
              onChange={(event) => setFiscalForm((prev) => ({ ...prev, condicionIva: event.target.value }))}
            >
              <option value="">Elegí una opción</option>
              {IVA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>
              Ingresos brutos <span className="font-normal text-p-text-muted">(opcional)</span>
            </span>
            <input
              className={`${inputClass} mt-1`}
              value={fiscalForm.ingresosBrutos}
              onChange={(event) => setFiscalForm((prev) => ({ ...prev, ingresosBrutos: event.target.value }))}
              placeholder="Número de inscripción"
            />
          </label>
          <label>
            <span className={labelClass}>
              Inicio de actividades <span className="font-normal text-p-text-muted">(opcional)</span>
            </span>
            <input
              type="date"
              className={`${inputClass} mt-1`}
              value={fiscalForm.inicioActividadesAt}
              onChange={(event) => setFiscalForm((prev) => ({ ...prev, inicioActividadesAt: event.target.value }))}
            />
          </label>
        </div>
        {fiscalForm.condicionIva && (
          <p className="mt-3 text-[12px] text-p-text-muted">
            {fiscalForm.condicionIva === 'RESPONSABLE_INSCRIPTO'
              ? 'Vas a emitir Factura A a quien tenga CUIT inscripto y Factura B al resto.'
              : 'Vas a emitir Factura C.'}
          </p>
        )}
        {fiscalFormError && (
          <AdminFeedbackBanner tone="error" className="mt-3">
            {fiscalFormError}
          </AdminFeedbackBanner>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className={primaryButtonClass} disabled={savingFiscalForm} onClick={() => void handleSaveFiscalForm()}>
            {savingFiscalForm ? 'Guardando…' : 'Guardar datos'}
          </button>
        </div>
      </StepCard>

      {/* ── Paso 2: certificado ── */}
      <StepCard
        id="fiscal-paso-certificado"
        number={2}
        done={certDone}
        title="Certificado de ARCA"
        description="Es el permiso para que Pique facture en nombre del club. Lo sacás en la web de ARCA (Administración de certificados digitales). Si no sabés cómo, pedíselo a tu contador."
      >
        {!hasConfig ? (
          <p className="text-[13px] text-p-text-muted">Primero guardá los datos del club (paso 1).</p>
        ) : (
          <>
            {config?.hasCertificate && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold ${certExpired ? 'text-[var(--error-fg)]' : 'text-p-text'}`}>
                    {certExpired ? `Venció el ${formatDate(config.vencimientoCertificado)}` : `Cargado · vence el ${formatDate(config.vencimientoCertificado)}`}
                  </p>
                  {!certExpired && certDays !== null && certDays < 30 && (
                    <p className="mt-0.5 text-[12px] font-semibold text-p-warning">Vence en {certDays} días: sacá uno nuevo en ARCA y cargalo acá.</p>
                  )}
                  {config.certificadoSubject && <p className="mt-0.5 truncate text-[12px] text-p-text-muted">{config.certificadoSubject}</p>}
                </div>
                {!certExpired && !certReplaceOpen && (
                  <button type="button" className={secondaryButtonClass} onClick={() => setCertReplaceOpen(true)}>
                    Cambiar certificado
                  </button>
                )}
              </div>
            )}

            {certFormVisible && (
              <div className={`flex flex-col gap-3 ${config?.hasCertificate ? 'mt-4 border-t border-p-border pt-4' : ''}`}>
                <div>
                  <p className={labelClass}>Certificado (archivo .crt que te da ARCA)</p>
                  <div className="mt-1">
                    <FilePicker label="Elegir certificado" accept=".crt,.pem,.cer" fileName={certFileName} onPick={(file) => void pickFile(file, 'cert')} />
                  </div>
                </div>
                <div>
                  <p className={labelClass}>Clave (archivo .key que generaste al pedirlo)</p>
                  <div className="mt-1">
                    <FilePicker label="Elegir clave" accept=".key,.pem" fileName={keyFileName} onPick={(file) => void pickFile(file, 'key')} />
                  </div>
                </div>

                <button
                  type="button"
                  className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-p-text-secondary hover:underline"
                  onClick={() => setCertPasteOpen((open) => !open)}
                >
                  <ChevronDown size={14} className={`transition ${certPasteOpen ? 'rotate-180' : ''}`} />
                  Los tengo como texto
                </button>
                {certPasteOpen && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className={labelClass}>Certificado</span>
                      <textarea
                        className={`${inputClass} mt-1 h-24 resize-none py-2 font-mono text-[11px]`}
                        value={certPem}
                        onChange={(event) => {
                          setCertPem(event.target.value);
                          setCertFileName('');
                        }}
                        placeholder="-----BEGIN CERTIFICATE-----"
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Clave</span>
                      <textarea
                        className={`${inputClass} mt-1 h-24 resize-none py-2 font-mono text-[11px]`}
                        value={keyPem}
                        onChange={(event) => {
                          setKeyPem(event.target.value);
                          setKeyFileName('');
                        }}
                        placeholder="-----BEGIN PRIVATE KEY-----"
                      />
                    </label>
                  </div>
                )}

                <label className="sm:max-w-xs">
                  <span className={labelClass}>
                    Contraseña de la clave <span className="font-normal text-p-text-muted">(solo si le pusiste una)</span>
                  </span>
                  <input
                    type="password"
                    className={`${inputClass} mt-1`}
                    value={keyPassword}
                    onChange={(event) => setKeyPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>

                {certError && <AdminFeedbackBanner tone="error">{certError}</AdminFeedbackBanner>}

                <div className="flex flex-wrap justify-end gap-2">
                  {certReplaceOpen && (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => {
                        setCertReplaceOpen(false);
                        setCertError('');
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                  <button type="button" className={primaryButtonClass} disabled={uploadingCert || !certPem || !keyPem} onClick={() => void handleUploadCert()}>
                    {uploadingCert ? 'Guardando…' : 'Guardar certificado'}
                  </button>
                </div>
                <p className="text-[11px] text-p-text-muted">Una vez guardada, la clave no se vuelve a mostrar.</p>
              </div>
            )}
          </>
        )}
      </StepCard>

      {/* ── Paso 3: punto de venta ── */}
      <StepCard
        id="fiscal-paso-punto"
        number={3}
        done={pdvDone}
        title="Punto de venta"
        description='El número de punto de venta que diste de alta en ARCA para "Factura electrónica - Web services". No sirve uno de controlador fiscal ni de factura en línea.'
      >
        {!hasConfig ? (
          <p className="text-[13px] text-p-text-muted">Primero guardá los datos del club (paso 1).</p>
        ) : (
          <>
            {(config?.puntosDeVentaFiscales ?? []).length > 0 && (
              <ul className="mb-4 divide-y divide-p-border rounded-xl border border-p-border">
                {(config?.puntosDeVentaFiscales ?? []).map((pdv) => {
                  const isDefault = config?.defaultPuntoDeVentaFiscalId === pdv.id;
                  const busy = busyPdvId === pdv.id;
                  return (
                    <li key={pdv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className={`text-[13px] font-semibold ${pdv.activo ? 'text-p-text' : 'text-p-text-muted line-through'}`}>
                          {pdvNumber(pdv.puntoDeVenta)}
                          {pdv.nombre ? <span className="font-normal text-p-text-muted"> · {pdv.nombre}</span> : null}
                        </p>
                        {isDefault && pdv.activo && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-p-positive">
                            <Star size={12} className="fill-current" />
                            Se factura con este
                          </p>
                        )}
                        {!pdv.activo && <p className="mt-0.5 text-[12px] text-p-text-muted">Pausado</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        {!isDefault && pdv.activo && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleSetDefaultPdv(pdv)}
                            className="text-[12px] font-semibold text-p-text hover:underline disabled:opacity-50"
                          >
                            Facturar con este
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleTogglePdv(pdv)}
                          className="text-[12px] font-semibold text-p-text-muted hover:underline disabled:opacity-50"
                        >
                          {pdv.activo ? 'Pausar' : 'Reactivar'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {(config?.puntosDeVentaFiscales ?? []).length > 0 && !pdvDone && (
              <AdminFeedbackBanner tone="warning" className="mb-3">
                Elegí con qué punto de venta se factura.
              </AdminFeedbackBanner>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className={labelClass}>Número</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={9999}
                  className={`${inputClass} mt-1 w-24`}
                  value={newPdvNumber}
                  onChange={(event) => setNewPdvNumber(event.target.value)}
                  placeholder="Ej: 3"
                />
              </label>
              <label className="min-w-0 flex-1 sm:flex-none">
                <span className={labelClass}>
                  Nombre <span className="font-normal text-p-text-muted">(opcional)</span>
                </span>
                <input
                  className={`${inputClass} mt-1 sm:w-48`}
                  value={newPdvName}
                  onChange={(event) => setNewPdvName(event.target.value)}
                  placeholder="Ej: Club"
                />
              </label>
              <button type="button" className={secondaryButtonClass} disabled={addingPdv || !newPdvNumber} onClick={() => void handleAddPdv()}>
                <Plus size={15} />
                {addingPdv ? 'Agregando…' : 'Agregar'}
              </button>
            </div>
            {pdvError && (
              <AdminFeedbackBanner tone="error" className="mt-3">
                {pdvError}
              </AdminFeedbackBanner>
            )}
          </>
        )}
      </StepCard>

      {/* ── Paso 4: probar ── */}
      <StepCard
        id="fiscal-paso-probar"
        number={4}
        done={testDone}
        title="Probar la conexión"
        description="Pique le pide permiso a ARCA con tu certificado. No emite ninguna factura."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primaryButtonClass} disabled={checkingHealth || !hasConfig} onClick={() => void handleCheckHealth()}>
            {checkingHealth ? 'Probando…' : 'Probar conexión'}
          </button>
          {health && (
            <span className={`text-[13px] font-semibold ${health.overall === 'ok' ? 'text-p-positive' : 'text-p-warning'}`}>
              {health.overall === 'ok' ? 'Todo bien: ya podés facturar.' : 'Hay algo para revisar.'}
            </span>
          )}
        </div>
        {health && (
          <ul className="mt-3 space-y-1.5">
            {(['config', 'certificate', 'wsaa'] as const).map((key) => {
              const result = healthCheckText(key, health.checks[key]);
              return (
                <li key={key} className="flex items-start gap-2 text-[13px]">
                  <span className={`mt-0.5 shrink-0 ${result.ok ? 'text-p-positive' : 'text-p-warning'}`}>{result.ok ? <Check size={14} strokeWidth={3} /> : '•'}</span>
                  <span className={result.ok ? 'text-p-text' : 'text-p-text-secondary'}>{result.text}</span>
                </li>
              );
            })}
          </ul>
        )}
        {hasConfig && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[12px] font-semibold text-p-text-muted">¿Cambiaste el certificado y ARCA lo sigue rechazando?</summary>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-[12px] text-p-text-muted">Pique guarda el permiso de ARCA unas horas. Podés descartarlo para que lo pida de nuevo.</p>
              <button type="button" className={secondaryButtonClass} disabled={resettingAuth} onClick={() => void handleResetAuth()}>
                {resettingAuth ? 'Pidiendo…' : 'Pedir permiso de nuevo'}
              </button>
            </div>
          </details>
        )}
      </StepCard>
    </div>
  );
}
