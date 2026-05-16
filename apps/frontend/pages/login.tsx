import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { login, register, requestMagicLink, verifyMagicLink } from '../services/AuthService';
import { ClubService } from '../services/ClubService';
import { Mail, Lock, User, Phone, UserPlus, LogIn, AlertCircle, Loader2, IdCard, CheckCircle, Eye, EyeOff, Zap } from 'lucide-react';
import { getActiveClubSlug, hasOperatorAccess, normalizeSessionUser } from '../utils/session';
import { buildCanonicalPhone, DEFAULT_PHONE_COUNTRY_ISO2, normalizePhoneCountryIso2, PHONE_COUNTRY_OPTIONS, resolveCallingCodeByIso2 } from '../utils/phone';
import { useAuth } from '../contexts/AuthContext';
import { useUserTheme } from '../contexts/UserThemeContext';
import PiqueLogo from '../components/PiqueLogo';

type PostLoginRedirectIntent = { sourceUser?: any };

const FONT = "var(--font-sans)";

const LOGIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; }
  .lg-root { min-height:100vh; background:var(--bg); font-family:${FONT}; display:flex; align-items:center; justify-content:center; padding:24px; position:relative; overflow:hidden; -webkit-font-smoothing:antialiased; }
  .lg-root::before { content:''; position:fixed; inset:0; background:radial-gradient(ellipse 70% 60% at 20% 110%,var(--accent-bg-soft),transparent 65%), radial-gradient(ellipse 50% 40% at 85% -10%,var(--accent-bg-faint),transparent 60%); pointer-events:none; }
  .lg-card { width:100%; max-width:420px; background:var(--surface-1); border:1px solid var(--border); border-radius:24px; box-shadow:0 24px 64px var(--shadow-lg); overflow:hidden; position:relative; z-index:1; animation:lg-scalein .25s ease; }
  @keyframes lg-scalein { from{opacity:0;transform:scale(.97) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
  .lg-header { padding:32px 32px 24px; text-align:center; border-bottom:1px solid var(--border-subtle); }
  .lg-icon { width:52px; height:52px; border-radius:16px; background:var(--accent-bg-muted); border:1px solid var(--accent-border); display:inline-flex; align-items:center; justify-content:center; color:var(--accent-fg); margin-bottom:16px; }
  .lg-title { font-size:22px; font-weight:800; color:var(--text-primary); letter-spacing:-.03em; margin:0 0 4px; }
  .lg-sub { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--text-muted); margin:0; }
  .lg-body { padding:24px 32px 32px; display:flex; flex-direction:column; gap:16px; }
  .lg-notice { display:flex; align-items:flex-start; gap:10px; padding:12px 16px; border-radius:12px; font-size:13px; font-weight:600; line-height:1.5; }
  .lg-err { background:var(--error-bg); border:1px solid var(--danger-border); color:var(--error-fg); }
  .lg-ok { background:var(--accent-bg-soft); border:1px solid var(--accent-bg-muted); color:var(--brand-hover); }
  .lg-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .lg-full { grid-column:1 / -1; }
  .lg-field { display:flex; flex-direction:column; gap:6px; }
  .lg-label { font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--text-muted); }
  .lg-input-wrap { position:relative; display:flex; align-items:center; }
  .lg-input-icon { position:absolute; left:13px; color:var(--text-muted); display:flex; pointer-events:none; }
  .lg-input { width:100%; padding:11px 14px 11px 38px; background:var(--surface-2); border:1px solid var(--border); border-radius:12px; color:var(--text-primary); font-family:${FONT}; font-size:14px; font-weight:600; outline:none; transition:border-color .2s, box-shadow .2s; }
  .lg-input:focus { border-color:var(--accent-border-strong); box-shadow:0 0 0 3px var(--accent-bg-soft); }
  .lg-input::placeholder { color:var(--text-muted); font-weight:400; }
  .lg-input-no-icon { padding-left:14px; }
  .lg-eye-btn { position:absolute; right:12px; background:none; border:none; cursor:pointer; color:var(--text-muted); display:flex; align-items:center; padding:4px; transition:color .15s; }
  .lg-eye-btn:hover { color:var(--text-secondary); }
  .lg-phone-wrap { display:flex; background:var(--surface-2); border:1px solid var(--border); border-radius:12px; overflow:hidden; transition:border-color .2s, box-shadow .2s; }
  .lg-phone-wrap:focus-within { border-color:var(--accent-border-strong); box-shadow:0 0 0 3px var(--accent-bg-soft); }
  .lg-phone-prefix { display:flex; align-items:center; gap:8px; padding:0 12px; background:var(--surface-2); border-right:1px solid var(--border-subtle); flex-shrink:0; }
  .lg-phone-select { background:transparent; border:none; color:var(--text-secondary); font-family:${FONT}; font-size:13px; font-weight:700; outline:none; }
  .lg-phone-input { flex:1; padding:11px 14px; background:transparent; border:none; color:var(--text-primary); font-family:${FONT}; font-size:14px; font-weight:600; outline:none; }
  .lg-phone-input::placeholder { color:var(--text-muted); font-weight:400; }
  .lg-divider { display:flex; align-items:center; gap:12px; }
  .lg-divider-line { flex:1; height:1px; background:var(--border-subtle); }
  .lg-divider-text { font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--text-muted); }
  .lg-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:13px 20px; border-radius:12px; font-family:${FONT}; font-size:13px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; border:none; transition:background .15s, transform .15s, opacity .15s; }
  .lg-btn:disabled { opacity:.5; cursor:not-allowed; }
  .lg-btn-primary { background:var(--brand); color:var(--brand-on); }
  .lg-btn-primary:hover:not(:disabled) { background:var(--brand-hover); transform:translateY(-1px); }
  .lg-btn-ghost { background:var(--surface-2); border:1px solid var(--border)!important; color:var(--text-muted); }
  .lg-btn-ghost:hover:not(:disabled) { background:var(--surface-3); color:var(--text-secondary); }
  .lg-toggle { text-align:center; padding-top:16px; border-top:1px solid var(--border-subtle); }
  .lg-toggle-btn { background:none; border:none; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); cursor:pointer; transition:color .15s; text-decoration:underline; text-decoration-color:transparent; text-underline-offset:3px; }
  .lg-toggle-btn:hover { color:var(--accent-fg); text-decoration-color:var(--accent-fg); }
  .lg-brand { position:absolute; top:20px; left:50%; transform:translateX(-50%); display:inline-flex; align-items:center; }
  .lg-theme-toggle { position:absolute; top:18px; right:20px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary); border-radius:999px; padding:7px 12px; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; z-index:2; transition:background .15s,border-color .15s,color .15s; }
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
  .lg-root.lg-theme-light .lg-toggle { border-top-color:var(--border-subtle); }
  .lg-root.lg-theme-light .lg-toggle-btn { color:var(--text-secondary); }
  .lg-root.lg-theme-light .lg-theme-toggle { border-color:var(--border); background:var(--surface-1); color:var(--text-secondary); }
  .lg-root.lg-theme-light .lg-theme-toggle:hover { background:var(--surface-1); color:var(--text-primary); border-color:var(--border-strong); }
  @media(max-width:480px) { .lg-grid2 { grid-template-columns:1fr; } .lg-header { padding:24px 24px 20px; } .lg-body { padding:20px 24px 28px; } }
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
    if (loading || magicLoading) return;
    if (!redirectIntent && status === 'authenticated') { setRedirectIntent({ sourceUser: authUser }); return; }
    if (!redirectIntent) return;
    void navigateAfterAuth(redirectIntent.sourceUser || authUser).finally(() => setRedirectIntent(null));
  }, [authUser, loading, magicLoading, navigateAfterAuth, redirectIntent, router.pathname, status]);

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
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'No se pudo iniciar sesión con el enlace.');
      } finally {
        if (!cancelled) setLoading(false);
        clearHash();
      }
    })();
    return () => { cancelled = true; };
  }, [navigateAfterAuth, revalidateSession, returnTo, router]);

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
    } catch (err: any) {
      setError(err.message || (isLogin ? 'Credenciales inválidas' : 'Error al registrar'));
    } finally { setLoading(false); }
  };

  const handleRequestMagicLink = async () => {
    const safeEmail = String(email || '').trim();
    if (!safeEmail) { setError('Ingresá tu correo para enviarte el enlace.'); return; }
    setError(''); setSuccessMessage(''); setMagicLoading(true);
    try {
      const data = await requestMagicLink(safeEmail);
      setSuccessMessage(data?.message || 'Si el email es válido, te enviamos un enlace para ingresar.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar el enlace en este momento.');
    } finally { setMagicLoading(false); }
  };

  return (
    <>
      <Head>
        <title>{isLogin ? 'Ingresar' : 'Crear cuenta'} | Pique</title>
      </Head>
      <style dangerouslySetInnerHTML={{ __html: LOGIN_CSS }} />

      <div className={`lg-root${isLight ? ' lg-theme-light' : ''}`}>
        {/* Brand top link */}
        <Link href="/" className="lg-brand" aria-label="pique - inicio">
          <PiqueLogo
            variant={isLight ? 'horizontal' : 'horizontalDark'}
            style={{ width: 92, height: 'auto', display: 'block' }}
          />
        </Link>
        <button
          type="button"
          className="lg-theme-toggle"
          onClick={toggleTheme}
          aria-label={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
          title={isLight ? 'Activar modo oscuro' : 'Activar modo claro'}
        >
          {isLight ? 'Oscuro' : 'Claro'}
        </button>

        <div className="lg-card">

          {/* Header */}
          <div className="lg-header">
            <div className="lg-icon">
              {isLogin ? <LogIn size={22} /> : <UserPlus size={22} />}
            </div>
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

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

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
              <button type="submit" disabled={loading} className="lg-btn lg-btn-primary" style={{ marginTop: 4 }}>
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
                    disabled={magicLoading || loading || !String(email || '').trim()}
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
