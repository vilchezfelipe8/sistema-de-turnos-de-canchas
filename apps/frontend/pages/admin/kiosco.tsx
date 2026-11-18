import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check, Maximize2, Settings, X } from 'lucide-react';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getActiveClubSlug, hasOperatorAccess } from '../../utils/session';
import { ActivityTurnService, type CheckInResult, type TurnSchedule } from '../../services/ActivityTurnService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

// Pantalla de ingreso para la PC del molinete: el socio escribe su DNI (o escanea su código
// de la app) y ve si puede pasar. Si hay un agente local configurado, se le pide abrir.

const STORAGE_KEY = 'pique.kiosk.v1';
type KioskPrefs = { activityTypeId: number | null; agentUrl: string };

const readPrefs = (): KioskPrefs => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { activityTypeId: Number(parsed.activityTypeId) || null, agentUrl: String(parsed.agentUrl || '') };
  } catch {
    return { activityTypeId: null, agentUrl: '' };
  }
};

const writePrefs = (prefs: KioskPrefs) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Sin almacenamiento: queda solo en memoria.
  }
};

const shortDate = (key: string | null) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : '');

// Pitido corto: agudo si pasa, grave si no.
const beep = (ok: boolean) => {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.18 : 0.45));
    osc.onended = () => void ctx.close();
  } catch {
    // Sin audio.
  }
};

const KIOSK_CSS = `
  .ks-root { position:fixed; inset:0; display:flex; flex-direction:column; background:#0b0f0d; color:#f2f5f3; font-family:var(--font-sans, system-ui); overflow:hidden; }
  .ks-top { display:flex; align-items:center; justify-content:space-between; padding:20px 28px; }
  .ks-club { font-size:15px; font-weight:700; color:#9fb0a6; letter-spacing:.02em; }
  .ks-clock { font-size:30px; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .ks-tools { display:flex; gap:8px; }
  .ks-icon { width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:12px; border:1px solid #26302b; background:#121815; color:#9fb0a6; cursor:pointer; }
  .ks-main { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:24px; text-align:center; }
  .ks-hello { margin:0; font-size:clamp(32px,6vw,64px); font-weight:800; letter-spacing:-.03em; }
  .ks-activity { margin:0; font-size:18px; font-weight:600; color:#9fb0a6; }
  .ks-form { width:min(520px,100%); }
  .ks-input { width:100%; box-sizing:border-box; height:84px; border-radius:20px; border:2px solid #2c3a33; background:#121815; color:#fff; font-family:inherit; font-size:40px; font-weight:800; text-align:center; letter-spacing:.08em; outline:none; }
  .ks-input:focus { border-color:#3ddc84; }
  .ks-hint { margin:12px 0 0; font-size:15px; color:#7d8f85; }
  .ks-result { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:32px; text-align:center; }
  .ks-result.is-ok { background:#0f7a3d; }
  .ks-result.is-no { background:#a1261f; }
  .ks-badge { width:120px; height:120px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.16); }
  .ks-result h2 { margin:0; font-size:clamp(36px,7vw,72px); font-weight:800; letter-spacing:-.03em; }
  .ks-result p { margin:0; max-width:760px; font-size:clamp(20px,3vw,30px); font-weight:600; line-height:1.35; }
  .ks-result .ks-sub { font-size:clamp(16px,2.2vw,22px); opacity:.85; font-weight:500; }
  .ks-panel { position:absolute; top:76px; right:24px; width:min(360px,calc(100% - 48px)); padding:18px; border-radius:16px; background:#151c18; border:1px solid #26302b; text-align:left; display:flex; flex-direction:column; gap:12px; z-index:5; }
  .ks-panel label { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; color:#9fb0a6; }
  .ks-panel select, .ks-panel input { height:40px; border-radius:10px; border:1px solid #2c3a33; background:#0b0f0d; color:#fff; padding:0 10px; font-family:inherit; font-size:14px; }
  .ks-panel small { color:#7d8f85; font-size:12px; line-height:1.4; }
  .ks-panel a { color:#3ddc84; font-size:13px; font-weight:700; }
  .ks-empty { max-width:460px; font-size:18px; color:#9fb0a6; line-height:1.5; }
  .ks-empty a { color:#3ddc84; font-weight:700; }
`;

