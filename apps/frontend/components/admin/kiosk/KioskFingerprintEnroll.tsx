import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, X } from 'lucide-react';
import { ActivityTurnService, type FingerprintOwner } from '../../../services/ActivityTurnService';
import { callAgent, type EnrollState } from '../../../services/TurnstileAgent';
import { extractErrorMessage, reportUiError } from '../../../utils/uiError';

type Props = {
  slug: string;
  agentUrl: string;
  onClose: () => void;
  /** Se registró o borró una huella: hay que volver a pasarle las huellas al agente. */
  onChanged: () => void;
};

const FINGERS = [
  'Pulgar derecho',
  'Índice derecho',
  'Mayor derecho',
  'Anular derecho',
  'Meñique derecho',
  'Pulgar izquierdo',
  'Índice izquierdo',
  'Mayor izquierdo',
  'Anular izquierdo',
  'Meñique izquierdo',
];

const CSS = `
  .kf-back { position:absolute; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.6); }
  .kf-card { width:min(520px,100%); max-height:100%; overflow:auto; padding:24px; border-radius:20px; background:#151c18; border:1px solid #26302b; display:flex; flex-direction:column; gap:14px; text-align:left; }
  .kf-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .kf-head h2 { margin:0; font-size:22px; font-weight:800; }
  .kf-close { width:36px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:10px; border:1px solid #26302b; background:transparent; color:#9fb0a6; cursor:pointer; }
  .kf-row { display:flex; gap:8px; }
  .kf-input, .kf-select { flex:1; height:44px; border-radius:12px; border:1px solid #2c3a33; background:#0b0f0d; color:#fff; padding:0 12px; font-family:inherit; font-size:16px; }
  .kf-btn { height:44px; padding:0 18px; border-radius:12px; border:1px solid #2c3a33; background:#1d2621; color:#f2f5f3; font-family:inherit; font-size:15px; font-weight:700; cursor:pointer; }
  .kf-btn.is-main { background:#3ddc84; border-color:#3ddc84; color:#06240f; }
  .kf-btn:disabled { opacity:.5; cursor:default; }
  .kf-link { border:0; background:none; padding:0; color:#ff8a80; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer; }
  .kf-person { padding:12px 14px; border-radius:12px; border:1px solid #26302b; background:#0f1512; display:flex; flex-direction:column; gap:6px; cursor:pointer; color:inherit; font-family:inherit; text-align:left; }
  .kf-person.is-on { border-color:#3ddc84; }
  .kf-person strong { font-size:16px; }
  .kf-muted { margin:0; color:#9fb0a6; font-size:14px; line-height:1.45; }
  .kf-fp { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; color:#c9d4ce; }
  .kf-consent { display:flex; gap:10px; align-items:flex-start; font-size:14px; line-height:1.45; color:#c9d4ce; }
  .kf-consent input { margin-top:3px; width:18px; height:18px; }
  .kf-error { margin:0; color:#ff8a80; font-size:14px; font-weight:600; }
  .kf-ok { margin:0; color:#3ddc84; font-size:16px; font-weight:700; }
  .kf-read { display:flex; flex-direction:column; align-items:center; gap:14px; padding:12px 0; text-align:center; }
  .kf-read p { margin:0; font-size:20px; font-weight:700; }
  .kf-steps { display:flex; gap:8px; }
  .kf-step { width:44px; height:8px; border-radius:4px; background:#26302b; }
  .kf-step.is-done { background:#3ddc84; }
`;

