import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import DarkPageLayout from '../components/DarkPageLayout';
import UserLoadingState from '../components/UserLoadingState';
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
  type AccountSecurityOverview
} from '../services/AuthService';
import { useValidateAuth } from '../hooks/useValidateAuth';
import { updateMyProfile } from '../services/AuthService';
import { Mail, Phone, IdCard, User, Save, CheckCircle, Shield, LogOut, Smartphone, Link as LinkIcon } from 'lucide-react';
import { extractErrorMessage } from '../utils/uiError';
import {
  buildCanonicalPhone,
  DEFAULT_PHONE_COUNTRY_ISO2,
  normalizePhoneCountryIso2,
  PHONE_COUNTRY_OPTIONS,
  resolveCallingCodeByIso2,
  splitCanonicalPhone
} from '../utils/phone';

const PAGE_CSS = `
  .pf-page { padding-top:16px!important; padding-bottom:28px!important; }
  .pf-head { margin-bottom:28px; padding-bottom:24px; border-bottom:1px solid var(--border-subtle); }
  .pf-card { padding:24px; }
  .pf-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .pf-full { grid-column:1 / -1; }
  .pf-actions { margin-top:24px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  .pf-zone { margin-top:28px; }
  .pf-zone-card { padding:20px; }
  .pf-save { display:inline-flex; align-items:center; gap:8px; padding:12px 28px; background:var(--brand); color:var(--brand-on); border:none; border-radius:999px; font-size:13px; font-weight:800; letter-spacing:.01em; cursor:pointer; font-family:var(--font-sans); transition:background .15s,transform .15s; }
  .pf-save:hover:not(:disabled) { background:var(--brand-hover); transform:translateY(-1px); }
  .pf-save:disabled { opacity:.5; cursor:not-allowed; }
  .pf-notice { display:flex; align-items:flex-start; gap:10px; padding:13px 16px; border-radius:14px; font-size:13px; font-weight:600; line-height:1.5; animation:pf-notice-in .18s ease-out; }
  .pf-notice-err { background:var(--error-bg); border:1px solid var(--error-bg); color:var(--error-fg); }
  .pf-notice-ok { background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--positive-fg); }
  .pf-zone-link:hover { background:var(--accent-bg-muted)!important; }
  .pf-security-grid { display:grid; grid-template-columns:1fr; gap:16px; }
  .pf-security-card { padding:20px; }
  .pf-pill { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-primary); border-radius:999px; padding:8px 12px; font-size:12px; font-weight:700; }
  .pf-chip { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--border-subtle); background:var(--surface-2); border-radius:999px; padding:7px 12px; font-size:12px; font-weight:700; color:var(--text-secondary); }
  .pf-muted { color:var(--text-muted); font-size:13px; line-height:1.5; }
  .pf-security-list { display:flex; flex-direction:column; gap:12px; }
  .pf-session-row, .pf-provider-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:14px 0; border-top:1px solid var(--border-subtle); }
  .pf-session-row:first-child, .pf-provider-row:first-child { border-top:none; padding-top:0; }
  .pf-provider-actions, .pf-session-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .pf-secondary-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 16px; border-radius:999px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-primary); font-size:12px; font-weight:800; cursor:pointer; font-family:var(--font-sans); }
  .pf-secondary-btn:hover:not(:disabled) { background:var(--surface-3); }
  .pf-secondary-btn:disabled { opacity:.55; cursor:not-allowed; }
  .pf-danger-btn { border-color:var(--danger-border); color:var(--error-fg); background:var(--error-bg); }
  .pf-avatar { width:38px; height:38px; border-radius:999px; object-fit:cover; border:1px solid var(--border); background:var(--surface-2); }
  .pf-provider-main, .pf-session-main { display:flex; align-items:flex-start; gap:12px; }
  .pf-inline-list { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px; }
  .pf-conflict-box { margin-top:10px; padding:10px 12px; border-radius:12px; background:var(--surface-2); border:1px solid var(--border-subtle); }
  @media(max-width:600px){ .pf-provider-row, .pf-session-row { flex-direction:column; } .pf-provider-actions, .pf-session-actions { width:100%; } }
  @keyframes pf-notice-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
  .p-public-root.p-public-theme-light .pf-save { box-shadow:0 8px 18px var(--accent-border-subtle); }
  .p-public-root.p-public-theme-light .pf-notice-err { background:var(--error-bg); color:var(--error-fg); }
  .p-public-root.p-public-theme-light .pf-notice-ok { background:var(--positive-bg); color:var(--positive-fg); }
  .p-public-root.p-public-theme-light .pf-head { border-bottom-color:var(--border)!important; }
  .p-public-root.p-public-theme-light .pf-zone-title { color:var(--text-muted)!important; }
  .p-public-root.p-public-theme-light .pf-zone-copy-title { color:var(--text-primary)!important; }
  .p-public-root.p-public-theme-light .pf-zone-copy-sub { color:var(--text-secondary)!important; }
  .p-public-root.p-public-theme-light .pf-zone-link { background:var(--positive-bg)!important; border-color:var(--accent-border-subtle)!important; color:var(--accent-fg)!important; }
  @media(max-width:600px){ .pf-page { padding-top:12px!important; padding-bottom:20px!important; } .pf-head { margin-bottom:22px; padding-bottom:18px; } .pf-card { padding:20px; } .pf-grid { grid-template-columns:1fr; gap:14px; } .pf-actions { margin-top:20px; } .pf-zone { margin-top:24px; } .pf-zone-card { padding:18px; } }
`;

