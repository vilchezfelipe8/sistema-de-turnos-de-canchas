import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { ClubService, MyPlan } from '../../services/ClubService';
import { reportUiError } from '../../utils/uiError';

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
`;

const day = (key: string | null) => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}` : '');
const money = (value: number) =>
  value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });

const badge = (plan: MyPlan) => {
  if (plan.status === 'PAUSED' || (plan.pause && plan.pause.startDate <= new Date().toISOString().slice(0, 10))) {
    return { label: 'En pausa', tone: '' };
  }
  if (plan.status === 'PAST_DUE' || plan.hasOverdue) return { label: 'Cuota vencida', tone: ' is-due' };
  return { label: 'Al día', tone: ' is-ok' };
};

/** "Mis planes" del jugador: estado, próxima cuota y clases incluidas que le quedan. */
export default function MyPlansCard() {
  const [plans, setPlans] = useState<MyPlan[] | null>(null);

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
                {next ? <p className="mp-note">Las cuotas se pagan en el club.</p> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
