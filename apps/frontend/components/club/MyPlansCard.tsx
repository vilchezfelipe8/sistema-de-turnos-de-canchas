import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { ClubService, MyPlan } from '../../services/ClubService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import BusyLabel from '../ui/BusyLabel';

const CSS = `
  .mp-list { display:grid; gap:10px; }
  .mp-row { padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-2); }
  .mp-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
  .mp-title { margin:0; color:var(--text-primary); font-size:14px; font-weight:800; }
  .mp-sub { margin:3px 0 0; color:var(--text-secondary); font-size:12px; line-height:1.45; }
  .mp-badge { flex:none; padding:3px 8px; border:1px solid var(--border); border-radius:999px; background:var(--surface-1); color:var(--text-secondary); font-size:11px; font-weight:800; white-space:nowrap; }
  .mp-badge.is-ok { border-color:var(--accent-border-subtle); background:var(--positive-bg); color:var(--positive-fg); }
  .mp-badge.is-due { border-color:transparent; background:var(--error-bg, rgba(220,38,38,.1)); color:var(--error-fg); }
  .mp-lines { margin:10px 0 0; display:grid; gap:4px; }
  .mp-line { margin:0; color:var(--text-primary); font-size:13px; line-height:1.45; }
  .mp-line strong { font-weight:800; }
  .mp-line.is-due { color:var(--error-fg); font-weight:700; }
  .mp-chips { margin:8px 0 0; display:flex; flex-wrap:wrap; gap:6px; }
  .mp-chip { padding:4px 9px; border-radius:999px; background:var(--surface-1); border:1px solid var(--border-subtle); color:var(--text-primary); font-size:12px; font-weight:700; }
  .mp-foot { margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .mp-link { color:var(--accent-fg); font-size:12px; font-weight:800; text-decoration:none; }
  .mp-note { margin:0; color:var(--text-muted); font-size:12px; }
  .mp-actions { margin-top:12px; display:flex; flex-wrap:wrap; gap:8px; }
  .mp-actions .pf-save, .mp-actions .pf-secondary-btn { min-height:38px; }
  .mp-form { margin-top:12px; padding:12px; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface-1); display:grid; gap:10px; }
  .mp-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .mp-form label { display:grid; gap:4px; color:var(--text-secondary); font-size:12px; font-weight:700; }
  .mp-error { margin:0; color:var(--error-fg); font-size:12px; font-weight:700; }
  @media(max-width:420px) { .mp-form-grid { grid-template-columns:1fr; } .mp-actions > * { flex:1 1 auto; justify-content:center; } }
`;

const notice = (message: string, tone: 'info' | 'success' | 'error' = 'info') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, tone } }));
};
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

const day = (key: string | null) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : '');
const money = (value: number) =>
  value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });

const badge = (plan: MyPlan) => {
  if (plan.status === 'PAUSED' || plan.pause?.started) {
    return { label: 'En pausa', tone: '' };
  }
  if (plan.status === 'PAST_DUE' || plan.hasOverdue) return { label: 'Cuota vencida', tone: ' is-due' };
  return { label: 'Al día', tone: ' is-ok' };
};

