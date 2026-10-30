import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import DarkPageLayout from '../components/DarkPageLayout';
import UserLoadingState from '../components/UserLoadingState';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { AppleMark, FacebookMark, GoogleMark } from '../components/AuthProviderMarks';
import {
  beginAppleOAuthConnect,
  beginFacebookOAuthConnect,
  beginGoogleOAuthConnect,
  claimClubProfile,
  disconnectAppleOAuth,
  disconnectFacebookOAuth,
  disconnectGoogleOAuth,
  getAccountSecurityOverview,
  getPendingLogoutRedirect,
  logout,
  logoutAllSessions,
  type AccountSecurityOverview,
  type SessionSecuritySummary
} from '../services/AuthService';
import { useValidateAuth } from '../hooks/useValidateAuth';
import { updateMyProfile } from '../services/AuthService';
import { AlertTriangle, ArrowRight, Building2, CalendarDays, Mail, Phone, IdCard, User, UserRound, Save, CheckCircle, Shield, LogOut, Monitor, Smartphone, Link as LinkIcon } from 'lucide-react';
import { extractErrorMessage } from '../utils/uiError';
import {
  buildCanonicalPhone,
  DEFAULT_PHONE_COUNTRY_ISO2,
  normalizePhoneCountryIso2,
  PHONE_COUNTRY_OPTIONS,
  resolveCallingCodeByIso2,
  splitCanonicalPhone
} from '../utils/phone';
import NotificationPreferencesSection from '../components/push/NotificationPreferencesSection';

