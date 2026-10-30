import { useEffect, useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import {
  dismissPushOptIn,
  enablePushNotifications,
  getNotificationPermission,
  getPushSupport,
  hasActivePushSubscription,
  isPushOptInDismissed,
  type PushSupport,
} from '../../utils/pushNotifications';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

const CSS = `
  .pn-card { display:grid; gap:12px; padding:14px; border-radius:20px; border:1px solid var(--accent-border-subtle); background:linear-gradient(135deg, var(--accent-bg-soft), var(--surface-1) 60%); margin-bottom:14px; }
  .pn-card.is-neutral { border-color:var(--border); background:var(--surface-1); }
  .pn-head { display:flex; gap:12px; align-items:flex-start; }
  .pn-icon { width:40px; height:40px; border-radius:13px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; background:var(--positive-bg); color:var(--accent-fg); }
  .pn-card.is-neutral .pn-icon { background:var(--surface-2); color:var(--text-secondary); }
  .pn-title { margin:0; color:var(--text-primary); font-size:15px; font-weight:800; }
  .pn-copy { margin:3px 0 0; color:var(--text-muted); font-size:12px; line-height:1.45; font-weight:600; }
  .pn-actions { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:8px; }
  .pn-btn { height:44px; border-radius:13px; font-family:var(--font-sans); font-size:13px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:7px; }
  .pn-btn-ghost { border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary); }
  .pn-btn-primary { border:1px solid var(--brand); background:var(--brand); color:var(--brand-on); }
  .pn-btn:disabled { opacity:.6; cursor:not-allowed; }
  .pn-steps { display:grid; gap:8px; }
  .pn-step { display:flex; gap:10px; align-items:center; color:var(--text-secondary); font-size:13px; font-weight:650; }
  .pn-step b { color:var(--text-primary); }
  .pn-step-num { width:24px; height:24px; border-radius:999px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; background:var(--surface-2); color:var(--text-primary); font-size:11px; font-weight:900; }
  .pn-error { margin:0; color:var(--error-fg); font-size:12px; font-weight:700; }
  @keyframes pn-spin { to { transform:rotate(360deg); } }
`;

type CardState = 'hidden' | 'optin' | 'ios-install';

// Cartel en Mis reservas para activar los avisos push. Solo pide el permiso del navegador cuando
// el usuario toca "Activar avisos" (si se pide de entrada y lo rechaza, no se puede volver a preguntar).
export default function PushOptInCard() {
  const [state, setState] = useState<CardState>('hidden');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (isPushOptInDismissed()) return;
      const support: PushSupport = getPushSupport();
      if (support === 'ios-needs-install') {
        if (!cancelled) setState('ios-install');
        return;
      }
      if (support !== 'supported') return;
      const permission = getNotificationPermission();
      if (permission === 'denied') return;
      if (permission === 'granted' && (await hasActivePushSubscription())) return;
      if (!cancelled) setState('optin');
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'hidden') return null;

  const dismiss = () => {
    dismissPushOptIn();
    setState('hidden');
  };

  if (state === 'ios-install') {
    return (
      <div className="pn-card is-neutral">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="pn-head">
          <span className="pn-icon"><Bell size={20} /></span>
          <div>
            <p className="pn-title">Para recibir avisos en iPhone</p>
            <p className="pn-copy">Agregá Pique a tu pantalla de inicio y abrilo desde ahí. Es un paso, una sola vez.</p>
          </div>
        </div>
        <div className="pn-steps">
          <div className="pn-step"><span className="pn-step-num">1</span><span>Tocá <b>Compartir</b> en Safari</span></div>
          <div className="pn-step"><span className="pn-step-num">2</span><span><b>Agregar a inicio</b></span></div>
          <div className="pn-step"><span className="pn-step-num">3</span><span>Abrí Pique desde el ícono y activá los avisos</span></div>
        </div>
        <button type="button" className="pn-btn pn-btn-ghost" onClick={dismiss}>Entendido</button>
      </div>
    );
  }

  const handleEnable = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await enablePushNotifications();
      if (result === 'enabled' || result === 'denied') {
        // Si lo rechazó, el navegador no deja volver a preguntar: el cartel se oculta.
        setState('hidden');
        return;
      }
      setError('Los avisos no están disponibles en este momento.');
    } catch (enableError) {
      reportUiError({ area: 'PushOptInCard', action: 'enable' }, enableError);
      setError(extractErrorMessage(enableError, 'No pudimos activar los avisos. Intentá de nuevo.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pn-card">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="pn-head">
        <span className="pn-icon"><Bell size={20} /></span>
        <div>
          <p className="pn-title">Enterate al toque cuando te inviten</p>
          <p className="pn-copy">Te avisamos en el celular cuando alguien te sume a un partido, aunque no tengas Pique abierto.</p>
        </div>
      </div>
      {error && <p className="pn-error" role="alert">{error}</p>}
      <div className="pn-actions">
        <button type="button" className="pn-btn pn-btn-ghost" onClick={dismiss} disabled={busy}>Ahora no</button>
        <button type="button" className="pn-btn pn-btn-primary" onClick={() => void handleEnable()} disabled={busy}>
          {busy ? <Loader2 size={15} style={{ animation: 'pn-spin .8s linear infinite' }} /> : null}
          {busy ? 'Activando...' : 'Activar avisos'}
        </button>
      </div>
    </div>
  );
}
