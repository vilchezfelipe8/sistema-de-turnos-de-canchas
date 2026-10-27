import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  disablePushNotifications,
  enablePushNotifications,
  getNotificationPermission,
  getNotificationPreferences,
  getPushSupport,
  hasActivePushSubscription,
  updateNotificationPreferences,
  type NotificationPreferences,
} from '../../utils/pushNotifications';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

const CSS = `
  .np-status { display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--border-subtle); }
  .np-dot { width:8px; height:8px; border-radius:999px; flex-shrink:0; background:var(--text-muted); }
  .np-dot.is-on { background:var(--accent-fg); }
  .np-status-text { flex:1; margin:0; color:var(--text-primary); font-size:13px; font-weight:700; line-height:1.4; }
  .np-status-text span { display:block; margin-top:2px; color:var(--text-muted); font-size:12px; font-weight:600; }
  .np-link { border:0; background:none; padding:6px 0 6px 8px; color:var(--text-muted); font-family:var(--font-sans); font-size:12px; font-weight:800; cursor:pointer; }
  .np-link.is-accent { color:var(--accent-fg); }
  .np-link:disabled { opacity:.6; cursor:not-allowed; }
  .np-row { display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--border-subtle); }
  .np-row:last-child { border-bottom:0; }
  .np-row-text { flex:1; min-width:0; }
  .np-row-title { margin:0; color:var(--text-primary); font-size:14px; font-weight:750; }
  .np-row-copy { margin:2px 0 0; color:var(--text-muted); font-size:12px; font-weight:600; line-height:1.4; }
  .np-switch { width:44px; height:26px; flex-shrink:0; border-radius:999px; border:0; padding:3px; cursor:pointer; display:flex; background:var(--border-strong); transition:background .15s; }
  .np-switch.is-on { background:var(--brand); justify-content:flex-end; }
  .np-switch span { width:20px; height:20px; border-radius:999px; background:var(--surface-1); box-shadow:0 1px 2px rgba(0,0,0,.25); }
  .np-switch.is-on span { background:var(--brand-on); }
  .np-switch:disabled { opacity:.6; cursor:not-allowed; }
  .np-always { flex-shrink:0; color:var(--text-muted); font-size:11px; font-weight:800; }
  .np-error { margin:8px 0 0; color:var(--error-fg); font-size:12px; font-weight:700; }
  @keyframes np-spin { to { transform:rotate(360deg); } }
`;

type DeviceState = 'loading' | 'on' | 'off' | 'denied' | 'ios-needs-install' | 'unsupported';

const PREFERENCE_ROWS: Array<{ key: keyof NotificationPreferences; title: string; copy: string }> = [
  { key: 'invitations', title: 'Invitaciones a jugar', copy: 'Cuando alguien te suma a un partido.' },
  { key: 'invitationResponses', title: 'Respuestas a tus invitaciones', copy: 'Cuando un invitado acepta o rechaza.' },
  { key: 'bookingReminders', title: 'Recordatorio del turno', copy: '2 horas antes de jugar.' },
];