const PAGE_CSS = `
  .pf-page { padding-top:16px!important; padding-bottom:28px!important; }
  .pf-head { margin-bottom:28px; padding-bottom:24px; border-bottom:1px solid var(--border-subtle); }
  .pf-card { padding:20px; }
  .pf-card-title { display:flex; align-items:center; gap:8px; margin:0 0 18px; color:var(--text-primary); font-size:15px; font-weight:800; }
  .pf-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 16px; }
  .pf-full { grid-column:1 / -1; }
  .pf-card .p-public-field-label { gap:6px; margin-bottom:6px; color:var(--text-primary); font-size:12px; font-weight:700; letter-spacing:0; }
  .pf-card .p-public-field-label svg { color:var(--text-muted); }
  .pf-card .p-public-input, .pf-card .p-public-select { min-height:44px; }
  .pf-phone-inputs { display:flex; align-items:center; gap:10px; }
  .pf-phone-inputs .p-public-input { min-width:0; }
  .pf-email-value { min-height:44px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-2); color:var(--text-secondary); font-size:14px; }
  .pf-email-address { min-width:0; overflow-wrap:anywhere; }
  .pf-email-readonly { flex:none; color:var(--text-muted); font-size:11px; font-weight:700; }
  .pf-actions { margin-top:18px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  .pf-zone { margin-top:28px; }
  .pf-zone-card { padding:20px; }
  .pf-save { min-height:44px; display:inline-flex; align-items:center; gap:8px; padding:10px 18px; background:var(--brand); color:var(--brand-on); border:none; border-radius:12px; font-size:13px; font-weight:800; letter-spacing:.01em; cursor:pointer; font-family:var(--font-sans); transition:background .15s,transform .15s; }
  .pf-save:hover:not(:disabled) { background:var(--brand-hover); transform:translateY(-1px); }
  .pf-save:disabled { opacity:.5; cursor:not-allowed; }
  .pf-notice { display:flex; align-items:flex-start; gap:10px; padding:13px 16px; border-radius:14px; font-size:13px; font-weight:600; line-height:1.5; animation:pf-notice-in .18s ease-out; }
  .pf-notice-err { background:var(--error-bg); border:1px solid var(--danger-border); color:var(--error-fg); }
  .pf-notice-ok { background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--positive-fg); }
  .pf-section-notice { margin:0 0 16px; }
  .pf-access-card { scroll-margin-top:80px; }
  .pf-security-grid { display:grid; grid-template-columns:1fr; gap:16px; }
  .pf-security-card { padding:20px; }
  .pf-section-heading { display:flex; align-items:center; gap:9px; margin:0 0 8px; color:var(--text-primary); font-size:15px; font-weight:800; }
  .pf-muted { color:var(--text-muted); font-size:13px; line-height:1.5; }
  .pf-club-list { display:grid; gap:10px; }
  .pf-club-row { display:grid; grid-template-columns:38px minmax(0,1fr) auto auto; align-items:center; gap:12px; padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .pf-club-icon { width:38px; height:38px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-1); color:var(--text-secondary); }
  .pf-club-content { min-width:0; }
  .pf-club-name { color:var(--text-primary); font-size:14px; font-weight:800; }
  .pf-club-status { justify-self:start; padding:3px 8px; border:1px solid var(--border); border-radius:999px; background:var(--surface-1); color:var(--text-secondary); font-size:11px; font-weight:800; white-space:nowrap; }
  .pf-club-status-linked { border-color:var(--accent-border-subtle); background:var(--positive-bg); color:var(--positive-fg); }
  .pf-club-status-conflicted { border-color:var(--danger-border); background:var(--error-bg); color:var(--error-fg); }
  .pf-club-detail { margin:5px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; }
  .pf-club-actions { justify-self:end; }
  .pf-club-actions .pf-secondary-btn { min-height:42px; white-space:nowrap; }
  .pf-session-list { display:grid; gap:10px; }
  .pf-session-row { display:flex; align-items:flex-start; gap:12px; padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .pf-session-row-current { border-color:var(--accent-border-subtle); background:var(--accent-bg-soft); }
  .pf-session-icon { flex:none; width:38px; height:38px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-1); color:var(--text-secondary); }
  .pf-session-content { min-width:0; }
  .pf-session-heading { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 5px; }
  .pf-session-name { font-size:14px; font-weight:800; color:var(--text-primary); }
  .pf-session-current { padding:3px 8px; border:1px solid var(--accent-border-subtle); border-radius:999px; background:var(--positive-bg); color:var(--positive-fg); font-size:11px; font-weight:800; }
  .pf-session-detail { margin:2px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; }
  .pf-session-footer { margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle); }
  .pf-access-list { display:grid; gap:10px; }
  .pf-access-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .pf-access-row-connected { border-color:var(--accent-border-subtle); }
  .pf-access-main { display:flex; align-items:center; gap:12px; min-width:0; }
  .pf-access-icon { flex:none; width:38px; height:38px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-1); color:var(--text-primary); }
  .pf-access-photo { flex:none; width:38px; height:38px; border:1px solid var(--border-subtle); border-radius:12px; object-fit:cover; }
  .pf-access-copy { min-width:0; }
  .pf-access-heading { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .pf-access-name { font-size:14px; font-weight:800; color:var(--text-primary); }
  .pf-access-connected { padding:3px 8px; border:1px solid var(--accent-border-subtle); border-radius:999px; background:var(--positive-bg); color:var(--positive-fg); font-size:11px; font-weight:800; }
  .pf-access-detail { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
  .pf-access-actions { flex:none; }
  .pf-access-actions .pf-secondary-btn { min-height:42px; white-space:nowrap; }
  .pf-bookings-card { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .pf-bookings-main { display:flex; align-items:center; gap:12px; min-width:0; }
  .pf-bookings-icon { flex:none; width:38px; height:38px; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-2); color:var(--text-secondary); }
  .pf-bookings-title { margin:0; color:var(--text-primary); font-size:14px; font-weight:800; }
  .pf-bookings-copy { margin:4px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; }
  .pf-bookings-link { flex:none; min-height:42px; text-decoration:none; }
  .pf-secondary-btn { min-height:42px; display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 16px; border-radius:12px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-primary); font-size:12px; font-weight:800; cursor:pointer; font-family:var(--font-sans); }
  .pf-secondary-btn:hover:not(:disabled) { background:var(--surface-3); }
  .pf-secondary-btn:disabled { opacity:.55; cursor:not-allowed; }
  .pf-secondary-btn:focus-visible, .pf-save:focus-visible { outline:2px solid var(--accent-fg); outline-offset:2px; }
  .pf-danger-btn { border-color:var(--danger-border); color:var(--error-fg); background:var(--error-bg); }
  .pf-conflict-box { margin-top:10px; padding:10px 12px; border-radius:12px; background:var(--surface-1); border:1px solid var(--border-subtle); }
  @media(max-width:600px){ .pf-club-row { grid-template-columns:38px minmax(0,1fr) auto; gap:8px 12px; padding:12px; } .pf-club-icon { grid-column:1; grid-row:1 / 3; align-self:start; } .pf-club-content { grid-column:2 / -1; grid-row:1; } .pf-club-status { grid-column:2; grid-row:2; } .pf-club-actions { grid-column:3; grid-row:2; } .pf-session-row, .pf-access-row { padding:12px; } .pf-access-row { flex-wrap:wrap; } .pf-access-actions { margin-left:auto; } .pf-bookings-card { align-items:stretch; flex-direction:column; } .pf-bookings-link { width:100%; } }
  @keyframes pf-notice-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
  .p-public-root.p-public-theme-light .pf-save { box-shadow:0 8px 18px var(--accent-border-subtle); }
  .p-public-root.p-public-theme-light .pf-notice-err { background:var(--error-bg); color:var(--error-fg); }
  .p-public-root.p-public-theme-light .pf-notice-ok { background:var(--positive-bg); color:var(--positive-fg); }
  .p-public-root.p-public-theme-light .pf-head { border-bottom-color:var(--border)!important; }
  .p-public-root.p-public-theme-light .pf-zone-title { color:var(--text-muted)!important; }
  @media(max-width:600px){ .pf-page { padding-top:12px!important; padding-bottom:20px!important; } .pf-head { margin-bottom:22px; padding-bottom:18px; } .pf-grid { grid-template-columns:1fr; gap:14px; } .pf-card .p-public-input, .pf-card .p-public-select { font-size:16px; } .pf-save { width:100%; justify-content:center; } .pf-zone { margin-top:24px; } .pf-zone-card { padding:18px; } }
`;

