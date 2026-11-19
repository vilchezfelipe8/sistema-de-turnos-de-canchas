import { useCallback, useState } from 'react';
import type { ClubPlansResponse, MyPlan } from '../../services/ClubService';
import ClubPlansPanel from './ClubPlansPanel';
import ClubTurnsPanel from './ClubTurnsPanel';
import MyPlansCard from './MyPlansCard';

type Tone = 'info' | 'success' | 'error';

type Props = {
  slug: string;
  loggedIn: boolean;
  loginHref: string;
  onNotice: (message: string, tone?: Tone) => void;
  /** Planes que vende el club (los carga la página para saber si mostrar la pestaña). */
  plans: ClubPlansResponse | null;
};

/**
 * Pestaña Gimnasio de la página del club:
 * - con plan: su estado ("al día hasta", pagar, pausar);
 * - sin plan: los planes del club para comprar con Mercado Pago;
 * - después, el turnero y el código QR para el molinete.
 */
export default function ClubGymTab({ slug, loggedIn, loginHref, onNotice, plans }: Props) {
  // null = todavía no se sabe (sin sesión no hay planes propios).
  const [myPlans, setMyPlans] = useState<MyPlan[] | null>(loggedIn ? null : []);
  const handleLoaded = useCallback((rows: MyPlan[]) => setMyPlans(rows), []);

  const catalog = plans?.plans ?? [];
  const showCatalog = (myPlans ?? []).length === 0 && myPlans !== null && catalog.length > 0;
  const canBuy = catalog.some((plan) => plan.buyOnline);

  return (
    <div className="cl-sidebar">
      {loggedIn ? <MyPlansCard clubSlug={slug} variant="club" onLoaded={handleLoaded} /> : null}
      {showCatalog ? (
        <ClubPlansPanel slug={slug} plans={catalog} loggedIn={loggedIn} loginHref={loginHref} onNotice={onNotice} />
      ) : null}
      <ClubTurnsPanel
        // Cuando cambia el plan (por ejemplo, se acreditó la compra) el turnero vuelve a mirar el acceso.
        key={(myPlans ?? []).map((plan) => `${plan.id}:${plan.awaitingPayment ? 1 : 0}:${plan.paidThrough || ''}:${plan.status}`).join('|')}
        slug={slug}
        loggedIn={loggedIn}
        loginHref={loginHref}
        onNotice={onNotice}
        plansHref="#mis-planes"
        buyPlanHref={canBuy || catalog.length > 0 ? '#planes' : null}
      />
    </div>
  );
}
