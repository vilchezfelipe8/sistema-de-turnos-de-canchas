import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { beginAppleOAuthLogin, beginFacebookOAuthLogin, beginGoogleOAuthLogin, login, register, requestMagicLink, verifyMagicLink } from '../services/AuthService';
import { ClubService } from '../services/ClubService';
import { Mail, Lock, User, Phone, UserPlus, LogIn, AlertCircle, Loader2, IdCard, CheckCircle, Eye, EyeOff, Zap, Moon, Sun, ArrowLeft } from 'lucide-react';
import { getActiveClubSlug, hasOperatorAccess, normalizeSessionUser } from '../utils/session';
import { buildCanonicalPhone, DEFAULT_PHONE_COUNTRY_ISO2, normalizePhoneCountryIso2, PHONE_COUNTRY_OPTIONS, resolveCallingCodeByIso2 } from '../utils/phone';
import { useAuth } from '../contexts/AuthContext';
import { useUserTheme } from '../contexts/UserThemeContext';
import PiqueLogo from '../components/PiqueLogo';
import { extractErrorMessage } from '../utils/uiError';

type PostLoginRedirectIntent = { sourceUser?: any };

const FONT = "var(--font-sans)";

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.72 1.22 9.23 3.61l6.9-6.9C35.95 2.34 30.45 0 24 0 14.64 0 6.55 5.38 2.56 13.22l8.04 6.24C12.5 13.63 17.77 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.55c0-1.64-.15-3.21-.41-4.73H24v8.95h12.64c-.55 2.96-2.23 5.46-4.75 7.14l7.31 5.68C43.84 37.31 46.5 31.54 46.5 24.55z" />
      <path fill="#FBBC05" d="M10.6 28.54A14.36 14.36 0 0 1 9.84 24c0-1.58.27-3.11.76-4.54l-8.04-6.24A24.03 24.03 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l8.04-6.24z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.92-2.13 15.89-5.8l-7.31-5.68c-2.03 1.36-4.62 2.17-8.58 2.17-6.23 0-11.5-4.13-13.4-9.96l-8.04 6.24C6.55 42.62 14.64 48 24 48z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.02 12.85c.03 3.18 2.8 4.24 2.83 4.26-.02.07-.44 1.51-1.45 2.99-.87 1.28-1.77 2.55-3.2 2.58-1.4.03-1.85-.83-3.45-.83-1.61 0-2.1.8-3.42.86-1.38.05-2.43-1.39-3.31-2.66-1.8-2.6-3.17-7.34-1.33-10.54.91-1.59 2.54-2.6 4.3-2.63 1.34-.03 2.61.91 3.45.91.84 0 2.41-1.12 4.07-.96.69.03 2.64.28 3.88 2.1-.1.06-2.32 1.35-2.37 3.92ZM13.73 5.31c.73-.88 1.23-2.1 1.1-3.31-1.05.04-2.31.7-3.06 1.58-.67.78-1.26 2.02-1.1 3.21 1.17.09 2.34-.59 3.06-1.48Z"
      />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.03 4.39 11.03 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.98h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07Z"
      />
    </svg>
  );
}

const LOGIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; }
  .lg-root { min-height:100vh; background:var(--bg); font-family:${FONT}; display:flex; align-items:center; justify-content:center; padding:56px 20px 20px; position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  .lg-root::before { content:''; position:fixed; inset:0; background:radial-gradient(ellipse 70% 60% at 20% 110%,var(--accent-bg-soft),transparent 65%), radial-gradient(ellipse 50% 40% at 85% -10%,var(--accent-bg-faint),transparent 60%); pointer-events:none; }
  .lg-screen-nav { position:absolute; top:18px; left:20px; display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:.02em; color:var(--text-muted); text-decoration:none; transition:color .15s, transform .15s; z-index:2; }
  .lg-screen-nav:hover { color:var(--accent-fg); transform:translateX(-1px); }
  .lg-card { width:100%; max-width:420px; background:var(--surface-1); border:1px solid var(--border); border-radius:24px; box-shadow:0 24px 64px var(--shadow-lg); overflow:hidden; position:relative; z-index:1; animation:lg-scalein .25s ease; }
  @keyframes lg-scalein { from{opacity:0;transform:scale(.97) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
  .lg-header { padding:24px 28px 20px; text-align:center; border-bottom:1px solid var(--border-subtle); }
  .lg-brand-link { display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px; }
  .lg-title { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.03em; margin:0 0 4px; }
  .lg-sub { font-size:11px; font-weight:600; letter-spacing:.03em; color:var(--text-muted); margin:0; }
  .lg-body { padding:20px 28px 24px; display:flex; flex-direction:column; gap:14px; }
  .lg-notice { display:flex; align-items:flex-start; gap:10px; padding:12px 16px; border-radius:12px; font-size:13px; font-weight:600; line-height:1.5; }
  .lg-err { background:var(--error-bg); border:1px solid var(--danger-border); color:var(--error-fg); }
  .lg-ok { background:var(--accent-bg-soft); border:1px solid var(--accent-bg-muted); color:var(--brand-hover); }
  .lg-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px 12px; }
  .lg-full { grid-column:1 / -1; }
  .lg-field { display:flex; flex-direction:column; gap:5px; }
  .lg-label { font-size:10px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); }
  .lg-input-wrap { position:relative; display:flex; align-items:center; }
  .lg-input-icon { position:absolute; left:13px; color:var(--text-muted); display:flex; pointer-events:none; }
  .lg-input { width:100%; padding:10px 14px 10px 38px; background:var(--surface-2); border:1px solid var(--border); border-radius:12px; color:var(--text-primary); font-family:${FONT}; font-size:14px; font-weight:600; outline:none; transition:border-color .2s, box-shadow .2s; }
  .lg-input:focus { border-color:var(--accent-border-strong); box-shadow:0 0 0 3px var(--accent-bg-soft); }
  .lg-input::placeholder { color:var(--text-muted); font-weight:400; }
  .lg-input-no-icon { padding-left:14px; }
  .lg-eye-btn { position:absolute; right:12px; background:none; border:none; cursor:pointer; color:var(--text-muted); display:flex; align-items:center; padding:4px; transition:color .15s; }
  .lg-eye-btn:hover { color:var(--text-secondary); }
  .lg-phone-wrap { display:flex; background:var(--surface-2); border:1px solid var(--border); border-radius:12px; overflow:hidden; transition:border-color .2s, box-shadow .2s; }
  .lg-phone-wrap:focus-within { border-color:var(--accent-border-strong); box-shadow:0 0 0 3px var(--accent-bg-soft); }
  .lg-phone-prefix { display:flex; align-items:center; gap:8px; padding:0 12px; background:var(--surface-2); border-right:1px solid var(--border-subtle); flex-shrink:0; }
  .lg-phone-select { background:transparent; border:none; color:var(--text-secondary); font-family:${FONT}; font-size:13px; font-weight:700; outline:none; }
  .lg-phone-input { flex:1; padding:10px 14px; background:transparent; border:none; color:var(--text-primary); font-family:${FONT}; font-size:14px; font-weight:600; outline:none; }
  .lg-phone-input::placeholder { color:var(--text-muted); font-weight:400; }
  .lg-divider { display:flex; align-items:center; gap:12px; }
  .lg-divider-line { flex:1; height:1px; background:var(--border-subtle); }
  .lg-divider-text { font-size:10px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); }
  .lg-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:9px 18px; border-radius:12px; font-family:${FONT}; font-size:13px; font-weight:800; letter-spacing:.01em; cursor:pointer; border:none; transition:background .15s, transform .15s, opacity .15s; }
  .lg-btn:disabled { opacity:.5; cursor:not-allowed; }
  .lg-btn-loading { position:relative; }
  .lg-btn-loading-content { display:inline-flex; align-items:center; justify-content:center; gap:8px; }
  .lg-btn-loading-content[aria-hidden="true"] { visibility:hidden; }
  .lg-btn-loading-indicator { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; }
  .lg-btn-primary { background:var(--brand); color:var(--brand-on); }
  .lg-btn-primary:hover:not(:disabled) { background:var(--brand-hover); transform:translateY(-1px); }
  .lg-btn-ghost { background:var(--surface-2); border:1px solid var(--border)!important; color:var(--text-muted); }
  .lg-btn-ghost:hover:not(:disabled) { background:var(--surface-3); color:var(--text-secondary); }
  .lg-btn-social { justify-content:flex-start; padding-left:16px; letter-spacing:.03em; text-transform:none; font-size:14px; }
  .lg-btn-google-mark { width:30px; height:30px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; background:rgba(255,255,255,.92); border:1px solid rgba(255,255,255,.68); box-shadow:0 1px 0 rgba(255,255,255,.35) inset; }
  .lg-form { display:flex; flex-direction:column; gap:12px; }
  .lg-toggle { text-align:center; padding-top:14px; border-top:1px solid var(--border-subtle); }
  .lg-toggle-btn { background:none; border:none; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:.03em; color:var(--text-muted); cursor:pointer; transition:color .15s; text-decoration:underline; text-decoration-color:transparent; text-underline-offset:3px; }
  .lg-toggle-btn:hover { color:var(--accent-fg); text-decoration-color:var(--accent-fg); }
  .lg-theme-toggle { position:absolute; top:18px; right:20px; width:38px; height:38px; display:grid; place-items:center; border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary); border-radius:999px; padding:0; cursor:pointer; z-index:2; transition:background .15s,border-color .15s,color .15s; }
  .lg-theme-toggle:hover { background:var(--surface-3); color:var(--text-primary); border-color:var(--border-strong); }
  .lg-root.lg-theme-light { background:var(--bg); }
  .lg-root.lg-theme-light::before { background:radial-gradient(ellipse 70% 60% at 20% 110%,var(--accent-bg-muted),transparent 65%), radial-gradient(ellipse 50% 40% at 85% -10%,var(--accent-bg-faint),transparent 60%); }
  .lg-root.lg-theme-light .lg-card { background:var(--surface-1); border-color:var(--border); box-shadow:var(--shadow-lg); }
  .lg-root.lg-theme-light .lg-header { border-bottom-color:var(--border-subtle); }
  .lg-root.lg-theme-light .lg-title { color:var(--text-primary); }
  .lg-root.lg-theme-light .lg-sub { color:var(--text-muted); }
  .lg-root.lg-theme-light .lg-label { color:var(--text-muted); }
  .lg-root.lg-theme-light .lg-input,
  .lg-root.lg-theme-light .lg-phone-wrap { background:var(--surface-1); border-color:var(--border); color:var(--text-primary); }
  .lg-root.lg-theme-light .lg-input::placeholder,
  .lg-root.lg-theme-light .lg-phone-input::placeholder { color:var(--text-muted); }
  .lg-root.lg-theme-light .lg-input-icon,
  .lg-root.lg-theme-light .lg-eye-btn { color:var(--text-muted); }
  .lg-root.lg-theme-light .lg-phone-prefix { background:var(--surface-2); border-right-color:var(--border-subtle); }
  .lg-root.lg-theme-light .lg-phone-select { color:var(--text-primary); }
  .lg-root.lg-theme-light .lg-phone-input { color:var(--text-primary); }
  .lg-root.lg-theme-light .lg-divider-line { background:var(--border-subtle); }
  .lg-root.lg-theme-light .lg-divider-text { color:var(--text-muted); }
  .lg-root.lg-theme-light .lg-btn-ghost { background:var(--surface-2); border-color:var(--border)!important; color:var(--text-secondary); }
  .lg-root.lg-theme-light .lg-btn-ghost:hover:not(:disabled) { background:var(--border-subtle); color:var(--text-primary); }
  .lg-root.lg-theme-light .lg-btn-google-mark { background:#fff; border-color:#ece9e1; box-shadow:0 1px 0 rgba(255,255,255,.7) inset; }
  .lg-root.lg-theme-light .lg-toggle { border-top-color:var(--border-subtle); }
  .lg-root.lg-theme-light .lg-toggle-btn { color:var(--text-secondary); }
  .lg-root.lg-theme-light .lg-theme-toggle { border-color:var(--border); background:var(--surface-1); color:var(--text-secondary); }
  .lg-root.lg-theme-light .lg-theme-toggle:hover { background:var(--surface-1); color:var(--text-primary); border-color:var(--border-strong); }
  @media(max-width:480px) { .lg-root { padding:60px 16px 16px; } .lg-screen-nav { top:18px; left:16px; } .lg-grid2 { grid-template-columns:1fr; } .lg-header { padding:22px 24px 18px; } .lg-brand-link { margin-bottom:12px; } .lg-body { padding:18px 24px 22px; gap:12px; } .lg-form { gap:10px; } }
  @media(max-height:820px) and (min-width:481px) { .lg-root { padding-top:48px; padding-bottom:16px; } .lg-screen-nav { top:16px; } .lg-header { padding:20px 24px 18px; } .lg-brand-link { margin-bottom:12px; } .lg-title { font-size:20px; } .lg-body { padding:18px 24px 22px; gap:12px; } .lg-form { gap:10px; } .lg-grid2 { gap:8px 10px; } .lg-field { gap:4px; } .lg-input { padding-top:9px; padding-bottom:9px; } .lg-phone-input { padding-top:9px; padding-bottom:9px; } .lg-toggle { padding-top:12px; } }
`;

export default function LoginPage() {
  const router = useRouter();
  const { isLight, toggleTheme } = useUserTheme();
  const { status, user: authUser, revalidateSession } = useAuth();
  const returnTo =
    typeof router.query.from === 'string' &&
    router.query.from.startsWith('/') &&
    !router.query.from.startsWith('//')
      ? router.query.from
      : null;
  const openRegisterMode =
    router.query.mode === 'register' ||
    router.query.view === 'register' ||
    router.query.register === '1' ||
    router.query.register === 'true';

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCountryIso2, setPhoneCountryIso2] = useState(DEFAULT_PHONE_COUNTRY_ISO2);
  const [dni, setDni] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | 'facebook' | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [redirectIntent, setRedirectIntent] = useState<PostLoginRedirectIntent | null>(null);
  const redirectingRef = useRef(false);

  const resolvePostLoginDestination = useCallback(async (sourceUser?: any) => {
    const normalizedUser = normalizeSessionUser(sourceUser || authUser);
    const safeReturnTo =
      returnTo && returnTo !== '/login' && !returnTo.startsWith('/login?') && !returnTo.startsWith('/login#')
        ? returnTo
        : null;
    if (hasOperatorAccess(normalizedUser)) return '/admin/agenda';
    if (safeReturnTo) return safeReturnTo;
    const activeSlug = getActiveClubSlug(normalizedUser);
    if (activeSlug) return `/club/${activeSlug}`;
    const activeClubId = Number(normalizedUser?.activeClubId || normalizedUser?.clubId || normalizedUser?.club?.id || 0);
    if (Number.isInteger(activeClubId) && activeClubId > 0) {
      try {
        const club = await ClubService.getClubById(activeClubId);
        if (club?.slug) return `/club/${club.slug}`;
      } catch {}
    }
    return '/';
  }, [authUser, returnTo]);

  const navigateAfterAuth = useCallback(async (sourceUser?: any) => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    try {
      const target = await resolvePostLoginDestination(sourceUser);
      await router.replace(target);
    } finally {
      window.setTimeout(() => { redirectingRef.current = false; }, 250);
    }
  }, [resolvePostLoginDestination, router]);

  useEffect(() => { setIsLogin(!openRegisterMode); }, [openRegisterMode]);

  useEffect(() => {
    if (router.pathname !== '/login') return;
    if (loading || magicLoading || oauthLoading) return;
    if (!redirectIntent && status === 'authenticated') { setRedirectIntent({ sourceUser: authUser }); return; }
    if (!redirectIntent) return;
    void navigateAfterAuth(redirectIntent.sourceUser || authUser).finally(() => setRedirectIntent(null));
  }, [authUser, loading, magicLoading, navigateAfterAuth, oauthLoading, redirectIntent, router.pathname, status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userRaw = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        const parsedUser = userRaw ? normalizeSessionUser(JSON.parse(userRaw)) : null;
        const activeClubId = Number(parsedUser?.activeClubId || parsedUser?.clubId || parsedUser?.club?.id || 0);
        if (!Number.isInteger(activeClubId) || activeClubId <= 0) return;
        const club = await ClubService.getClubById(activeClubId);
        if (!cancelled) setPhoneCountryIso2(normalizePhoneCountryIso2(club?.country));
      } catch {
        if (!cancelled) setPhoneCountryIso2(DEFAULT_PHONE_COUNTRY_ISO2);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!rawHash) return;
    const hashParams = new URLSearchParams(rawHash);
    const magicToken = String(hashParams.get('magic_token') || '').trim();
    const magicError = String(hashParams.get('magic_error') || '').trim();
    if (!magicToken && !magicError) return;
    const clearHash = () => window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    if (magicError) {
      clearHash();
      setIsLogin(true);
      setError(magicError === 'internal_error' ? 'No se pudo validar el enlace en este momento. Probá nuevamente.' : 'El enlace es inválido, ya se usó o expiró. Solicitá uno nuevo.');
      return;
    }
    let cancelled = false;
    setIsLogin(true); setLoading(true); setError(''); setSuccessMessage('');
    (async () => {
      try {
        const data = await verifyMagicLink(magicToken);
        if (cancelled) return;
        await revalidateSession();
        setRedirectIntent({ sourceUser: data?.user });
      } catch (err: unknown) {
        if (!cancelled) setError(extractErrorMessage(err, 'No se pudo iniciar sesión con el enlace.'));
      } finally {
        if (!cancelled) setLoading(false);
        clearHash();
      }
    })();
    return () => { cancelled = true; };
  }, [navigateAfterAuth, revalidateSession, returnTo, router]);

  useEffect(() => {
    if (!router.isReady) return;
    const oauthError = typeof router.query.oauth_error === 'string' ? router.query.oauth_error : '';
    const oauthProvider = typeof router.query.oauth_provider === 'string' ? router.query.oauth_provider : '';
    if (!oauthError) return;

    const message =
      oauthError === 'google_access_denied'
        ? 'Cancelaste el acceso con Google antes de completar el ingreso.'
        : oauthError === 'google_email_unavailable'
        ? 'Google no devolvió un email usable para esta cuenta.'
        : oauthError === 'google_email_unverified'
        ? 'La cuenta de Google no devolvió un email verificado. Probá con otra cuenta.'
        : oauthError === 'google_not_configured'
        ? 'Google OAuth no está configurado correctamente en este ambiente.'
        : oauthError === 'google_state_invalid'
        ? 'La validación del acceso con Google expiró o quedó inválida. Probá de nuevo.'
        : oauthError === 'apple_access_denied'
        ? 'Cancelaste el acceso con Apple antes de completar el ingreso.'
        : oauthError === 'apple_email_unavailable'
        ? 'Apple no devolvió un email usable para esta cuenta.'
        : oauthError === 'apple_email_unverified'
        ? 'La cuenta de Apple no devolvió un email verificado. Probá con otra cuenta.'
        : oauthError === 'apple_not_configured'
        ? 'Apple OAuth no está configurado correctamente en este ambiente.'
        : oauthError === 'apple_state_invalid'
        ? 'La validación del acceso con Apple expiró o quedó inválida. Probá de nuevo.'
        : oauthError === 'facebook_access_denied'
        ? 'Cancelaste el acceso con Facebook antes de completar el ingreso.'
        : oauthError === 'facebook_email_unavailable'
        ? 'Facebook no devolvió un email usable para esta cuenta.'
        : oauthError === 'facebook_not_configured'
        ? 'Facebook OAuth no está configurado correctamente en este ambiente.'
        : oauthError === 'facebook_state_invalid'
        ? 'La validación del acceso con Facebook expiró o quedó inválida. Probá de nuevo.'
        : oauthProvider === 'apple'
        ? 'No se pudo completar el ingreso con Apple.'
        : oauthProvider === 'facebook'
        ? 'No se pudo completar el ingreso con Facebook.'
        : 'No se pudo completar el ingreso con Google.';

    setIsLogin(true);
    setSuccessMessage('');
    setError(message);
    setOauthLoading(null);
  }, [router.isReady, router.query.oauth_error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccessMessage(''); setLoading(true);
    try {
      if (isLogin) {
        const data = await login(email, password);
        await revalidateSession();
        setRedirectIntent({ sourceUser: data?.user });
      } else {
        const localPhone = String(phoneNumber || '').replace(/[^\d]/g, '');
        const fullPhone = buildCanonicalPhone({ countryIso2: phoneCountryIso2, localNumber: localPhone });
        if (!localPhone) { setError('Ingresá un teléfono para completar el registro.'); return; }
        if (!fullPhone) { setError('Ingresá un teléfono con formato válido.'); return; }
        const safeDni = String(dni || '').trim();
        if (safeDni && safeDni.length < 7) { setError('Si cargás DNI, debe tener al menos 7 dígitos.'); return; }
        await register(firstName, lastName, email, password, fullPhone, 'MEMBER', safeDni || undefined, resolveCallingCodeByIso2(phoneCountryIso2), localPhone);
        setSuccessMessage('Usuario registrado exitosamente. Ahora podés iniciar sesión.');
        setIsLogin(true);
        setFirstName(''); setLastName(''); setPhoneNumber(''); setDni('');
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, isLogin ? 'No se pudo iniciar sesión.' : 'No se pudo crear la cuenta.'));
    } finally { setLoading(false); }
  };

  const handleRequestMagicLink = async () => {
    const safeEmail = String(email || '').trim();
    if (!safeEmail) { setError('Ingresá tu correo para enviarte el enlace.'); return; }
    setError(''); setSuccessMessage(''); setMagicLoading(true);
    try {
      const data = await requestMagicLink(safeEmail);
      setSuccessMessage(data?.message || 'Si el email es válido, te enviamos un enlace para ingresar.');
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'No se pudo enviar el enlace en este momento.'));
    } finally { setMagicLoading(false); }
  };

  const handleGoogleLogin = () => {
    setError('');
    setSuccessMessage('');
    setOauthLoading('google');
    beginGoogleOAuthLogin(returnTo);
  };

  const handleAppleLogin = () => {
    setError('');
    setSuccessMessage('');
    setOauthLoading('apple');
    beginAppleOAuthLogin(returnTo);
  };

  const handleFacebookLogin = () => {
    setError('');
    setSuccessMessage('');
    setOauthLoading('facebook');
    beginFacebookOAuthLogin(returnTo);
  };

  return (
    <>
      <Head>
        <title>{isLogin ? 'Ingresar' : 'Crear cuenta'} | Pique</title>
      </Head>
      <style dangerouslySetInnerHTML={{ __html: LOGIN_CSS }} />

      <div className={`lg-root${isLight ? ' lg-theme-light' : ''}`}>
        <Link href="/" className="lg-screen-nav">
          <ArrowLeft size={13} />
          <span>Volver al inicio</span>
        </Link>
        <button
          type="button"
          className="lg-theme-toggle"
          onClick={toggleTheme}
          aria-label={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
          title={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
        >
          {isLight ? <Moon size={15} /> : <Sun size={15} />}
        </button>

        <div className="lg-card">

          {/* Header */}
          <div className="lg-header">
            <Link href="/" className="lg-brand-link" aria-label="pique - inicio">
              <PiqueLogo
                variant={isLight ? 'horizontal' : 'horizontalDark'}
                style={{ width: 92, height: 'auto', display: 'block' }}
              />
            </Link>
            <h1 className="lg-title">{isLogin ? 'Bienvenido' : 'Crear cuenta'}</h1>
            <p className="lg-sub">{isLogin ? 'Ingresá a tu cuenta' : 'Sumate en segundos'}</p>
          </div>

          {/* Body */}
          <div className="lg-body">

            {/* Error */}
            {error && (
              <div className="lg-notice lg-err">
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            {/* Success */}
            {successMessage && (
              <div className="lg-notice lg-ok">
                <CheckCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{successMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="lg-form">

              {isLogin && (
                <>
                  <button
                    type="button"
                    onClick={handleFacebookLogin}
                    disabled={loading || magicLoading || Boolean(oauthLoading)}
                    className="lg-btn lg-btn-ghost lg-btn-loading"
                  >
                    <span className="lg-btn-loading-content" aria-hidden={oauthLoading === 'facebook'}>
                      <span className="lg-btn-google-mark" style={{ color: '#1877F2' }}><FacebookMark /></span>
                      <span>Continuar con Facebook</span>
                    </span>
                    {oauthLoading === 'facebook' && (
                      <span className="lg-btn-loading-indicator">
                        <Loader2 size={15} style={{ animation: 'lg-spin .8s linear infinite' }} />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleAppleLogin}
                    disabled={loading || magicLoading || Boolean(oauthLoading)}
                    className="lg-btn lg-btn-ghost lg-btn-loading"
                  >
                    <span className="lg-btn-loading-content" aria-hidden={oauthLoading === 'apple'}>
                      <span className="lg-btn-google-mark" style={{ color: 'var(--text-primary)' }}><AppleMark /></span>
                      <span>Continuar con Apple</span>
                    </span>
                    {oauthLoading === 'apple' && (
                      <span className="lg-btn-loading-indicator">
                        <Loader2 size={15} style={{ animation: 'lg-spin .8s linear infinite' }} />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={loading || magicLoading || Boolean(oauthLoading)}
                    className="lg-btn lg-btn-ghost lg-btn-loading"
                  >
                    <span className="lg-btn-loading-content" aria-hidden={oauthLoading === 'google'}>
                      <span className="lg-btn-google-mark"><GoogleMark /></span>
                      <span>Continuar con Google</span>
                    </span>
                    {oauthLoading === 'google' && (
                      <span className="lg-btn-loading-indicator">
                        <Loader2 size={15} style={{ animation: 'lg-spin .8s linear infinite' }} />
                      </span>
                    )}
                  </button>

                  <div className="lg-divider">
                    <div className="lg-divider-line" />
                    <span className="lg-divider-text">o con email</span>
                    <div className="lg-divider-line" />
                  </div>
                </>
              )}

              {/* Register fields */}
              {!isLogin && (
                <div className="lg-grid2">
                  {/* Nombre */}
                  <div className="lg-field">
                    <label className="lg-label">Nombre</label>
                    <div className="lg-input-wrap">
                      <span className="lg-input-icon"><User size={14} /></span>
                      <input type="text" required value={firstName} onChange={e => setFirstName(e.target.value)} className="lg-input" placeholder="Ej: Juan" />
                    </div>
                  </div>
                  {/* Apellido */}
                  <div className="lg-field">
                    <label className="lg-label">Apellido</label>
                    <div className="lg-input-wrap">
                      <span className="lg-input-icon"><User size={14} /></span>
                      <input type="text" required value={lastName} onChange={e => setLastName(e.target.value)} className="lg-input" placeholder="Ej: Pérez" />
                    </div>
                  </div>
                  {/* DNI */}
                  <div className="lg-field lg-full">
                    <label className="lg-label">DNI <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(opcional)</span></label>
                    <div className="lg-input-wrap">
                      <span className="lg-input-icon"><IdCard size={14} /></span>
                      <input type="number" value={dni} onChange={e => setDni(e.target.value)} className="lg-input" placeholder="Ej: 35123456" />
                    </div>
                  </div>
                  {/* Teléfono */}
                  <div className="lg-field lg-full">
                    <label className="lg-label">Teléfono</label>
                    <div className="lg-phone-wrap">
                      <div className="lg-phone-prefix">
                        <Phone size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <select
                          value={phoneCountryIso2}
                          onChange={e => setPhoneCountryIso2(normalizePhoneCountryIso2(e.target.value))}
                          className="lg-phone-select"
                        >
                          {PHONE_COUNTRY_OPTIONS.map(opt => (
                            <option key={opt.iso2} value={opt.iso2}>{opt.callingCode} {opt.iso2}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="tel"
                        required
                        maxLength={20}
                        value={phoneNumber}
                        onChange={e => setPhoneNumber(e.target.value.replace(/[^\d]/g, ''))}
                        className="lg-phone-input"
                        placeholder="Número local"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Email */}
              <div className="lg-field">
                <label className="lg-label">Correo electrónico</label>
                <div className="lg-input-wrap">
                  <span className="lg-input-icon"><Mail size={14} /></span>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="lg-input" placeholder="tu@email.com" autoComplete="email" />
                </div>
              </div>

              {/* Password */}
              <div className="lg-field">
                <label className="lg-label">Contraseña</label>
                <div className="lg-input-wrap">
                  <span className="lg-input-icon"><Lock size={14} /></span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required={isLogin}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="lg-input"
                    placeholder="••••••••"
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    style={{ paddingRight: 42 }}
                  />
                  <button
                    type="button"
                    className="lg-eye-btn"
                    aria-label="Ver contraseña"
                    onMouseDown={() => setShowPassword(true)}
                    onMouseUp={() => setShowPassword(false)}
                    onMouseLeave={() => setShowPassword(false)}
                    onTouchStart={() => setShowPassword(true)}
                    onTouchEnd={() => setShowPassword(false)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button type="submit" disabled={loading || Boolean(oauthLoading)} className="lg-btn lg-btn-primary" style={{ marginTop: 4 }}>
                {loading
                  ? <><Loader2 size={15} style={{ animation: 'lg-spin .8s linear infinite' }} /> Procesando...</>
                  : isLogin
                  ? <><LogIn size={15} /> Ingresar</>
                  : <><UserPlus size={15} /> Crear cuenta</>
                }
              </button>

              {/* Magic link (login only) */}
              {isLogin && (
                <>
                  <div className="lg-divider">
                    <div className="lg-divider-line" />
                    <span className="lg-divider-text">o</span>
                    <div className="lg-divider-line" />
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestMagicLink}
                    disabled={magicLoading || loading || Boolean(oauthLoading) || !String(email || '').trim()}
                    className="lg-btn lg-btn-ghost"
                  >
                    {magicLoading
                      ? <><Loader2 size={15} style={{ animation: 'lg-spin .8s linear infinite' }} /> Enviando...</>
                      : <><Zap size={15} /> Enviar enlace de acceso</>
                    }
                  </button>
                </>
              )}

            </form>

            {/* Toggle login/register */}
            <div className="lg-toggle">
              <button
                type="button"
                className="lg-toggle-btn"
                onClick={() => { setIsLogin(!isLogin); setError(''); setSuccessMessage(''); }}
              >
                {isLogin ? '¿No tenés cuenta? Registrate gratis' : '¿Ya tenés cuenta? Iniciá sesión'}
              </button>
            </div>

          </div>
        </div>

        <style>{`@keyframes lg-spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </>
  );
}