function describeSessionDevice(session: SessionSecuritySummary) {
  const userAgent = session.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod/i.test(userAgent);
  const browser = /Edg\//i.test(userAgent) ? 'Edge'
    : /(?:Chrome|CriOS)\//i.test(userAgent) ? 'Chrome'
    : /(?:Firefox|FxiOS)\//i.test(userAgent) ? 'Firefox'
    : /Safari\//i.test(userAgent) ? 'Safari'
    : '';
  const platform = /iPad/i.test(userAgent) ? 'iPad'
    : /iPhone|iPod/i.test(userAgent) ? 'iPhone'
    : /Android/i.test(userAgent) ? 'Android'
    : /Windows/i.test(userAgent) ? 'Windows'
    : /Macintosh|Mac OS X/i.test(userAgent) ? 'Mac'
    : /Linux/i.test(userAgent) ? 'Linux'
    : '';
  return {
    label: session.deviceLabel?.trim() || (browser && platform ? `${browser} en ${platform}` : browser || platform || 'Dispositivo sin identificar'),
    mobile
  };
}

type FeedbackSection = 'page' | 'profile' | 'clubs' | 'access' | 'sessions';
type Feedback = { section: FeedbackSection; kind: 'error' | 'success'; message: string };

function FeedbackNotice({ feedback, section }: { feedback: Feedback | null; section: FeedbackSection }) {
  if (!feedback || feedback.section !== section) return null;
  return (
    <div className={`pf-notice pf-section-notice ${feedback.kind === 'error' ? 'pf-notice-err' : 'pf-notice-ok'}`}
      role={feedback.kind === 'error' ? 'alert' : 'status'}>
      {feedback.kind === 'error'
        ? <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
        : <CheckCircle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{feedback.message}</span>
    </div>
  );
}

export default function PerfilPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const accessCardRef = useRef<HTMLDivElement>(null);
  const oauthScrollPending = useRef(false);
  const [security, setSecurity] = useState<AccountSecurityOverview | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [disconnectingApple, setDisconnectingApple] = useState(false);
  const [disconnectingFacebook, setDisconnectingFacebook] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<'google' | 'apple' | 'facebook' | null>(null);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const [claimingClubId, setClaimingClubId] = useState<number | null>(null);
  const [securityRefreshKey, setSecurityRefreshKey] = useState(0);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    dni: '',
    phoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    phoneLocal: ''
  });

  useEffect(() => {
    if (!authChecked) return;
    if (user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/perfil')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    if (!user) return;
    const splitPhone = splitCanonicalPhone(String(user.phoneNumber || ''), DEFAULT_PHONE_COUNTRY_ISO2);
    setForm({
      firstName: String(user.firstName || ''),
      lastName: String(user.lastName || ''),
      email: String(user.email || ''),
      dni: String((user as any).dni || ''),
      phoneCountryIso2: normalizePhoneCountryIso2(splitPhone.countryIso2),
      phoneLocal: String(splitPhone.localNumber || '')
    });
  }, [user]);

  useEffect(() => {
    if (feedback?.kind !== 'success') return;
    const timer = window.setTimeout(() => setFeedback(current => current === feedback ? null : current), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!authChecked || !user) return;
    let cancelled = false;
    setSecurityLoading(true);
    void (async () => {
      try {
        const overview = await getAccountSecurityOverview();
        if (!cancelled) setSecurity(overview);
      } catch (err: unknown) {
        if (!cancelled) setFeedback({ section: 'page', kind: 'error', message: extractErrorMessage(err, 'No se pudo cargar la seguridad de la cuenta.') });
      } finally {
        if (!cancelled) setSecurityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authChecked, user, securityRefreshKey]);

  useEffect(() => {
    if (!router.isReady) return;
    const oauthError = typeof router.query.oauth_error === 'string' ? router.query.oauth_error : '';
    const oauthProvider = typeof router.query.oauth_provider === 'string' ? router.query.oauth_provider : '';
    if (!oauthError) return;

    const message =
      oauthError === 'google_access_denied'
        ? 'Cancelaste la conexión con Google antes de completarla.'
        : oauthError === 'google_email_unavailable'
        ? 'Google no devolvió un email usable para conectar esta cuenta.'
        : oauthError === 'google_email_unverified'
        ? 'La cuenta de Google no devolvió un email verificado. Probá con otra cuenta.'
        : oauthError === 'google_already_linked'
        ? 'Esa cuenta de Google ya está vinculada a otro usuario de Pique.'
        : oauthError === 'google_not_configured'
        ? 'Google no está disponible en este momento. Podés seguir entrando con email.'
        : oauthError === 'google_state_invalid'
        ? 'La validación del acceso con Google expiró o quedó inválida. Probá de nuevo.'
        : oauthError === 'apple_access_denied'
        ? 'Cancelaste la conexión con Apple antes de completarla.'
        : oauthError === 'apple_email_unavailable'
        ? 'Apple no devolvió un email usable para conectar esta cuenta.'
        : oauthError === 'apple_email_unverified'
        ? 'La cuenta de Apple no devolvió un email verificado. Probá con otra cuenta.'
        : oauthError === 'apple_already_linked'
        ? 'Esa cuenta de Apple ya está vinculada a otro usuario de Pique.'
        : oauthError === 'apple_not_configured'
        ? 'Apple no está disponible en este momento. Podés seguir entrando con email.'
        : oauthError === 'apple_state_invalid'
        ? 'La validación del acceso con Apple expiró o quedó inválida. Probá de nuevo.'
        : oauthError === 'facebook_access_denied'
        ? 'Cancelaste la conexión con Facebook antes de completarla.'
        : oauthError === 'facebook_email_unavailable'
        ? 'Facebook no devolvió un email usable para conectar esta cuenta.'
        : oauthError === 'facebook_already_linked'
        ? 'Esa cuenta de Facebook ya está vinculada a otro usuario de Pique.'
        : oauthError === 'facebook_not_configured'
        ? 'Facebook no está disponible en este momento. Podés seguir entrando con email.'
        : oauthError === 'facebook_state_invalid'
        ? 'La validación del acceso con Facebook expiró o quedó inválida. Probá de nuevo.'
        : oauthError === 'oauth_connect_auth_required'
        ? 'Tu sesión expiró antes de completar la conexión. Ingresá de nuevo e intentá otra vez.'
        : oauthProvider === 'apple'
        ? 'No se pudo completar la conexión con Apple.'
        : oauthProvider === 'facebook'
        ? 'No se pudo completar la conexión con Facebook.'
        : 'No se pudo completar la conexión con Google.';

    setConnectingProvider(null);
    oauthScrollPending.current = true;
    setFeedback({ section: 'access', kind: 'error', message });
    const remainingQuery = { ...router.query };
    delete remainingQuery.oauth_error;
    delete remainingQuery.oauth_provider;
    void router.replace({ pathname: router.pathname, query: remainingQuery }, undefined, { shallow: true, scroll: false });
  }, [router, router.isReady, router.query.oauth_error, router.query.oauth_provider]);

  useEffect(() => {
    if (!authChecked || !user || router.query.oauth_error || !oauthScrollPending.current || feedback?.section !== 'access') return;
    const frame = window.requestAnimationFrame(() => {
      accessCardRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      oauthScrollPending.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authChecked, user, router.query.oauth_error, feedback]);

  if (!authChecked || !user) {
    return <UserLoadingState mode="page" message={authChecked ? 'Redirigiendo...' : 'Validando sesión...'} />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    const firstName = String(form.firstName || '').trim();
    const lastName = String(form.lastName || '').trim();
    const phoneLocal = String(form.phoneLocal || '').replace(/[^\d]/g, '');
    const safeDni = String(form.dni || '').trim();

    if (!firstName || !lastName) {
      setFeedback({ section: 'profile', kind: 'error', message: 'Nombre y apellido son obligatorios.' });
      return;
    }
    if (!phoneLocal) {
      setFeedback({ section: 'profile', kind: 'error', message: 'Ingresá un teléfono.' });
      return;
    }
    if (safeDni && safeDni.length < 7) {
      setFeedback({ section: 'profile', kind: 'error', message: 'Si cargás DNI, debe tener al menos 7 dígitos.' });
      return;
    }

    const canonicalPhone = buildCanonicalPhone({ countryIso2: form.phoneCountryIso2, localNumber: phoneLocal });
    if (!canonicalPhone) {
      setFeedback({ section: 'profile', kind: 'error', message: 'Número de teléfono inválido.' });
      return;
    }

    setSaving(true);
    try {
      await updateMyProfile({
        firstName,
        lastName,
        phoneNumber: canonicalPhone,
        phoneCountryCode: resolveCallingCodeByIso2(form.phoneCountryIso2),
        phoneNumberLocal: phoneLocal,
        dni: safeDni || undefined
      });
      setFeedback({ section: 'profile', kind: 'success', message: 'Cambios guardados.' });
    } catch (err: unknown) {
      setFeedback({ section: 'profile', kind: 'error', message: extractErrorMessage(err, 'No se pudo actualizar el perfil.') });
    } finally {
      setSaving(false);
    }
  };

  const displayName = user.firstName || (user as any).name || 'Usuario';
  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return 'Sin dato';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin dato';
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  };

  const googleIdentity = security?.oauthIdentities?.find((identity) => identity.provider === 'GOOGLE') || null;
  const appleIdentity = security?.oauthIdentities?.find((identity) => identity.provider === 'APPLE') || null;
  const facebookIdentity = security?.oauthIdentities?.find((identity) => identity.provider === 'FACEBOOK') || null;
  const formatMatchSignals = (signals: Array<string>) => {
    const labelBySignal: Record<string, string> = {
      EMAIL: 'email',
      PHONE: 'teléfono',
      DNI: 'DNI'
    };
    const labels = signals.map((signal) => labelBySignal[signal] || signal.toLowerCase()).filter(Boolean);
    if (labels.length === 0) return null;
    return `Coincidencia por ${labels.join(', ')}.`;
  };

  const handleDisconnectGoogle = async () => {
    setFeedback(null);
    setDisconnectingGoogle(true);
    try {
      await disconnectGoogleOAuth();
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setFeedback({ section: 'access', kind: 'success', message: 'Google se desconectó de tu cuenta.' });
    } catch (err: unknown) {
      setFeedback({ section: 'access', kind: 'error', message: extractErrorMessage(err, 'No se pudo desconectar Google.') });
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const handleDisconnectApple = async () => {
    setFeedback(null);
    setDisconnectingApple(true);
    try {
      await disconnectAppleOAuth();
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setFeedback({ section: 'access', kind: 'success', message: 'Apple se desconectó de tu cuenta.' });
    } catch (err: unknown) {
      setFeedback({ section: 'access', kind: 'error', message: extractErrorMessage(err, 'No se pudo desconectar Apple.') });
    } finally {
      setDisconnectingApple(false);
    }
  };

  const handleDisconnectFacebook = async () => {
    setFeedback(null);
    setDisconnectingFacebook(true);
    try {
      await disconnectFacebookOAuth();
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setFeedback({ section: 'access', kind: 'success', message: 'Facebook se desconectó de tu cuenta.' });
    } catch (err: unknown) {
      setFeedback({ section: 'access', kind: 'error', message: extractErrorMessage(err, 'No se pudo desconectar Facebook.') });
    } finally {
      setDisconnectingFacebook(false);
    }
  };

  const handleConnectProvider = (provider: 'google' | 'apple' | 'facebook') => {
    setFeedback(null);
    setConnectingProvider(provider);
    if (provider === 'google') {
      beginGoogleOAuthConnect('/perfil');
      return;
    }
    if (provider === 'apple') {
      beginAppleOAuthConnect('/perfil');
      return;
    }
    beginFacebookOAuthConnect('/perfil');
  };

  const handleLogoutAll = async () => {
    setFeedback(null);
    setLogoutAllLoading(true);
    try {
      await logoutAllSessions();
      logout({ reason: 'manual' });
    } catch (err: unknown) {
      setFeedback({ section: 'sessions', kind: 'error', message: extractErrorMessage(err, 'No se pudieron cerrar todas las sesiones.') });
      setLogoutAllLoading(false);
    }
  };

  const handleClaimClubProfile = async (clubId: number) => {
    setFeedback(null);
    setClaimingClubId(clubId);
    try {
      await claimClubProfile(clubId);
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setFeedback({ section: 'clubs', kind: 'success', message: 'Tu perfil del club quedó vinculado a tu cuenta.' });
    } catch (err: unknown) {
      setFeedback({ section: 'clubs', kind: 'error', message: extractErrorMessage(err, 'No se pudo vincular tu perfil en este club.') });
    } finally {
      setClaimingClubId(null);
    }
  };

  const accessProviders = [
    { key: 'facebook', name: 'Facebook', Icon: FacebookMark, identity: facebookIdentity, disconnecting: disconnectingFacebook, disconnect: handleDisconnectFacebook },
    { key: 'apple', name: 'Apple', Icon: AppleMark, identity: appleIdentity, disconnecting: disconnectingApple, disconnect: handleDisconnectApple },
    { key: 'google', name: 'Google', Icon: GoogleMark, identity: googleIdentity, disconnecting: disconnectingGoogle, disconnect: handleDisconnectGoogle }
  ] as const;

  return (
    <DarkPageLayout
      title="Mi Perfil | Pique"
      extraCss={PAGE_CSS}
      breadcrumbs={[
        { label: 'Inicio', href: '/' },
        { label: 'Mi perfil' },
      ]}
    >
      <div className="p-public-page-sm pf-page">

        {/* ── PAGE HEADER ── */}
        <div className="pf-head">
          <span className="p-public-page-eyebrow">Cuenta</span>
          <h1 className="p-public-page-h">Mi <i>perfil</i></h1>
          <p className="p-public-page-sub">Editá los datos de tu cuenta, {displayName}.</p>
        </div>

        <FeedbackNotice feedback={feedback} section="page" />

        {/* ── FORM CARD ── */}
        <div className="p-public-card pf-card">
          <form onSubmit={handleSubmit}>
            <h2 className="pf-card-title"><UserRound size={18} aria-hidden="true" /> Datos personales</h2>
            <FeedbackNotice feedback={feedback} section="profile" />

            <div className="pf-grid">

              {/* Nombre */}
              <div className="p-public-field">
                <label className="p-public-field-label" htmlFor="pf-first-name">
                  <User size={12} /> Nombre
                </label>
                <input
                  id="pf-first-name" name="firstName" autoComplete="given-name"
                  className="p-public-input"
                  value={form.firstName}
                  onChange={(e) => setForm(p => ({ ...p, firstName: e.target.value }))}
                  placeholder="Tu nombre"
                />
              </div>

              {/* Apellido */}
              <div className="p-public-field">
                <label className="p-public-field-label" htmlFor="pf-last-name">
                  <User size={12} /> Apellido
                </label>
                <input
                  id="pf-last-name" name="lastName" autoComplete="family-name"
                  className="p-public-input"
                  value={form.lastName}
                  onChange={(e) => setForm(p => ({ ...p, lastName: e.target.value }))}
                  placeholder="Tu apellido"
                />
              </div>

              {/* Email */}
              <div className="p-public-field pf-full">
                <div className="p-public-field-label">
                  <Mail size={12} /> Email
                </div>
                <div className="pf-email-value">
                  <span className="pf-email-address">{form.email}</span>
                  <span className="pf-email-readonly">No editable</span>
                </div>
              </div>

              {/* Teléfono */}
              <div className="p-public-field">
                <label className="p-public-field-label" htmlFor="pf-phone-local">
                  <Phone size={12} /> Teléfono
                </label>
                <div className="pf-phone-inputs">
                  <select
                    aria-label="País del teléfono"
                    className="p-public-select"
                    value={form.phoneCountryIso2}
                    onChange={(e) => setForm(p => ({ ...p, phoneCountryIso2: normalizePhoneCountryIso2(e.target.value) }))}
                  >
                    {PHONE_COUNTRY_OPTIONS.map(opt => (
                      <option key={opt.iso2} value={opt.iso2}>{opt.callingCode} {opt.iso2}</option>
                    ))}
                  </select>
                  <input
                    id="pf-phone-local" name="phoneLocal" type="tel" inputMode="tel" autoComplete="tel-national"
                    className="p-public-input"
                    value={form.phoneLocal}
                    onChange={(e) => setForm(p => ({ ...p, phoneLocal: e.target.value.replace(/[^\d]/g, '') }))}
                    placeholder="Número local"
                  />
                </div>
              </div>

              {/* DNI */}
              <div className="p-public-field">
                <label className="p-public-field-label" htmlFor="pf-dni">
                  <IdCard size={12} /> DNI (opcional)
                </label>
                <input
                  id="pf-dni" name="dni" inputMode="numeric"
                  className="p-public-input"
                  value={form.dni}
                  onChange={(e) => setForm(p => ({ ...p, dni: e.target.value.replace(/[^\d]/g, '') }))}
                  placeholder="Sin puntos ni espacios"
                />
              </div>

            </div>

            {/* Submit */}
            <div className="pf-actions">
              <button type="submit" disabled={saving} className="pf-save">
                <Save size={15} />
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>

          </form>
        </div>

        <NotificationPreferencesSection />

        <div className="pf-zone">
          <div className="pf-zone-title" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 16 }}>Perfiles en clubes</div>
          <div className="p-public-card pf-security-card">
            <h2 className="pf-section-heading"><LinkIcon size={16} aria-hidden="true" /> Mis perfiles</h2>
            <p className="pf-muted" style={{ marginTop: 0, marginBottom: 18 }}>
              Entrá a tus clubes o vinculá un perfil encontrado.
            </p>

            <FeedbackNotice feedback={feedback} section="clubs" />

            {securityLoading ? (
              <p className="pf-muted" style={{ margin: 0 }}>Cargando perfiles de clubes...</p>
            ) : (
              <div className="pf-club-list">
                {(security?.clubProfiles || []).length > 0 ? (
                  security!.clubProfiles.map((profile) => (
                    <div className="pf-club-row" key={profile.clubId}>
                      <span className="pf-club-icon" aria-hidden="true"><Building2 size={18} /></span>
                      <div className="pf-club-content">
                        <span className="pf-club-name">{profile.clubName}</span>
                        {profile.status !== 'LINKED' && <p className="pf-club-detail">{profile.reason}</p>}
                        {profile.canClaim && formatMatchSignals(profile.matchedBy) && (
                          <p className="pf-club-detail">{formatMatchSignals(profile.matchedBy)}</p>
                        )}
                        {profile.status === 'CONFLICTED' && profile.conflictDetails && (
                          <div className="pf-conflict-box">
                            <div className="pf-muted" style={{ margin: 0 }}>
                              {profile.reasonCode === 'MULTIPLE_STRONG_MATCHES'
                                ? `Hay ${profile.conflictDetails.freeCandidateCount} perfiles libres compatibles.`
                                : profile.reasonCode === 'MATCH_LINKED_TO_ANOTHER_USER'
                                ? 'El perfil compatible ya está vinculado a otra cuenta.'
                                : profile.reasonCode === 'MIXED_STRONG_MATCH_CONFLICT'
                                ? `Hay ${profile.conflictDetails.candidateCount} perfiles compatibles y al menos uno ya está vinculado a otra cuenta.`
                                : 'Necesitamos revisar este caso antes de vincularlo.'}
                            </div>
                          </div>
                        )}
                      </div>
                      <span className={`pf-club-status${profile.status === 'LINKED' ? ' pf-club-status-linked' : profile.status === 'CONFLICTED' ? ' pf-club-status-conflicted' : ''}`}>
                        {profile.status === 'LINKED'
                          ? 'Vinculado'
                          : profile.status === 'CLAIMABLE'
                          ? 'Por vincular'
                          : profile.status === 'CONFLICTED'
                          ? 'Revisión necesaria'
                          : 'Sin vínculo'}
                      </span>
                      <div className="pf-club-actions">
                        {profile.canClaim ? (
                          <button
                            type="button"
                            className="pf-secondary-btn"
                            disabled={claimingClubId === profile.clubId}
                            onClick={() => handleClaimClubProfile(profile.clubId)}
                          >
                            {claimingClubId === profile.clubId ? 'Vinculando...' : 'Vincular perfil'}
                          </button>
                        ) : profile.clubSlug ? (
                          <Link
                            href={`/club/${profile.clubSlug}`}
                            className="pf-secondary-btn"
                            style={{ textDecoration: 'none' }}
                          >
                            Ir al club
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="pf-muted" style={{ margin: 0 }}>
                    Todavía no encontramos perfiles de clubes para mostrar en tu cuenta.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="pf-zone">
          <div className="pf-zone-title" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 16 }}>Seguridad</div>
          <div className="pf-security-grid">
            <ChangePasswordForm onPasswordChanged={() => setSecurityRefreshKey(value => value + 1)} />
            <div ref={accessCardRef} className="p-public-card pf-security-card pf-access-card">
              <h2 className="pf-section-heading"><Shield size={16} aria-hidden="true" /> Accesos conectados</h2>
              <p className="pf-muted" style={{ marginTop: 0, marginBottom: 18 }}>
                Elegí otras formas de entrar. También podés seguir usando el enlace por email.
              </p>

              <FeedbackNotice feedback={feedback} section="access" />

              {securityLoading ? (
                <p className="pf-muted" style={{ margin: 0 }}>Cargando accesos conectados...</p>
              ) : (
                <div className="pf-access-list">
                  {accessProviders.map(({ key, name, Icon, identity, disconnecting, disconnect }) => (
                    <div className={`pf-access-row${identity ? ' pf-access-row-connected' : ''}`} key={key}>
                      <div className="pf-access-main">
                        {identity?.profilePhotoUrl ? (
                          <img src={identity.profilePhotoUrl} alt="" className="pf-access-photo" />
                        ) : (
                          <span className="pf-access-icon" aria-hidden="true"><Icon /></span>
                        )}
                        <div className="pf-access-copy">
                          <div className="pf-access-heading">
                            <span className="pf-access-name">{name}</span>
                            {identity && <span className="pf-access-connected">Conectado</span>}
                          </div>
                          {identity && (
                            <>
                              <p className="pf-access-detail">{identity.providerEmail || user.email}</p>
                              <p className="pf-access-detail">Último acceso: {formatDateTime(identity.lastLoginAt)} · {identity.providerEmailVerified ? 'Email verificado' : 'Email sin verificar'}</p>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="pf-access-actions">
                        <button
                          type="button"
                          className={`pf-secondary-btn${identity ? ' pf-danger-btn' : ''}`}
                          aria-label={`${identity ? 'Desconectar' : 'Conectar'} ${name}`}
                          disabled={identity ? disconnecting : connectingProvider !== null}
                          onClick={identity ? disconnect : () => handleConnectProvider(key)}
                        >
                          {identity
                            ? disconnecting ? 'Desconectando...' : 'Desconectar'
                            : connectingProvider === key ? 'Conectando...' : 'Conectar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-public-card pf-security-card">
              <h2 className="pf-section-heading"><Smartphone size={16} aria-hidden="true" /> Sesiones activas</h2>
              <p className="pf-muted" style={{ marginTop: 0, marginBottom: 18 }}>
                Dispositivos donde tu cuenta sigue abierta.
              </p>

              <FeedbackNotice feedback={feedback} section="sessions" />

              {securityLoading ? (
                <p className="pf-muted" style={{ margin: 0 }}>Cargando sesiones activas...</p>
              ) : (
                <>
                  <div className="pf-session-list">
                    {(security?.sessions || []).length > 0 ? (
                      security!.sessions.map((session) => {
                        const device = describeSessionDevice(session);
                        const DeviceIcon = device.mobile ? Smartphone : Monitor;
                        return (
                          <div className={`pf-session-row${session.isCurrent ? ' pf-session-row-current' : ''}`} key={session.id}>
                            <span className="pf-session-icon" aria-hidden="true"><DeviceIcon size={18} /></span>
                            <div className="pf-session-content">
                              <div className="pf-session-heading">
                                <span className="pf-session-name">{device.label}</span>
                                {session.isCurrent && <span className="pf-session-current">Este dispositivo</span>}
                              </div>
                              <p className="pf-session-detail">Última actividad: {formatDateTime(session.lastSeenAt)}</p>
                              <p className="pf-session-detail">Sesión iniciada: {formatDateTime(session.createdAt)}</p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="pf-muted" style={{ margin: 0 }}>No encontramos sesiones activas para mostrar.</p>
                    )}
                  </div>

                  <div className="pf-session-footer">
                    <button
                      type="button"
                      className="pf-secondary-btn pf-danger-btn"
                      disabled={logoutAllLoading}
                      onClick={handleLogoutAll}
                    >
                      <LogOut size={14} />
                      {logoutAllLoading ? 'Cerrando sesiones...' : 'Cerrar todas las sesiones'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── RESERVAS ── */}
        <div className="pf-zone">
          <div className="pf-zone-title" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 16 }}>Reservas</div>
          <div className="p-public-card pf-zone-card pf-bookings-card">
            <div className="pf-bookings-main">
              <span className="pf-bookings-icon" aria-hidden="true"><CalendarDays size={18} /></span>
              <div>
                <h2 className="pf-bookings-title">Mis reservas</h2>
                <p className="pf-bookings-copy">Consultá tus próximas reservas y el historial.</p>
              </div>
            </div>
            <Link href="/bookings" className="pf-secondary-btn pf-bookings-link">
              Ver reservas <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>

      </div>
    </DarkPageLayout>
  );
}
