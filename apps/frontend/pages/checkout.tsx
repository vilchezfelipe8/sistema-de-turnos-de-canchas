import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  ShieldCheck,
  Ticket,
  WalletCards,
} from 'lucide-react';
import DarkPageLayout from '../components/DarkPageLayout';
import UserLoadingState from '../components/UserLoadingState';
import { createBooking } from '../services/BookingService';
import { getPendingLogoutRedirect } from '../services/AuthService';
import { useValidateAuth } from '../hooks/useValidateAuth';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
import {
  readBookingCheckoutDraft,
  removeBookingCheckoutDraft,
  type BookingCheckoutDraft,
} from '../utils/bookingCheckoutDraft';

const CHECKOUT_CSS = `
  .checkout-shell { max-width:1120px; margin:0 auto; }
  .checkout-top { margin-bottom:22px; }
  .checkout-layout { display:grid; grid-template-columns:minmax(0,1.1fr) 380px; gap:22px; align-items:start; }
  .checkout-card { background:var(--surface-1); border:1px solid var(--border); border-radius:24px; overflow:hidden; }
  .checkout-card-pad { padding:24px; }
  .checkout-hero { position:relative; padding:28px; border-bottom:1px solid var(--border); overflow:hidden; }
  .checkout-hero::before { content:''; position:absolute; inset:0; background:radial-gradient(circle at 10% 0%, var(--accent-border-subtle), transparent 34%), linear-gradient(135deg, var(--positive-bg), transparent 46%); pointer-events:none; }
  .checkout-hero-content { position:relative; z-index:1; }
  .checkout-pill { display:inline-flex; align-items:center; gap:8px; height:30px; padding:0 11px; border-radius:999px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--accent-fg); font-size:10px; font-weight:900; letter-spacing:.03em; }
  .checkout-title { margin:14px 0 7px; color:var(--text-primary); font-size:clamp(28px,4vw,46px); line-height:.98; font-weight:900; letter-spacing:-.06em; }
  .checkout-copy { margin:0; max-width:560px; color:var(--text-muted); font-size:14px; line-height:1.6; font-weight:600; }
  .checkout-activity { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
  .checkout-activity-icon { width:44px; height:44px; border-radius:16px; background:var(--positive-bg); color:var(--accent-fg); border:1px solid var(--accent-bg-muted); display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
  .checkout-activity-name { margin:0; color:var(--text-primary); font-size:17px; font-weight:900; line-height:1.2; }
  .checkout-activity-court { margin:2px 0 0; color:var(--text-muted); font-size:13px; font-weight:650; line-height:1.3; }
  .checkout-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .checkout-detail { min-height:88px; border-radius:18px; background:var(--surface-2); border:1px solid var(--border-subtle); padding:14px; }
  .checkout-label { display:flex; align-items:center; gap:7px; color:var(--text-muted); font-size:10px; font-weight:900; letter-spacing:.03em; margin-bottom:9px; }
  .checkout-value { margin:0; color:var(--text-primary); font-size:14px; line-height:1.35; font-weight:850; }
  .checkout-summary { position:sticky; top:88px; }
  .checkout-price { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:22px; border-bottom:1px solid var(--border); background:linear-gradient(135deg, var(--accent-bg-soft), transparent); }
  .checkout-price-label { margin:0; color:var(--text-muted); font-size:10px; font-weight:900; letter-spacing:.03em; }
  .checkout-price-value { margin:5px 0 0; color:var(--accent-fg); font-size:34px; font-weight:900; letter-spacing:-.06em; }
  .payment-option { display:flex; align-items:flex-start; gap:12px; border-radius:18px; padding:14px; border:1px solid var(--border); background:var(--surface-2); }
  .payment-option.active { border-color:var(--accent-border-strong); background:var(--accent-bg-soft); }
  .payment-option.disabled { opacity:.55; }
  .payment-icon { width:38px; height:38px; border-radius:14px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; background:var(--surface-2); color:var(--text-muted); }
  .payment-option.active .payment-icon { background:var(--accent-bg-muted); color:var(--accent-fg); }
  .payment-title { margin:0; color:var(--text-primary); font-size:13px; font-weight:850; }
  .payment-copy { margin:4px 0 0; color:var(--text-muted); font-size:12px; line-height:1.45; font-weight:600; }
  .checkout-error { border:1px solid var(--error-bg); background:var(--error-bg); color:var(--error-fg); border-radius:16px; padding:13px 14px; font-size:13px; font-weight:700; line-height:1.45; }
  .checkout-actions { display:flex; gap:10px; padding-top:16px; }
  .checkout-secondary,.checkout-primary { height:48px; border-radius:15px; font-family:var(--font-sans); font-size:12px; font-weight:900; letter-spacing:.01em; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; text-decoration:none; padding:0 18px; }
  .checkout-secondary { flex:0 0 auto; min-width:154px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-secondary); }
  .checkout-primary { flex:1; border:1px solid var(--brand); background:var(--brand); color:var(--brand-on); }
  .checkout-primary:hover { border-color:var(--brand-hover); background:var(--brand-hover); color:var(--brand-on); }
  .checkout-primary:disabled { cursor:not-allowed; opacity:.65; }
  .checkout-success { max-width:720px; margin:0 auto; text-align:center; }
  .checkout-success-icon { width:68px; height:68px; border-radius:22px; margin:0 auto 18px; display:flex; align-items:center; justify-content:center; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); color:var(--accent-fg); }
  @media(max-width:920px){
    .checkout-layout { grid-template-columns:1fr; }
    .checkout-summary { position:static; }
  }
  @media(max-width:620px){
    .checkout-top { align-items:flex-start; flex-direction:column; }
    .checkout-grid { grid-template-columns:1fr; }
    .checkout-actions { flex-direction:column; }
    .checkout-secondary { width:100%; }
  }
  .p-public-root.p-public-theme-light .checkout-card { background:var(--surface-1); border-color:var(--border); box-shadow:0 12px 30px var(--border); }
  .p-public-root.p-public-theme-light .checkout-hero { border-bottom-color:var(--border-subtle); }
  .p-public-root.p-public-theme-light .checkout-hero::before { background:radial-gradient(circle at 10% 0%, var(--accent-bg-muted), transparent 36%), linear-gradient(135deg, var(--positive-bg), transparent 52%); }
  .p-public-root.p-public-theme-light .checkout-pill { color:var(--accent-fg); background:var(--positive-bg); border-color:var(--accent-border-subtle); }
  .p-public-root.p-public-theme-light .checkout-title,
  .p-public-root.p-public-theme-light .checkout-value,
  .p-public-root.p-public-theme-light .checkout-activity-name { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .checkout-copy,
  .p-public-root.p-public-theme-light .checkout-price-label,
  .p-public-root.p-public-theme-light .payment-copy { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .checkout-activity-court { color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .checkout-detail,
  .p-public-root.p-public-theme-light .payment-option { background:var(--surface-1); border-color:var(--border); }
  .p-public-root.p-public-theme-light .checkout-label { color:var(--text-muted); }
  .p-public-root.p-public-theme-light .checkout-summary { box-shadow:none; }
  .p-public-root.p-public-theme-light .checkout-price { border-bottom-color:var(--border-subtle); background:linear-gradient(135deg, var(--accent-bg-faint), transparent); }
  .p-public-root.p-public-theme-light .checkout-price-value { color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .payment-icon { background:var(--surface-2); color:var(--text-muted); }
  .p-public-root.p-public-theme-light .payment-option.active { border-color:var(--accent-border-strong); background:var(--accent-bg-soft); }
  .p-public-root.p-public-theme-light .payment-option.active .payment-icon { background:var(--accent-bg-muted); color:var(--accent-fg); }
  .p-public-root.p-public-theme-light .payment-title { color:var(--text-primary); }
  .p-public-root.p-public-theme-light .checkout-secondary { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); }
  .p-public-root.p-public-theme-light .checkout-secondary:hover { background:var(--surface-2); color:var(--text-primary); }
  .p-public-root.p-public-theme-light .checkout-error { color:var(--error-fg); background:var(--error-bg); border-color:var(--danger-border); }
  .p-public-root.p-public-theme-light .checkout-success-icon { background:var(--positive-bg); border-color:var(--accent-border-subtle); color:var(--accent-fg); }
  .p-public-root:not(.p-public-theme-light) .checkout-success .checkout-primary { background:linear-gradient(135deg, var(--brand) 0%, var(--brand-hover) 100%); border-color:var(--brand-hover); color:var(--brand-on); box-shadow:0 14px 28px rgba(182,243,106,.18); }
  .p-public-root:not(.p-public-theme-light) .checkout-success .checkout-primary:hover { background:linear-gradient(135deg, var(--brand-hover) 0%, var(--brand) 100%); border-color:var(--brand); color:var(--brand-on); }
`;

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