/** Alta de huella en la PC del kiosco: buscar por DNI, consentimiento y 3 lecturas del mismo dedo. */
export default function KioskFingerprintEnroll({ slug, agentUrl, onClose, onChanged }: Props) {
  const [dni, setDni] = useState('');
  const [owners, setOwners] = useState<FingerprintOwner[] | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [finger, setFinger] = useState(1);
  const [consent, setConsent] = useState(false);
  const [reading, setReading] = useState<EnrollState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const savingRef = useRef(false);

  const owner = owners?.find((row) => row.id === ownerId) || null;

  const search = async () => {
    try {
      setBusy(true);
      setError('');
      setSaved(null);
      const rows = await ActivityTurnService.fingerprintLookup(slug, dni);
      setOwners(rows);
      setOwnerId(rows.length === 1 ? rows[0].id : null);
      if (rows.length === 0) setError('No hay ningún cliente con ese DNI. Primero hay que cargarlo en Clientes.');
    } catch (err) {
      reportUiError({ area: 'KioskFingerprintEnroll', action: 'lookup' }, err);
      setError(extractErrorMessage(err, 'No se pudo buscar el cliente.'));
    } finally {
      setBusy(false);
    }
  };

  const refreshOwner = useCallback(async () => {
    const rows = await ActivityTurnService.fingerprintLookup(slug, dni);
    setOwners(rows);
  }, [slug, dni]);

  const start = async () => {
    try {
      setBusy(true);
      setError('');
      setSaved(null);
      savingRef.current = false;
      setReading(await callAgent<EnrollState>(agentUrl, '/fingerprint/enroll', 'POST'));
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudo usar el lector.'));
    } finally {
      setBusy(false);
    }
  };

  const cancelReading = useCallback(() => {
    void callAgent(agentUrl, '/fingerprint/enroll', 'DELETE').catch(() => undefined);
    setReading(null);
  }, [agentUrl]);

  // Mientras lee: pregunta al agente cómo va; con las 3 lecturas, guarda en Pique.
  useEffect(() => {
    if (!reading?.active) return;
    const timer = window.setInterval(async () => {
      try {
        const state = await callAgent<EnrollState>(agentUrl, '/fingerprint/enroll', 'GET');
        setReading(state);
        if (state.active || !state.template || savingRef.current || !ownerId) {
          if (!state.active && !state.template) setError(state.error || 'Se cortó la lectura. Probá de nuevo.');
          return;
        }
        savingRef.current = true;
        const row = await ActivityTurnService.fingerprintEnroll(slug, {
          clientId: ownerId,
          template: state.template,
          format: state.format,
          finger,
          consent,
        });
        setSaved(`Listo, ${row.name} ya puede entrar con su huella.`);
        setReading(null);
        setConsent(false);
        onChanged();
        await refreshOwner();
      } catch (err) {
        reportUiError({ area: 'KioskFingerprintEnroll', action: 'enroll' }, err);
        setError(extractErrorMessage(err, 'No se pudo guardar la huella.'));
        setReading(null);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [reading?.active, agentUrl, slug, ownerId, finger, consent, onChanged, refreshOwner]);

  const remove = async (id: string) => {
    if (!window.confirm('¿Borrás esta huella? Va a tener que entrar con DNI o registrarla de nuevo.')) return;
    try {
      setBusy(true);
      await ActivityTurnService.fingerprintRemove(slug, id);
      onChanged();
      await refreshOwner();
    } catch (err) {
      reportUiError({ area: 'KioskFingerprintEnroll', action: 'remove' }, err);
      setError(extractErrorMessage(err, 'No se pudo borrar la huella.'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (reading?.active) cancelReading();
    onClose();
  };

  return (
    <div className="kf-back" role="dialog" aria-modal="true" aria-label="Registrar huella">
      <style>{CSS}</style>
      <div className="kf-card">
        <div className="kf-head">
          <h2>Registrar huella</h2>
          <button type="button" className="kf-close" aria-label="Cerrar" onClick={close}>
            <X size={18} />
          </button>
        </div>

        {reading?.active ? (
          <div className="kf-read" aria-live="polite">
            <Fingerprint size={64} color="#3ddc84" />
            <p>
              {reading.step === 0 ? 'Apoyá el dedo en el lector' : `Levantalo y apoyalo de nuevo (${reading.step} de ${reading.needed})`}
            </p>
            <div className="kf-steps">
              {Array.from({ length: reading.needed }, (_, i) => (
                <span key={i} className={`kf-step${i < reading.step ? ' is-done' : ''}`} />
              ))}
            </div>
            {reading.error ? <p className="kf-error">{reading.error}</p> : null}
            <button type="button" className="kf-btn" onClick={cancelReading}>
              Cancelar
            </button>
          </div>
        ) : (
          <>
            <form
              className="kf-row"
              onSubmit={(e) => {
                e.preventDefault();
                void search();
              }}
            >
              <input
                className="kf-input"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                inputMode="numeric"
                placeholder="DNI del socio"
                aria-label="DNI del socio"
                autoFocus
              />
              <button type="submit" className="kf-btn" disabled={busy || !dni.trim()}>
                Buscar
              </button>
            </form>

            {owners && owners.length > 1 ? <p className="kf-muted">Hay más de una ficha con ese DNI. Elegí cuál.</p> : null}
            {owners?.map((row) => (
              <div
                key={row.id}
                role="radio"
                aria-checked={row.id === ownerId}
                tabIndex={0}
                className={`kf-person${row.id === ownerId ? ' is-on' : ''}`}
                onClick={() => setOwnerId(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setOwnerId(row.id);
                }}
              >
                <strong>{row.name}</strong>
                {row.fingerprints.length === 0 ? (
                  <span className="kf-muted">Sin huellas registradas.</span>
                ) : (
                  row.fingerprints.map((fp) => (
                    <span key={fp.id} className="kf-fp">
                      {fp.finger !== null ? FINGERS[fp.finger] : 'Huella'} · {new Date(fp.createdAt).toLocaleDateString('es-AR')}
                      <button
                        type="button"
                        className="kf-link"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(fp.id);
                        }}
                      >
                        Borrar
                      </button>
                    </span>
                  ))
                )}
              </div>
            ))}

            {owner ? (
              <>
                <select className="kf-select" value={finger} onChange={(e) => setFinger(Number(e.target.value))} aria-label="Dedo">
                  {FINGERS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="kf-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>
                    {owner.name} acepta que el club guarde un patrón de su huella (no la imagen) solo para controlar el ingreso, y
                    puede pedir que se borre cuando quiera.
                  </span>
                </label>
                <button type="button" className="kf-btn is-main" disabled={busy || !consent} onClick={() => void start()}>
                  Empezar lectura
                </button>
              </>
            ) : null}
          </>
        )}

        {error ? <p className="kf-error">{error}</p> : null}
        {saved ? <p className="kf-ok">{saved}</p> : null}
      </div>
    </div>
  );
}
