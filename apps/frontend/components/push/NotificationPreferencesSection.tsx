import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CalendarX, Clock3, Loader2, MessageCircle, UserPlus, type LucideIcon } from 'lucide-react';
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
  .np-heading { display:flex; align-items:center; gap:9px; margin:0 0 6px; color:var(--text-primary); }
  .np-heading h2 { margin:0; font-size:15px; font-weight:800; }
  .np-intro { margin:0 0 16px; color:var(--text-secondary); font-size:13px; line-height:1.45; }
  .np-status { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .np-status.is-on { border-color:var(--accent-border-subtle); background:var(--accent-bg-soft); }
  .np-status-icon, .np-row-icon { flex:none; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-1); color:var(--text-secondary); }
  .np-status-icon { width:38px; height:38px; }
  .np-status-copy { flex:1; min-width:150px; }
  .np-status-title { margin:0; color:var(--text-primary); font-size:14px; font-weight:800; line-height:1.35; }
  .np-status-sub { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; }
  .np-action { min-height:42px; margin-left:auto; padding:9px 14px; display:inline-flex; align-items:center; justify-content:center; gap:7px; border:1px solid transparent; border-radius:12px; background:var(--brand); color:var(--brand-on); font-family:var(--font-sans); font-size:12px; font-weight:800; cursor:pointer; }
  .np-action.is-on { border-color:var(--border); background:var(--surface-1); color:var(--text-primary); }
  .np-action:hover:not(:disabled) { background:var(--brand-hover); }
  .np-action.is-on:hover:not(:disabled) { background:var(--surface-3); }
  .np-action:disabled { opacity:.6; cursor:not-allowed; }
  .np-pref-heading { margin:20px 0 10px; }
  .np-pref-heading h3 { margin:0; color:var(--text-primary); font-size:14px; font-weight:800; }
  .np-pref-heading p { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.4; }
  .np-list { display:grid; gap:10px; }
  .np-row { display:flex; align-items:center; gap:12px; padding:12px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .np-row-icon { width:36px; height:36px; }
  .np-row-text { flex:1; min-width:0; }
  .np-row-title { margin:0; color:var(--text-primary); font-size:13px; font-weight:800; }
  .np-row-copy { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.4; }
  .np-switch { position:relative; width:48px; height:44px; flex-shrink:0; border:0; padding:0 3px; cursor:pointer; display:flex; align-items:center; background:transparent; }
  .np-switch::before { content:''; position:absolute; inset:8px 0; border-radius:999px; background:var(--border-strong); transition:background .15s; }
  .np-switch.is-on { justify-content:flex-end; }
  .np-switch.is-on::before { background:var(--brand); }
  .np-switch span { position:relative; width:22px; height:22px; border-radius:999px; background:var(--surface-1); box-shadow:0 1px 2px rgba(0,0,0,.25); }
  .np-switch.is-on span { background:var(--brand-on); }
  .np-switch:disabled { opacity:.6; cursor:not-allowed; }
  .np-always { flex-shrink:0; padding:6px 9px; border:1px solid var(--border-subtle); border-radius:999px; background:var(--surface-1); color:var(--text-secondary); font-size:11px; font-weight:800; }
  .np-error { margin:12px 0 0; padding:10px 12px; border:1px solid var(--danger-border); border-radius:10px; background:var(--error-bg); color:var(--error-fg); font-size:12px; font-weight:700; line-height:1.4; }
  .np-action:focus-visible, .np-switch:focus-visible { outline:2px solid var(--accent-fg); outline-offset:2px; }
  @media(max-width:600px) { .np-status { align-items:flex-start; } .np-row { gap:10px; } .np-row-icon { width:34px; height:34px; } }
  @keyframes np-spin { to { transform:rotate(360deg); } }
`;

type DeviceState = 'loading' | 'on' | 'off' | 'denied' | 'ios-needs-install' | 'unsupported';

const PREFERENCE_ROWS: Array<{ key: keyof NotificationPreferences; title: string; copy: string; Icon: LucideIcon }> = [
  { key: 'invitations', title: 'Invitaciones a jugar', copy: 'Cuando alguien te suma a un partido.', Icon: UserPlus },
  { key: 'invitationResponses', title: 'Respuestas a tus invitaciones', copy: 'Cuando un invitado acepta o rechaza.', Icon: MessageCircle },
  { key: 'bookingReminders', title: 'Recordatorio del turno', copy: '2 horas antes de jugar.', Icon: Clock3 },
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
        return { on: true, title: 'Activos en este dispositivo', sub: 'Recibís los avisos que elegiste abajo.', action: 'Desactivar' };
      case 'off':
        return { on: false, title: 'Desactivados en este dispositivo', sub: 'Activalos para enterarte aunque Pique esté cerrado.', action: 'Activar' };
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
      <div className="p-public-card pf-zone-card">
        <div className="np-heading"><Bell size={16} aria-hidden="true" /><h2>Notificaciones</h2></div>
        <p className="np-intro">Elegí qué avisos querés recibir.</p>
        <div className={`np-status${deviceStatus.on ? ' is-on' : ''}`}>
          <span className="np-status-icon" aria-hidden="true">{deviceStatus.on ? <Bell size={18} /> : <BellOff size={18} />}</span>
          <div className="np-status-copy">
            <p className="np-status-title">{deviceStatus.title}</p>
            {deviceStatus.sub && <p className="np-status-sub">{deviceStatus.sub}</p>}
          </div>
          {deviceStatus.action && (
            <button
              type="button"
              className={`np-action${deviceStatus.on ? ' is-on' : ''}`}
              onClick={() => void toggleDevice()}
              disabled={deviceBusy}
            >
              {deviceBusy && <Loader2 size={15} style={{ animation: 'np-spin .8s linear infinite' }} aria-hidden="true" />}
              {deviceBusy ? 'Procesando...' : `${deviceStatus.action} avisos`}
            </button>
          )}
        </div>

        <div className="np-pref-heading">
          <h3>Tipos de avisos</h3>
          {device === 'off' && <p>Estas opciones se aplicarán cuando actives los avisos.</p>}
        </div>
        <div className="np-list">
          {PREFERENCE_ROWS.map((row) => {
            const on = Boolean(preferences?.[row.key]);
            const Icon = row.Icon;
            return (
              <div className="np-row" key={row.key}>
                <span className="np-row-icon" aria-hidden="true"><Icon size={17} /></span>
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
            <span className="np-row-icon" aria-hidden="true"><CalendarX size={17} /></span>
            <div className="np-row-text">
              <p className="np-row-title">Cancelaciones del club</p>
              <p className="np-row-copy">Si el club cancela tu turno.</p>
            </div>
            <span className="np-always">Siempre activo</span>
          </div>
        </div>
        {error && <p className="np-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