export default function PerfilPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [security, setSecurity] = useState<AccountSecurityOverview | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [disconnectingApple, setDisconnectingApple] = useState(false);
  const [disconnectingFacebook, setDisconnectingFacebook] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<'google' | 'apple' | 'facebook' | null>(null);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const [claimingClubId, setClaimingClubId] = useState<number | null>(null);
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
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(''), 3500);
    return () => window.clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    if (!authChecked || !user) return;
    let cancelled = false;
    setSecurityLoading(true);
    void (async () => {
      try {
        const overview = await getAccountSecurityOverview();
        if (!cancelled) setSecurity(overview);
      } catch (err: unknown) {
        if (!cancelled) setError(extractErrorMessage(err, 'No se pudo cargar la seguridad de la cuenta.'));
      } finally {
        if (!cancelled) setSecurityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authChecked, user]);

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
        ? 'Google OAuth no está configurado correctamente en este ambiente.'
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
        ? 'Apple OAuth no está configurado correctamente en este ambiente.'
        : oauthError === 'apple_state_invalid'
        ? 'La validación del acceso con Apple expiró o quedó inválida. Probá de nuevo.'
        : oauthError === 'facebook_access_denied'
        ? 'Cancelaste la conexión con Facebook antes de completarla.'
        : oauthError === 'facebook_email_unavailable'
        ? 'Facebook no devolvió un email usable para conectar esta cuenta.'
        : oauthError === 'facebook_already_linked'
        ? 'Esa cuenta de Facebook ya está vinculada a otro usuario de Pique.'
        : oauthError === 'facebook_not_configured'
        ? 'Facebook OAuth no está configurado correctamente en este ambiente.'
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
    setSuccess('');
    setError(message);
  }, [router.isReady, router.query.oauth_error, router.query.oauth_provider]);

  if (!authChecked || !user) {
    return <UserLoadingState mode="page" message={authChecked ? 'Redirigiendo...' : 'Validando sesión...'} />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    const firstName = String(form.firstName || '').trim();
    const lastName = String(form.lastName || '').trim();
    const phoneLocal = String(form.phoneLocal || '').replace(/[^\d]/g, '');
    const safeDni = String(form.dni || '').trim();

    if (!firstName || !lastName) {
      setError('Nombre y apellido son obligatorios.');
      return;
    }
    if (!phoneLocal) {
      setError('Ingresá un teléfono.');
      return;
    }
    if (safeDni && safeDni.length < 7) {
      setError('Si cargás DNI, debe tener al menos 7 dígitos.');
      return;
    }

    const canonicalPhone = buildCanonicalPhone({ countryIso2: form.phoneCountryIso2, localNumber: phoneLocal });
    if (!canonicalPhone) {
      setError('Número de teléfono inválido.');
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
      setSuccess('Cambios guardados.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo actualizar el perfil.'));
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
    setError('');
    setSuccess('');
    setDisconnectingGoogle(true);
    try {
      await disconnectGoogleOAuth();
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setSuccess('Google se desconectó de tu cuenta.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo desconectar Google.'));
    } finally {
      setDisconnectingGoogle(false);
    }
  };

  const handleDisconnectApple = async () => {
    setError('');
    setSuccess('');
    setDisconnectingApple(true);
    try {
      await disconnectAppleOAuth();
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setSuccess('Apple se desconectó de tu cuenta.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo desconectar Apple.'));
    } finally {
      setDisconnectingApple(false);
    }
  };

  const handleDisconnectFacebook = async () => {
    setError('');
    setSuccess('');
    setDisconnectingFacebook(true);
    try {
      await disconnectFacebookOAuth();
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setSuccess('Facebook se desconectó de tu cuenta.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo desconectar Facebook.'));
    } finally {
      setDisconnectingFacebook(false);
    }
  };

  const handleConnectProvider = (provider: 'google' | 'apple' | 'facebook') => {
    setError('');
    setSuccess('');
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
    setError('');
    setSuccess('');
    setLogoutAllLoading(true);
    try {
      await logoutAllSessions();
      logout({ reason: 'manual' });
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudieron cerrar todas las sesiones.'));
      setLogoutAllLoading(false);
    }
  };

  const handleClaimClubProfile = async (clubId: number) => {
    setError('');
    setSuccess('');
    setClaimingClubId(clubId);
    try {
      await claimClubProfile(clubId);
      const overview = await getAccountSecurityOverview();
      setSecurity(overview);
      setSuccess('Tu perfil del club quedó vinculado a tu cuenta.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo vincular tu perfil en este club.'));
    } finally {
      setClaimingClubId(null);
    }
  };

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

        {/* ── FORM CARD ── */}
        <div className="p-public-card pf-card">
          <form onSubmit={handleSubmit}>

            {/* Notices */}
            {error && (
              <div className="pf-notice pf-notice-err" style={{ marginBottom: 24 }} role="alert">
                <span>⚠</span> {error}
              </div>
            )}
            {success && (
              <div className="pf-notice pf-notice-ok" style={{ marginBottom: 24 }} role="status" aria-live="polite">
                <CheckCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {success}
              </div>
            )}

            <div className="pf-grid">

              {/* Nombre */}
              <div className="p-public-field">
                <div className="p-public-field-label">
                  <User size={12} /> Nombre
                </div>
                <input
                  className="p-public-input"
                  value={form.firstName}
                  onChange={(e) => setForm(p => ({ ...p, firstName: e.target.value }))}
                  placeholder="Tu nombre"
                />
              </div>

              {/* Apellido */}
              <div className="p-public-field">
                <div className="p-public-field-label">
                  <User size={12} /> Apellido
                </div>
                <input
                  className="p-public-input"
                  value={form.lastName}
                  onChange={(e) => setForm(p => ({ ...p, lastName: e.target.value }))}
                  placeholder="Tu apellido"
                />
              </div>

              {/* Email */}
              <div className="p-public-field pf-full">
                <div className="p-public-field-label">
                  <Mail size={12} /> Email (no editable)
                </div>
                <input
                  className="p-public-input"
                  value={form.email}
                  disabled
                />
              </div>

              {/* Teléfono */}
              <div className="p-public-field pf-full">
                <div className="p-public-field-label">
                  <Phone size={12} /> Teléfono
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <select
                    className="p-public-select"
                    value={form.phoneCountryIso2}
                    onChange={(e) => setForm(p => ({ ...p, phoneCountryIso2: normalizePhoneCountryIso2(e.target.value) }))}
                  >
                    {PHONE_COUNTRY_OPTIONS.map(opt => (
                      <option key={opt.iso2} value={opt.iso2}>{opt.callingCode} {opt.iso2}</option>
                    ))}
                  </select>
                  <input
                    className="p-public-input"
                    value={form.phoneLocal}
                    onChange={(e) => setForm(p => ({ ...p, phoneLocal: e.target.value.replace(/[^\d]/g, '') }))}
                    placeholder="Número local"
                  />
                </div>
              </div>

              {/* DNI */}
              <div className="p-public-field pf-full">
                <div className="p-public-field-label">
                  <IdCard size={12} /> DNI (opcional)
                </div>
                <input
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

        <div className="pf-zone">
          <div className="pf-zone-title" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 16 }}>Perfiles en clubes</div>
          <div className="p-public-card pf-security-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <LinkIcon size={16} />
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Mis perfiles</div>
            </div>
            <p className="pf-muted" style={{ marginTop: 0, marginBottom: 18 }}>
              Acá ves en qué clubes ya estás vinculado y cuándo podemos recuperar tu historial sin intervención manual.
            </p>

            {securityLoading ? (
              <p className="pf-muted" style={{ margin: 0 }}>Cargando perfiles de clubes...</p>
            ) : (
              <div className="pf-security-list">
                {(security?.clubProfiles || []).length > 0 ? (
                  security!.clubProfiles.map((profile) => (
                    <div className="pf-provider-row" key={profile.clubId}>
                      <div className="pf-provider-main">
                        <div className="pf-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <LinkIcon size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                            {profile.clubName}
                          </div>
                          <div className="pf-muted">{profile.reason}</div>
                          {formatMatchSignals(profile.matchedBy) ? (
                            <div className="pf-inline-list">
                              <span className="pf-chip">{formatMatchSignals(profile.matchedBy)}</span>
                            </div>
                          ) : null}
                          {profile.membershipRole ? (
                            <div className="pf-muted" style={{ marginTop: 4 }}>
                              Rol en el club: {profile.membershipRole}
                            </div>
                          ) : null}
                          {profile.status === 'CONFLICTED' && profile.conflictDetails ? (
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
                          ) : null}
                        </div>
                      </div>
                      <div className="pf-provider-actions">
                        <span className="pf-chip">
                          {profile.status === 'LINKED'
                            ? 'Vinculado'
                            : profile.status === 'CLAIMABLE'
                            ? 'Reclamable'
                            : profile.status === 'CONFLICTED'
                            ? 'Revisión necesaria'
                            : 'Sin vínculo'}
                        </span>
                        {profile.canClaim ? (
                          <button
                            type="button"
                            className="pf-secondary-btn"
                            disabled={claimingClubId === profile.clubId}
                            onClick={() => handleClaimClubProfile(profile.clubId)}
                          >
                            {claimingClubId === profile.clubId ? 'Vinculando...' : 'Vincular mi perfil'}
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
            <div className="p-public-card pf-security-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Shield size={16} />
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Accesos conectados</div>
              </div>
              <p className="pf-muted" style={{ marginTop: 0, marginBottom: 18 }}>
                Gestioná cómo entrás a tu cuenta de Pique. Podés conectar Google, Apple o Facebook desde acá, y seguir usando magic link por email cuando quieras.
              </p>

              {securityLoading ? (
                <p className="pf-muted" style={{ margin: 0 }}>Cargando accesos conectados...</p>
              ) : (
                <div className="pf-security-list">
                  <div className="pf-provider-row">
                    <div className="pf-provider-main">
                      {facebookIdentity?.profilePhotoUrl ? (
                        <img src={facebookIdentity.profilePhotoUrl} alt="Facebook profile" className="pf-avatar" />
                      ) : (
                        <div className="pf-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <LinkIcon size={16} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Facebook</div>
                        <div className="pf-muted">
                          {facebookIdentity
                            ? `Conectado como ${facebookIdentity.providerEmail || user.email}. Último uso: ${formatDateTime(facebookIdentity.lastLoginAt)}.`
                            : 'Todavía no conectaste Facebook a esta cuenta.'}
                        </div>
                      </div>
                    </div>
                    <div className="pf-provider-actions">
                      {facebookIdentity ? (
                        <>
                          <span className="pf-chip">{facebookIdentity.providerEmailVerified ? 'Email verificado' : 'Email sin verificar'}</span>
                          <button
                            type="button"
                            className="pf-secondary-btn pf-danger-btn"
                            disabled={disconnectingFacebook}
                            onClick={handleDisconnectFacebook}
                          >
                            {disconnectingFacebook ? 'Desconectando...' : 'Desconectar Facebook'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pf-secondary-btn"
                          disabled={connectingProvider !== null}
                          onClick={() => handleConnectProvider('facebook')}
                        >
                          {connectingProvider === 'facebook' ? 'Conectando...' : 'Conectar Facebook'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pf-provider-row">
                    <div className="pf-provider-main">
                      <div className="pf-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <LinkIcon size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Apple</div>
                        <div className="pf-muted">
                          {appleIdentity
                            ? `Conectado como ${appleIdentity.providerEmail || user.email}. Último uso: ${formatDateTime(appleIdentity.lastLoginAt)}.`
                            : 'Todavía no conectaste Apple a esta cuenta.'}
                        </div>
                      </div>
                    </div>
                    <div className="pf-provider-actions">
                      {appleIdentity ? (
                        <>
                          <span className="pf-chip">{appleIdentity.providerEmailVerified ? 'Email verificado' : 'Email sin verificar'}</span>
                          <button
                            type="button"
                            className="pf-secondary-btn pf-danger-btn"
                            disabled={disconnectingApple}
                            onClick={handleDisconnectApple}
                          >
                            {disconnectingApple ? 'Desconectando...' : 'Desconectar Apple'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pf-secondary-btn"
                          disabled={connectingProvider !== null}
                          onClick={() => handleConnectProvider('apple')}
                        >
                          {connectingProvider === 'apple' ? 'Conectando...' : 'Conectar Apple'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pf-provider-row">
                    <div className="pf-provider-main">
                      {googleIdentity?.profilePhotoUrl ? (
                        <img src={googleIdentity.profilePhotoUrl} alt="Google profile" className="pf-avatar" />
                      ) : (
                        <div className="pf-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <LinkIcon size={16} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>Google</div>
                        <div className="pf-muted">
                          {googleIdentity
                            ? `Conectado como ${googleIdentity.providerEmail || user.email}. Último uso: ${formatDateTime(googleIdentity.lastLoginAt)}.`
                            : 'Todavía no conectaste Google a esta cuenta.'}
                        </div>
                      </div>
                    </div>
                    <div className="pf-provider-actions">
                      {googleIdentity ? (
                        <>
                          <span className="pf-chip">{googleIdentity.providerEmailVerified ? 'Email verificado' : 'Email sin verificar'}</span>
                          <button
                            type="button"
                            className="pf-secondary-btn pf-danger-btn"
                            disabled={disconnectingGoogle}
                            onClick={handleDisconnectGoogle}
                          >
                            {disconnectingGoogle ? 'Desconectando...' : 'Desconectar Google'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pf-secondary-btn"
                          disabled={connectingProvider !== null}
                          onClick={() => handleConnectProvider('google')}
                        >
                          {connectingProvider === 'google' ? 'Conectando...' : 'Conectar Google'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-public-card pf-security-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Smartphone size={16} />
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Sesiones activas</div>
              </div>
              <p className="pf-muted" style={{ marginTop: 0, marginBottom: 18 }}>
                Revisá en qué dispositivos seguís con sesión abierta y cerrá todas las sesiones si lo necesitás.
              </p>

              {securityLoading ? (
                <p className="pf-muted" style={{ margin: 0 }}>Cargando sesiones activas...</p>
              ) : (
                <>
                  <div className="pf-security-list">
                    {(security?.sessions || []).length > 0 ? (
                      security!.sessions.map((session) => (
                        <div className="pf-session-row" key={session.id}>
                          <div className="pf-session-main">
                            <div className="pf-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Smartphone size={16} />
                            </div>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                                {session.isCurrent ? 'Este dispositivo' : 'Otro dispositivo'}
                              </div>
                              <div className="pf-muted">
                                Última actividad: {formatDateTime(session.lastSeenAt)}. Abierta desde {formatDateTime(session.createdAt)}.
                              </div>
                              {session.userAgent ? (
                                <div className="pf-muted" style={{ marginTop: 4 }}>
                                  {session.userAgent}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="pf-session-actions">
                            {session.isCurrent ? <span className="pf-pill">Actual</span> : null}
                            <span className="pf-chip">Expira {formatDateTime(session.expiresAt)}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="pf-muted" style={{ margin: 0 }}>No encontramos sesiones activas para mostrar.</p>
                    )}
                  </div>

                  <div style={{ marginTop: 18 }}>
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

        {/* ── DANGER ZONE ── */}
        <div className="pf-zone">
          <div className="pf-zone-title" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', color: 'var(--text-muted)', marginBottom: 16 }}>Zona de cuenta</div>
          <div className="p-public-card pf-zone-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div className="pf-zone-copy-title" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Tus reservas activas</div>
                <div className="pf-zone-copy-sub" style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>Revisá el estado de todas tus reservas en un solo lugar.</div>
              </div>
              <Link
                href="/bookings"
                className="pf-zone-link"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--positive-bg)', border: '1px solid var(--accent-border-subtle)', borderRadius: 999, color: 'var(--brand)', fontSize: 13, fontWeight: 700, textDecoration: 'none', transition: 'background .15s' }}
              >
                Ver reservas →
              </Link>
            </div>
          </div>
        </div>

      </div>
    </DarkPageLayout>
  );
}