// Sección "Avisos" del perfil: estado de los avisos en este dispositivo y qué tipos recibir.
export default function NotificationPreferencesSection() {
  const [device, setDevice] = useState<DeviceState>('loading');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState('');

  const refreshDevice = useCallback(async () => {
    const support = getPushSupport();
    if (support === 'ios-needs-install') return setDevice('ios-needs-install');
    if (support !== 'supported') return setDevice('unsupported');
    if (getNotificationPermission() === 'denied') return setDevice('denied');
    setDevice((await hasActivePushSubscription()) ? 'on' : 'off');
  }, []);

  useEffect(() => {
    void refreshDevice();
    getNotificationPreferences()
      .then(setPreferences)
      .catch((loadError) => {
        reportUiError({ area: 'NotificationPreferencesSection', action: 'load' }, loadError);
        setError(extractErrorMessage(loadError, 'No pudimos cargar tus avisos.'));
      });
  }, [refreshDevice]);

  const toggleDevice = async () => {
    setDeviceBusy(true);
    setError('');
    try {
      if (device === 'on') {
        await disablePushNotifications();
      } else {
        const result = await enablePushNotifications();
        if (result === 'unavailable') setError('Los avisos no están disponibles en este momento.');
      }
      await refreshDevice();
    } catch (toggleError) {
      reportUiError({ area: 'NotificationPreferencesSection', action: 'toggleDevice' }, toggleError);
      setError(extractErrorMessage(toggleError, 'No pudimos cambiar los avisos de este dispositivo.'));
    } finally {
      setDeviceBusy(false);
    }
  };

  const togglePreference = async (key: keyof NotificationPreferences) => {
    if (!preferences) return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSavingKey(key);
    setError('');
    try {
      setPreferences(await updateNotificationPreferences({ [key]: next[key] }));
    } catch (saveError) {
      setPreferences(previous);
      reportUiError({ area: 'NotificationPreferencesSection', action: 'save' }, saveError);
      setError(extractErrorMessage(saveError, 'No pudimos guardar el cambio.'));
    } finally {
      setSavingKey(null);
    }
  };

  const deviceStatus = (() => {
    switch (device) {
      case 'on':
        return { on: true, title: 'Avisos activados en este dispositivo', sub: '', action: 'Desactivar' };
      case 'off':
        return { on: false, title: 'Avisos desactivados en este dispositivo', sub: 'Activalos para enterarte aunque no tengas Pique abierto.', action: 'Activar' };
      case 'denied':
        return { on: false, title: 'Bloqueaste los avisos en este navegador', sub: 'Podés habilitarlos desde la configuración del navegador.', action: '' };
      case 'ios-needs-install':
        return { on: false, title: 'En iPhone, agregá Pique a tu pantalla de inicio', sub: 'Compartir → Agregar a inicio, y abrilo desde el ícono para activar los avisos.', action: '' };
      case 'unsupported':
        return { on: false, title: 'Este navegador no permite avisos', sub: 'Probá desde Chrome en el celular o con Pique instalado.', action: '' };
      default:
        return { on: false, title: 'Revisando los avisos…', sub: '', action: '' };
    }
  })();

  return (
    <div className="pf-zone">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="pf-zone-title" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 16 }}>Avisos</div>
      <div className="p-public-card pf-zone-card" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <div className="np-status">
          <span className={`np-dot${deviceStatus.on ? ' is-on' : ''}`} />
          <p className="np-status-text">
            {deviceStatus.title}
            {deviceStatus.sub ? <span>{deviceStatus.sub}</span> : null}
          </p>
          {deviceStatus.action && (
            <button
              type="button"
              className={`np-link${device === 'off' ? ' is-accent' : ''}`}
              onClick={() => void toggleDevice()}
              disabled={deviceBusy}
            >
              {deviceBusy ? <Loader2 size={13} style={{ animation: 'np-spin .8s linear infinite' }} /> : deviceStatus.action}
            </button>
          )}
        </div>

        {PREFERENCE_ROWS.map((row) => {
          const on = Boolean(preferences?.[row.key]);
          return (
            <div className="np-row" key={row.key}>
              <div className="np-row-text">
                <p className="np-row-title">{row.title}</p>
                <p className="np-row-copy">{row.copy}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={row.title}
                className={`np-switch${on ? ' is-on' : ''}`}
                onClick={() => void togglePreference(row.key)}
                disabled={!preferences || savingKey === row.key}
              >
                <span />
              </button>
            </div>
          );
        })}

        <div className="np-row">
          <div className="np-row-text">
            <p className="np-row-title">Cancelaciones del club</p>
            <p className="np-row-copy">Siempre activo: es importante que te enteres.</p>
          </div>
          <span className="np-always">Siempre</span>
        </div>
        {error && <p className="np-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
