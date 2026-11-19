import { useState } from 'react';
import Link from 'next/link';
import { ClubService, type ClubPlan } from '../../services/ClubService';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import BusyLabel from '../ui/BusyLabel';

type Tone = 'info' | 'success' | 'error';

type Props = {
  slug: string;
  plans: ClubPlan[];
  loggedIn: boolean;
  loginHref: string;
  onNotice: (message: string, tone?: Tone) => void;
  /** Título del panel ("Planes" o "Otros planes"). */
  title?: string;
};

const money = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);

const termLabel = (plan: ClubPlan) =>
  plan.billingType === 'RECURRING'
    ? plan.periodMonths === 1
      ? 'Se renueva cada mes'
      : `Se renueva cada ${plan.periodMonths} meses`
    : plan.periodMonths === 1
      ? 'Dura 1 mes'
      : `Dura ${plan.periodMonths} meses`;

const optionPrice = (option: ClubPlan['options'][number]) =>
  option.installmentsCount === 1 ? money(option.installmentPrice) : `${option.installmentsCount} cuotas de ${money(option.installmentPrice)}`;

/** Planes del club (pestaña Gimnasio): qué incluyen, cuánto salen y comprarlos con Mercado Pago. */
export default function ClubPlansPanel({ slug, plans, loggedIn, loginHref, onNotice, title = 'Planes' }: Props) {
  // Forma de pago elegida por plan (por defecto, la primera).
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const buy = async (plan: ClubPlan, optionId: string) => {
    try {
      setBusyId(plan.id);
      const { initPoint } = await ClubService.purchaseClubPlan(slug, plan.id, optionId);
      window.location.href = initPoint;
    } catch (error) {
      reportUiError({ area: 'ClubPlansPanel', action: 'buy' }, error);
      onNotice(extractErrorMessage(error, 'No se pudo comprar el plan.'), 'error');
      setBusyId(null);
    }
  };

  if (plans.length === 0) return null;

  return (
    <section className="cl-panel" id="planes" aria-labelledby="club-plans-title" style={{ scrollMarginTop: 88 }}>
      <h2 id="club-plans-title" className="cl-panel-h">{title}</h2>
      <div className="cl-reviews">
        {plans.map((plan) => {
          const optionId = chosen[plan.id] || plan.options[0]?.id;
          const option = plan.options.find((row) => row.id === optionId) || plan.options[0];
          const busy = busyId === plan.id;
          const firstPayment = option ? option.installmentPrice + (plan.enrollmentFee || 0) : 0;
          return (
            <article key={plan.id} className="cl-review-card">
              <div className="cl-review-head">
                <span className="cl-review-name">{plan.name}</span>
                <span className="cl-course-when">{termLabel(plan)}</span>
              </div>
              {plan.includes.length > 0 && <p className="cl-review-comment">Incluye: {plan.includes.join(' · ')}</p>}
              {plan.description && <p className="cl-review-comment cl-course-desc">{plan.description}</p>}

              {plan.options.length > 1 ? (
                <div className="cl-turn-chips cl-turn-days" role="radiogroup" aria-label={`Forma de pago de ${plan.name}`}>
                  {plan.options.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="radio"
                      aria-checked={row.id === option?.id}
                      className={`cl-turn-chip${row.id === option?.id ? ' is-on' : ''}`}
                      onClick={() => setChosen((prev) => ({ ...prev, [plan.id]: row.id }))}
                    >
                      {row.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {option ? (
                <p className="cl-course-dates">
                  {plan.options.length === 1 ? `${option.label}: ` : ''}
                  {optionPrice(option)}
                  {plan.enrollmentFee ? ` · Matrícula ${money(plan.enrollmentFee)}` : ''}
                </p>
              ) : null}

              {plan.mine === 'ACTIVE' ? (
                <div className="cl-course-actions">
                  <span className="cl-course-state is-in">Ya tenés este plan</span>
                </div>
              ) : !plan.buyOnline ? (
                <p className="cl-course-spots">Se compra en el club.</p>
              ) : !loggedIn ? (
                <Link href={loginHref} className="cl-review-cta">
                  Iniciá sesión para comprarlo
                </Link>
              ) : option ? (
                <>
                  <button type="button" className="cl-review-cta" disabled={busyId !== null} onClick={() => void buy(plan, option.id)}>
                    <BusyLabel busy={busy}>
                      {plan.mine === 'AWAITING_PAYMENT' ? `Pagar ${money(firstPayment)}` : `Comprar · ${money(firstPayment)}`}
                    </BusyLabel>
                  </button>
                  <p className="cl-course-spots">
                    {option.installmentsCount > 1
                      ? `Pagás ${plan.enrollmentFee ? 'la matrícula y ' : ''}la primera cuota con Mercado Pago; las demás, cuando venzan.`
                      : `Pagás con Mercado Pago. El plan queda activo cuando se acredita.`}
                  </p>
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