export default function KioskPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const slug = useMemo(() => (user ? getActiveClubSlug(user as any) : null), [user]);
  const canUse = Boolean(user && hasOperatorAccess(user as any));

  const [schedules, setSchedules] = useState<TurnSchedule[] | null>(null);
  const [prefs, setPrefs] = useState<KioskPrefs>({ activityTypeId: null, agentUrl: '' });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    if (authChecked && !user) void router.replace(`/login?from=${encodeURIComponent('/admin/kiosco')}`);
  }, [authChecked, user, router]);

  useEffect(() => setPrefs(readPrefs()), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!slug || !canUse) return;
    ActivityTurnService.listSchedules(slug)
      .then((rows) => setSchedules(rows.filter((row) => row.isActive)))
      .catch((error) => {
        reportUiError({ area: 'KioskPage', action: 'loadSchedules' }, error);
        setSchedules([]);
      });
  }, [slug, canUse]);

  const activity = useMemo(() => {
    if (!schedules?.length) return null;
    return schedules.find((row) => row.activityTypeId === prefs.activityTypeId) || schedules[0];
  }, [schedules, prefs.activityTypeId]);

  // El campo tiene que tener siempre el foco (también con el resultado en pantalla):
  // el lector de QR escribe como un teclado y el que viene atrás no espera.
  useEffect(() => {
    if (showSettings) return;
    const focus = () => inputRef.current?.focus();
    focus();
    const timer = window.setInterval(() => {
      if (document.activeElement !== inputRef.current) focus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [showSettings, activity]);

  const clearResult = useCallback(() => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = null;
    setResult(null);
    setValue('');
  }, []);

  const openTurnstile = useCallback(() => {
    const base = prefs.agentUrl.trim().replace(/\/+$/, '');
    if (!base) return;
    // El agente responde CORS (incluido Private Network Access), así que va como pedido normal.
    void fetch(`${base}/open`, { method: 'POST' }).catch(() => undefined);
  }, [prefs.agentUrl]);

  const submit = async () => {
    const identifier = value.trim();
    if (!identifier || !slug || !activity || busy) return;
    try {
      setBusy(true);
      const res = await ActivityTurnService.checkIn(slug, activity.activityTypeId, identifier);
      setResult(res);
      beep(res.allowed);
      if (res.allowed) openTurnstile();
    } catch (error) {
      reportUiError({ area: 'KioskPage', action: 'checkIn' }, error);
      setResult({
        allowed: false,
        code: 'ERROR',
        message: extractErrorMessage(error, 'No se pudo validar. Probá de nuevo.'),
        firstName: null,
        name: null,
        planName: null,
        validUntil: null,
        turn: null,
      });
      beep(false);
    } finally {
      setBusy(false);
      setValue('');
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(clearResult, 5000);
    }
  };

  const updatePrefs = (patch: Partial<KioskPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writePrefs(next);
  };

  if (!authChecked || !user) return <RouteTransitionScreen message="Validando acceso..." />;

  const clock = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <>
      <Head>
        <title>Kiosco | Pique</title>
      </Head>
      <style>{KIOSK_CSS}</style>
      <div className="ks-root">
        <header className="ks-top">
          <span className="ks-club">{activity?.name || 'Ingreso'}</span>
          <span className="ks-clock">{clock}</span>
          <div className="ks-tools">
            <button
              type="button"
              className="ks-icon"
              aria-label="Pantalla completa"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
            >
              <Maximize2 size={18} />
            </button>
            <button type="button" className="ks-icon" aria-label="Configurar kiosco" onClick={() => setShowSettings((v) => !v)}>
              <Settings size={18} />
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="ks-panel">
            {schedules && schedules.length > 1 ? (
              <label>
                Actividad
                <select value={activity?.activityTypeId ?? ''} onChange={(e) => updatePrefs({ activityTypeId: Number(e.target.value) })}>
                  {schedules.map((row) => (
                    <option key={row.activityTypeId} value={row.activityTypeId}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Agente del molinete (opcional)
              <input
                value={prefs.agentUrl}
                placeholder="http://127.0.0.1:7788"
                onChange={(e) => updatePrefs({ agentUrl: e.target.value })}
              />
            </label>
            <small>Si está configurado, cuando alguien puede pasar se le pide al agente que abra el molinete.</small>
            <Link href="/admin/ajustes?tab=turnero">Volver al panel</Link>
          </div>
        )}

        <main className="ks-main">
          {!canUse ? (
            <p className="ks-empty">Tu usuario no puede usar el kiosco de este club.</p>
          ) : schedules === null ? (
            <p className="ks-empty">Cargando…</p>
          ) : !activity ? (
            <p className="ks-empty">
              Para usar el kiosco, primero creá un turnero (por ejemplo Musculación) en{' '}
              <Link href="/admin/ajustes?tab=turnero">Ajustes → Turnero</Link>.
            </p>
          ) : (
            <>
              <h1 className="ks-hello">¡Bienvenido!</h1>
              <form
                className="ks-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <input
                  ref={inputRef}
                  className="ks-input"
                  value={value}
                  onChange={(e) => {
                    if (result) {
                      if (resetTimer.current) window.clearTimeout(resetTimer.current);
                      resetTimer.current = null;
                      setResult(null);
                    }
                    setValue(e.target.value);
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="DNI o código"
                  placeholder="Tu DNI"
                  readOnly={busy}
                />
                <p className="ks-hint">Escribí tu DNI y apretá Enter, o acercá tu código de la app.</p>
              </form>
            </>
          )}
        </main>

        {result && (
          <div
            className={`ks-result ${result.allowed ? 'is-ok' : 'is-no'}`}
            onMouseDown={(e) => {
              // Tocar la pantalla cierra el resultado sin sacarle el foco al campo.
              e.preventDefault();
              clearResult();
            }}
            role="status"
            aria-live="assertive"
            style={{ color: '#fff', cursor: 'pointer' }}
          >
            <span className="ks-badge">{result.allowed ? <Check size={72} strokeWidth={3} /> : <X size={72} strokeWidth={3} />}</span>
            <h2>
              {result.allowed
                ? `¡Hola, ${result.firstName}!`
                : result.firstName
                  ? `${result.firstName}, no podés pasar`
                  : 'No podés pasar'}
            </h2>
            <p>{result.allowed ? (result.turn ? `Tu turno: ${result.turn.label}` : 'Adelante.') : result.message}</p>
            {result.allowed && result.planName ? (
              <p className="ks-sub">
                {result.planName}
                {result.validUntil ? ` · al día hasta el ${shortDate(result.validUntil)}` : ''}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