/** "Mis planes" del jugador: estado, próxima cuota y clases incluidas que le quedan. */
export default function MyPlansCard() {
  const [plans, setPlans] = useState<MyPlan[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Formulario de pausa abierto (id del plan) y sus fechas.
  const [pauseFor, setPauseFor] = useState<string | null>(null);
  const [pauseStart, setPauseStart] = useState('');
  const [pauseEnd, setPauseEnd] = useState('');
  const [pauseError, setPauseError] = useState('');

  const load = useCallback(async () => {
    try {
      setPlans(await ClubService.getMyPlans());
    } catch (error) {
      reportUiError({ area: 'MyPlansCard', action: 'load' }, error);
      setPlans([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Vuelta de Mercado Pago (?plan=...&checkoutStatus=...): se avisa cómo salió y se limpia la URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkoutStatus');
    if (!params.get('plan') || !status) return;
    if (status === 'success') notice('¡Pago recibido! En unos segundos se marca la cuota como pagada.', 'success');
    else if (status === 'pending') notice('Tu pago está en proceso. Cuando se acredite, la cuota queda pagada.', 'info');
    else notice('El pago no se completó. Podés intentarlo de nuevo.', 'error');
    params.delete('plan');
    params.delete('checkoutStatus');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    // El aviso de Mercado Pago puede tardar unos segundos: se vuelve a mirar.
    const timer = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pay = async (plan: MyPlan) => {
    try {
      setBusyId(plan.id);
      const { initPoint } = await ClubService.payMyPlanInstallment(plan.id);
      window.location.href = initPoint;
    } catch (error) {
      reportUiError({ area: 'MyPlansCard', action: 'pay' }, error);
      notice(extractErrorMessage(error, 'No se pudo armar el pago de la cuota.'), 'error');
      setBusyId(null);
    }
  };

  const openPause = (plan: MyPlan) => {
    setPauseFor(plan.id);
    setPauseStart(localToday());
    setPauseEnd('');
    setPauseError('');
  };

  const submitPause = async (plan: MyPlan) => {
    if (!pauseEnd) {
      setPauseError('Elegí hasta cuándo.');
      return;
    }
    try {
      setBusyId(plan.id);
      setPauseError('');
      await ClubService.pauseMyPlan(plan.id, { startDate: pauseStart || null, endDate: pauseEnd });
      setPauseFor(null);
      notice('Listo, pausaste el plan. Las cuotas y las clases se corrieron esos días.', 'success');
      await load();
    } catch (error) {
      reportUiError({ area: 'MyPlansCard', action: 'pause' }, error);
      setPauseError(extractErrorMessage(error, 'No se pudo pausar el plan.'));
    } finally {
      setBusyId(null);
    }
  };

  const endPause = async (plan: MyPlan) => {
    if (!plan.pause) return;
    const started = plan.pause.started;
    const question = started
      ? '¿Terminás la pausa hoy? El plan vuelve a estar activo y las fechas se adelantan los días que no usaste.'
      : '¿Anulás la pausa? Las fechas vuelven a como estaban y podés volver a pausar más adelante.';
    if (!window.confirm(question)) return;
    try {
      setBusyId(plan.id);
      await ClubService.endMyPlanPause(plan.id, plan.pause.id);
      notice(started ? 'Listo, volviste antes de la pausa.' : 'Listo, anulaste la pausa.', 'success');
      await load();
    } catch (error) {
      reportUiError({ area: 'MyPlansCard', action: 'endPause' }, error);
      notice(extractErrorMessage(error, 'No se pudo terminar la pausa.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Los avisos de cuota llegan con #mis-planes: la tarjeta carga después, así que se baja a mano.
  useEffect(() => {
    if (!plans?.length || typeof window === 'undefined' || window.location.hash !== '#mis-planes') return;
    document.getElementById('mis-planes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [plans]);

  if (!plans || plans.length === 0) return null;

  return (
    <div className="p-public-card pf-card" id="mis-planes" style={{ marginTop: 16 }}>
      <style>{CSS}</style>
      <h2 className="pf-card-title">
        <BadgeCheck size={18} aria-hidden="true" /> Mis planes
      </h2>
      <div className="mp-list">
        {plans.map((plan) => {
          const state = badge(plan);
          const next = plan.nextInstallment;
          const who = plan.beneficiaryName && plan.isPayerOnly ? `Para ${plan.beneficiaryName}` : plan.payerName && !plan.isPayerOnly ? `Lo paga ${plan.payerName}` : null;
          const term = plan.endDate ? `hasta el ${day(plan.endDate)}` : 'se renueva solo';
          const busy = busyId === plan.id;
          const pausesLeft = plan.pauseMaxCount - plan.pausesUsed;
          const pauseDays = pauseStart && pauseEnd ? daysBetween(pauseStart, pauseEnd) : 0;
          const pauseTooLong = pauseDays > plan.pauseMaxDays;
          return (
            <article key={plan.id} className="mp-row">
              <div className="mp-head">
                <div>
                  <p className="mp-title">{plan.planName}</p>
                  <p className="mp-sub">{[plan.clubName, plan.optionLabel, term, who].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`mp-badge${state.tone}`}>{state.label}</span>
              </div>

              <div className="mp-lines">
                <p className="mp-line">
                  Al día hasta: <strong>{plan.paidThrough ? day(plan.paidThrough) : 'todavía sin cuotas pagas'}</strong>
                </p>
                {next ? (
                  <p className={`mp-line${next.isOverdue ? ' is-due' : ''}`}>
                    {next.isOverdue ? 'Cuota vencida' : 'Próxima cuota'}: <strong>{money(next.amount)}</strong>
                    {next.isOverdue ? ` (venció el ${day(next.dueDate)})` : ` · vence el ${day(next.dueDate)}`}
                  </p>
                ) : null}
                {plan.pendingAmount > 0 && next && plan.pendingAmount - next.amount > 0.009 ? (
                  <p className="mp-line">Debés en total {money(plan.pendingAmount)}.</p>
                ) : null}
                {plan.pause ? (
                  <p className="mp-line">
                    Pausa del {day(plan.pause.startDate)} al {day(plan.pause.endDate)}.
                  </p>
                ) : null}
              </div>

              {plan.classes.length > 0 ? (
                <div className="mp-chips" aria-label="Clases incluidas">
                  {plan.classes.map((row) => (
                    <span key={row.name} className="mp-chip">
                      {row.name.split(' · ').slice(1).join(' · ') || row.name}: {row.remaining === 1 ? 'te queda 1 clase' : `te quedan ${row.remaining} clases`}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mp-foot">
                {plan.clubSlug ? (
                  <Link href={`/club/${plan.clubSlug}`} className="mp-link">
                    Ver club
                  </Link>
                ) : (
                  <span />
                )}
                {next && !plan.canPayOnline ? <p className="mp-note">Las cuotas se pagan en el club.</p> : null}
              </div>

              {plan.canPayOnline || plan.canPause || (plan.pause && !busy) ? (
                <div className="mp-actions">
                  {plan.canPayOnline && next ? (
                    <button type="button" className="pf-save" disabled={busy} onClick={() => void pay(plan)}>
                      <BusyLabel busy={busy}>{`Pagar cuota ${money(next.amount)}`}</BusyLabel>
                    </button>
                  ) : null}
                  {plan.canPause && pauseFor !== plan.id ? (
                    <button type="button" className="pf-secondary-btn" disabled={busy} onClick={() => openPause(plan)}>
                      Pausar
                    </button>
                  ) : null}
                  {plan.pause ? (
                    <button type="button" className="pf-secondary-btn" disabled={busy} onClick={() => void endPause(plan)}>
                      {plan.pause.started ? 'Volver antes' : 'Anular pausa'}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {pauseFor === plan.id ? (
                <div className="mp-form">
                  <p className="mp-note">
                    Hasta {plan.pauseMaxDays} {plan.pauseMaxDays === 1 ? 'día' : 'días'}.{' '}
                    {pausesLeft === 1 ? 'Te queda 1 pausa' : `Te quedan ${pausesLeft} pausas`} en este plan. Las cuotas que vienen y las
                    clases se corren los días de la pausa.
                  </p>
                  <div className="mp-form-grid">
                    <label>
                      Desde
                      <input
                        type="date"
                        className="p-public-input"
                        value={pauseStart}
                        min={localToday()}
                        onChange={(event) => setPauseStart(event.target.value)}
                      />
                    </label>
                    <label>
                      Hasta
                      <input
                        type="date"
                        className="p-public-input"
                        value={pauseEnd}
                        min={pauseStart || localToday()}
                        onChange={(event) => setPauseEnd(event.target.value)}
                      />
                    </label>
                  </div>
                  {pauseTooLong ? <p className="mp-error">Son {pauseDays} días: el plan permite hasta {plan.pauseMaxDays}.</p> : null}
                  {pauseError ? <p className="mp-error">{pauseError}</p> : null}
                  <div className="mp-actions" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="pf-save"
                      disabled={busy || !pauseEnd || pauseTooLong}
                      onClick={() => void submitPause(plan)}
                    >
                      <BusyLabel busy={busy}>{pauseDays > 0 ? `Pausar ${pauseDays} ${pauseDays === 1 ? 'día' : 'días'}` : 'Pausar'}</BusyLabel>
                    </button>
                    <button type="button" className="pf-secondary-btn" disabled={busy} onClick={() => setPauseFor(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