const parseDraftDate = (date: string) => {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getDraftDateLabels = (draft: BookingCheckoutDraft) => {
  const date = parseDraftDate(draft.date);
  if (!date) {
    return { longDate: draft.date, shortDate: draft.date };
  }
  return {
    longDate: date.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' }),
    shortDate: date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  };
};

const getTimeRange = (draft: BookingCheckoutDraft) => {
  const minutes = Number(draft.durationMinutes || 0);
  const [hour, minute] = String(draft.slotTime || '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(minutes)) return draft.slotTime;
  const start = new Date(2000, 0, 1, hour, minute);
  const end = new Date(start.getTime() + minutes * 60000);
  const format = (date: Date) => date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${format(start)} - ${format(end)}`;
};

const formatSlugLabel = (value: string) =>
  String(value || '')
    .split('-')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

export default function CheckoutPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [draft, setDraft] = useState<BookingCheckoutDraft | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBookingId, setConfirmedBookingId] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    const draftId = typeof router.query.draft === 'string' ? router.query.draft : '';
    setDraft(readBookingCheckoutDraft(draftId));
    setDraftLoaded(true);
  }, [router.isReady, router.query.draft]);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/checkout')}`);
  }, [authChecked, router, user]);

  const dateLabels = useMemo(() => (draft ? getDraftDateLabels(draft) : null), [draft]);
  const timeRange = useMemo(() => (draft ? getTimeRange(draft) : ''), [draft]);
  const backHref = draft?.clubSlug ? `/club/${draft.clubSlug}` : '/';
  const checkoutBreadcrumbs = useMemo(() => {
    const items: Array<{ label: string; href?: string }> = [{ label: 'Inicio', href: '/' }];
    if (draft?.clubSlug) {
      items.push({ label: 'Complejos', href: '/complejos' });
      items.push({ label: formatSlugLabel(draft.clubSlug) || 'Club', href: `/club/${draft.clubSlug}` });
    }
    items.push({ label: confirmedBookingId !== null ? 'Confirmación' : 'Checkout' });
    return items;
  }, [confirmedBookingId, draft?.clubSlug]);

  const handleConfirm = async () => {
    if (!draft || submitting) return;
    const date = parseDraftDate(draft.date);
    if (!date) {
      setSubmitError('No pudimos leer la fecha de la reserva. Volvé a elegir el turno.');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError('');
      const result = await createBooking(draft.courtId, draft.activityId, date, draft.slotTime, {
        durationMinutes: draft.durationMinutes,
        applyDiscount: false,
      });
      const booking = (result as any)?.booking || result;
      const bookingId = String(booking?.id || (result as any)?.bookingId || '').trim();
      removeBookingCheckoutDraft(draft.id);
      setConfirmedBookingId(bookingId || 'created');
    } catch (error) {
      const message = extractErrorMessage(error, 'No pudimos confirmar la reserva. Intentá nuevamente.');
      reportUiError({ area: 'CheckoutPage', action: 'confirmBooking' }, error);
      if (message.toLowerCase().includes('sesión expirada')) {
        void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/checkout')}`);
        return;
      }
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!authChecked || !draftLoaded) {
    return <UserLoadingState mode="page" message="Preparando checkout..." />;
  }

  if (!draft) {
    return (
      <DarkPageLayout title="Checkout | Pique" extraCss={CHECKOUT_CSS} breadcrumbs={checkoutBreadcrumbs}>
        <main className="p-public-page-sm">
          <section className="checkout-card checkout-card-pad checkout-success">
            <div className="checkout-success-icon">
              <Ticket size={30} />
            </div>
            <h1 className="checkout-title">No encontramos esta reserva</h1>
            <p className="checkout-copy" style={{ margin: '0 auto 24px' }}>
              El resumen pudo haber vencido o se abrió desde otra pestaña. Volvé a elegir el turno para continuar.
            </p>
            <Link href="/" className="checkout-primary" style={{ maxWidth: 260, margin: '0 auto' }}>
              Buscar turno
            </Link>
          </section>
        </main>
      </DarkPageLayout>
    );
  }

  if (confirmedBookingId !== null) {
    return (
      <DarkPageLayout title="Reserva confirmada | Pique" extraCss={CHECKOUT_CSS} breadcrumbs={checkoutBreadcrumbs}>
        <main className="p-public-page-sm">
          <section className="checkout-card checkout-card-pad checkout-success">
            <div className="checkout-success-icon">
              <CheckCircle2 size={34} />
            </div>
            <span className="checkout-pill">
              <ShieldCheck size={13} />
              Reserva creada
            </span>
            <h1 className="checkout-title">Tu turno quedó reservado</h1>
            <p className="checkout-copy" style={{ margin: '0 auto 22px' }}>
              Guardamos la reserva en el club. Podés verla desde Mis Reservas cuando necesites revisar el horario.
            </p>
            <div className="checkout-card" style={{ textAlign: 'left', marginBottom: 20 }}>
              <div className="checkout-card-pad checkout-grid">
                <div className="checkout-detail">
                  <div className="checkout-label"><Calendar size={14} /> Fecha</div>
                  <p className="checkout-value" style={{ textTransform: 'capitalize' }}>{dateLabels?.longDate}</p>
                </div>
                <div className="checkout-detail">
                  <div className="checkout-label"><Clock size={14} /> Horario</div>
                  <p className="checkout-value">{timeRange}</p>
                </div>
                <div className="checkout-detail">
                  <div className="checkout-label"><MapPin size={14} /> Cancha</div>
                  <p className="checkout-value">{draft.courtName}</p>
                </div>
                <div className="checkout-detail">
                  <div className="checkout-label"><Ticket size={14} /> Total</div>
                  <p className="checkout-value">{formatMoney(draft.price)}</p>
                </div>
              </div>
            </div>
            <div className="checkout-actions">
              <Link href={backHref} className="checkout-secondary" style={{ minWidth: 236 }}>Reservar otro</Link>
              <Link href="/bookings" className="checkout-primary">Ver mis reservas</Link>
            </div>
          </section>
        </main>
      </DarkPageLayout>
    );
  }

  return (
    <DarkPageLayout title="Checkout | Pique" extraCss={CHECKOUT_CSS} breadcrumbs={checkoutBreadcrumbs}>
      <main className="p-public-page">
        <div className="checkout-shell">
          <div className="checkout-layout">
            <section className="checkout-card">
              <div className="checkout-hero">
                <div className="checkout-hero-content">
                  <span className="checkout-pill">
                    <ShieldCheck size={13} />
                    Revisá antes de pagar
                  </span>
                  <h1 className="checkout-title">Ya casi terminamos</h1>
                  <p className="checkout-copy">
                    Confirmá que los datos del turno sean correctos.
                  </p>
                </div>
              </div>

              <div className="checkout-card-pad">
                <div className="checkout-activity">
                  <div className="checkout-activity-icon">
                    <Ticket size={19} />
                  </div>
                  <div>
                    <p className="checkout-activity-name">{draft.activityName}</p>
                    <p className="checkout-activity-court">{draft.courtName}</p>
                  </div>
                </div>

                <div className="checkout-grid">
                  <div className="checkout-detail">
                    <div className="checkout-label"><Calendar size={14} /> Fecha</div>
                    <p className="checkout-value" style={{ textTransform: 'capitalize' }}>{dateLabels?.longDate}</p>
                  </div>
                  <div className="checkout-detail">
                    <div className="checkout-label"><Clock size={14} /> Horario</div>
                    <p className="checkout-value">{timeRange}</p>
                  </div>
                  <div className="checkout-detail">
                    <div className="checkout-label"><MapPin size={14} /> Cancha</div>
                    <p className="checkout-value">{draft.courtName}</p>
                  </div>
                  <div className="checkout-detail">
                    <div className="checkout-label"><Ticket size={14} /> Duración</div>
                    <p className="checkout-value">{draft.durationMinutes} min</p>
                  </div>
                </div>
              </div>
            </section>

            <aside className="checkout-card checkout-summary">
              <div className="checkout-price">
                <div>
                  <p className="checkout-price-label">Total del turno</p>
                  <p className="checkout-price-value">{formatMoney(draft.price)}</p>
                </div>
                <div style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.55, fontWeight: 650 }}>
                  {draft.lightsExtraApplied > 0.009 && (
                    <div>Luces +{formatMoney(draft.lightsExtraApplied)}{draft.lightsFromHour ? ` desde ${draft.lightsFromHour}` : ''}</div>
                  )}
                  {draft.discountAmount > 0.009 && <div style={{ color: 'var(--accent-fg)' }}>Descuento -{formatMoney(draft.discountAmount)}</div>}
                  {draft.lightsExtraApplied <= 0.009 && draft.discountAmount <= 0.009 && <div>Pago en el club</div>}
                </div>
              </div>

              <div className="checkout-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="payment-option active">
                  <div className="payment-icon"><WalletCards size={18} /></div>
                  <div>
                    <p className="payment-title">Pago en el club</p>
                    <p className="payment-copy">Confirmás el turno ahora y el club gestiona el cobro en caja.</p>
                  </div>
                </div>

                <div className="payment-option disabled">
                  <div className="payment-icon"><CreditCard size={18} /></div>
                  <div>
                    <p className="payment-title">Seña online (próximamente)</p>
                    <p className="payment-copy">Esta opción todavía no está disponible. Por ahora, el pago se realiza en el club.</p>
                  </div>
                </div>

                {submitError && <div className="checkout-error">{submitError}</div>}

                <div className="checkout-actions">
                  <Link href={backHref} className="checkout-secondary">Volver</Link>
                  <button
                    type="button"
                    className="checkout-primary"
                    onClick={() => { void handleConfirm(); }}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={15} style={{ animation: 'p-public-spin .8s linear infinite' }} />
                        Confirmando...
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={15} />
                        Confirmar reserva
                      </>
                    )}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </DarkPageLayout>
  );
}
