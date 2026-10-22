import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock, LogIn, Mail, MapPin, Trophy, Zap } from 'lucide-react';
import type { Club } from '../../services/ClubService';
import {
  BOOKING_INVITATIONS_CHANGED_EVENT,
  getMyBookingInvitations,
  getMyBookings,
  type PlayerBookingDto,
  type PlayerBookingInvitationDto
} from '../../services/BookingService';
import { BookingWindowService, type BookingWindowEvaluation } from '../../services/BookingWindowService';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
import { reportUiError } from '../../utils/uiError';

// Inicio de la app instalada del club: el diseño de la web (encabezado del club, títulos con acento,
// tarjetas de reserva) con lo justo para un socio: reservar, sus invitaciones y su próximo partido.
const HOME_CSS = `
  .ca-home { max-width:640px; margin:0 auto; padding:16px 16px 12px; display:flex; flex-direction:column; gap:18px; }
  .ca-hero { position:relative; min-height:176px; border-radius:24px; overflow:hidden; border:1px solid var(--border); display:flex; align-items:flex-end; }
  .ca-hero-bg { position:absolute; inset:0; background:linear-gradient(135deg,var(--brand-on) 0%,var(--ink-900, #0E1116) 55%,var(--positive-bg) 100%); }
  .ca-hero-img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .ca-hero-overlay { position:absolute; inset:0; background:linear-gradient(180deg, rgba(5,5,5,.12) 0%, rgba(5,5,5,.78) 100%); }
  .ca-hero-body { position:relative; z-index:1; width:100%; padding:18px; display:flex; align-items:flex-end; gap:14px; }
  .ca-hero-logo { position:relative; width:64px; height:64px; flex-shrink:0; border-radius:16px; overflow:hidden; background:var(--surface-1); border:2px solid var(--border); display:flex; align-items:center; justify-content:center; }
  .ca-hero-name { margin:0 0 8px; color:#F1EEE4; font-size:24px; line-height:1.02; font-weight:800; letter-spacing:-.04em; }
  .ca-hero-meta { margin:0; display:flex; align-items:center; gap:6px; color:#C9CBD0; font-size:12px; font-weight:500; }
  .ca-alert { display:flex; align-items:center; gap:12px; min-height:52px; padding:12px 16px; border-radius:16px; background:var(--accent-bg-soft); border:1px solid var(--accent-border); color:var(--text-primary); text-decoration:none; }
  .ca-alert-text { flex:1; font-size:14px; font-weight:700; line-height:1.35; }
  .ca-alert-link { color:var(--accent-fg); font-size:13px; font-weight:800; }
  .ca-book { border-radius:24px; background:var(--surface-1); border:1px solid var(--border-subtle); padding:22px 20px 20px; display:flex; flex-direction:column; gap:16px; }
  .ca-book-head { padding-bottom:16px; border-bottom:1px solid var(--border-subtle); }
  .ca-book-title { margin:0 0 4px; color:var(--text-primary); font-size:22px; font-weight:800; letter-spacing:-.03em; }
  .ca-book-title i { font-style:italic; color:var(--accent-fg); }
  .ca-book-sub { margin:0; color:var(--text-muted); font-size:12px; font-weight:500; }
  /* "a.ca-primary" dentro de .ca-home: le gana a la regla general del layout que hereda el color en los links. */
  .ca-home a.ca-primary { height:50px; display:flex; align-items:center; justify-content:center; gap:8px; border-radius:16px; background:var(--brand); color:var(--brand-on); font-size:14px; font-weight:800; letter-spacing:.01em; text-decoration:none; transition:background .15s; }
  .ca-home a.ca-primary:hover { background:var(--brand-hover); color:var(--brand-on); }
  .ca-line { margin:0; display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:11px; font-weight:600; line-height:1.4; }
  .ca-section { display:flex; flex-direction:column; gap:10px; }
  .ca-eyebrow { display:inline-flex; align-items:center; gap:10px; color:var(--accent-fg); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
  .ca-eyebrow::before { content:''; width:24px; height:1px; background:var(--brand); }
  .ca-match { display:flex; align-items:center; gap:14px; padding:14px 16px; border-radius:16px; background:var(--surface-1); border:1px solid var(--border-strong); color:var(--text-primary); text-decoration:none; transition:border-color .2s, background .2s; }
  .ca-match:hover { border-color:var(--text-muted); background:var(--surface-2); }
  .ca-date { width:48px; height:48px; flex-shrink:0; border-radius:12px; background:var(--positive-bg); border:1px solid var(--accent-border-strong); display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .ca-date-day { color:var(--text-primary); font-size:20px; font-weight:800; line-height:1; }
  .ca-date-month { color:var(--text-muted); font-size:9px; font-weight:700; letter-spacing:.03em; }
  .ca-match-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
  .ca-match-title { font-size:14px; font-weight:800; }
  .ca-chips { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .ca-chip { padding:2px 8px; border-radius:6px; background:var(--surface-2); color:var(--text-muted); font-size:10px; font-weight:600; }
  .ca-chip.is-warn { background:var(--warn-bg); color:var(--warn-fg); font-weight:700; }
  .ca-chip.is-ok { background:var(--positive-bg); color:var(--accent-fg); font-weight:700; }
  .ca-empty { margin:0; padding:14px 16px; border-radius:16px; background:var(--surface-1); border:1px dashed var(--border-strong); color:var(--text-muted); font-size:13px; line-height:1.5; font-weight:600; }
`;

const formatClubAddress = (club: Club) =>
  [club.addressLine, club.city].filter(Boolean).join(', ');

type Props = {
  club: Club;
  slug: string;
  user: { id?: number; firstName?: string | null; name?: string | null } | null;
  loginHref: string;
};

export default function ClubAppHome({ club, slug, user, loginHref }: Props) {
  const [nextMatch, setNextMatch] = useState<PlayerBookingDto | null>(null);
  const [invitations, setInvitations] = useState<PlayerBookingInvitationDto[]>([]);
  const [bookingWindow, setBookingWindow] = useState<BookingWindowEvaluation | null>(null);

  useEffect(() => {
    BookingWindowService.getPublicWindow(slug)
      .then(setBookingWindow)
      .catch((error) => reportUiError({ area: 'ClubAppHome', action: 'loadBookingWindow' }, error));
  }, [slug, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setNextMatch(null);
      setInvitations([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const [bookings, pending] = await Promise.all([
          getMyBookings(user.id),
          getMyBookingInvitations().catch(() => [] as PlayerBookingInvitationDto[])
        ]);
        if (cancelled) return;
        const now = Date.now();
        const upcoming = (Array.isArray(bookings) ? bookings : [])
          .filter((booking) => booking.club?.slug === slug)
          .filter((booking) => booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED')
          .filter((booking) => new Date(booking.endDateTime || booking.startDateTime).getTime() >= now)
          .sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());
        setNextMatch(upcoming[0] || null);
        setInvitations(Array.isArray(pending) ? pending : []);
      } catch (error) {
        if (!isAuthSessionInvalidatedError(error)) reportUiError({ area: 'ClubAppHome', action: 'loadPlayerData' }, error);
      }
    };
    void load();
    const onChange = () => { void load(); };
    window.addEventListener(BOOKING_INVITATIONS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(BOOKING_INVITATIONS_CHANGED_EVENT, onChange);
    };
  }, [slug, user?.id]);

  const windowInfo = bookingWindow && bookingWindow.enabled ? bookingWindow : null;
  const rangeLabel = windowInfo
    ? windowInfo.daysAhead === 0 ? 'Solo hoy' : windowInfo.daysAhead === 1 ? 'Hoy y mañana' : `Próximos ${windowInfo.daysAhead} días`
    : 'Elegí deporte, día y horario';

  const nextMatchLabels = useMemo(() => {
    if (!nextMatch) return null;
    const start = new Date(nextMatch.startDateTime);
    const timeZone = nextMatch.club?.timeZone || undefined;
    const tz = timeZone ? { timeZone } : {};
    const weekday = start.toLocaleDateString('es-AR', { weekday: 'long', ...tz });
    const payment = nextMatch.paymentSummary?.status;
    return {
      day: start.toLocaleDateString('es-AR', { day: '2-digit', ...tz }),
      month: start.toLocaleDateString('es-AR', { month: 'short', ...tz }).replace('.', ''),
      title: `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, ...tz })}`,
      activity: nextMatch.activity?.name || null,
      court: nextMatch.court?.name || null,
      payment: payment === 'PAID'
        ? { label: 'Pagada', tone: 'is-ok' }
        : payment === 'PENDING' || payment === 'PARTIAL'
          ? { label: nextMatch.paymentSummary.label || 'Pago pendiente', tone: 'is-warn' }
          : null
    };
  }, [nextMatch]);

  const invitationText = invitations.length === 1
    ? (invitations[0].invitedByName
      ? `${String(invitations[0].invitedByName).trim().split(' ')[0]} te invitó a jugar`
      : 'Te invitaron a jugar')
    : `Tenés ${invitations.length} invitaciones para jugar`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      <div className="ca-home">
        <section className="ca-hero">
          <div className="ca-hero-bg" />
          {club.clubImageUrl && (
            <>
              <Image src={club.clubImageUrl} alt="" fill sizes="640px" className="ca-hero-img" unoptimized />
              <div className="ca-hero-overlay" />
            </>
          )}
          {!club.clubImageUrl && <div className="ca-hero-overlay" />}
          <div className="ca-hero-body">
            <span className="ca-hero-logo">
              {club.logoUrl
                ? <Image src={club.logoUrl} alt="" fill sizes="64px" style={{ objectFit: 'contain' }} unoptimized />
                : <Trophy size={26} style={{ color: 'var(--text-muted)' }} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 className="ca-hero-name">{club.name}</h1>
              {(club.addressLine || club.city) && (
                <p className="ca-hero-meta">
                  <MapPin size={13} style={{ color: 'var(--accent-fg)', flexShrink: 0 }} />
                  {formatClubAddress(club)}
                </p>
              )}
            </div>
          </div>
        </section>

        {invitations.length > 0 && (
          <Link href="/bookings#invitaciones" className="ca-alert">
            <Mail size={16} style={{ color: 'var(--accent-fg)', flexShrink: 0 }} />
            <span className="ca-alert-text">{invitationText}</span>
            <span className="ca-alert-link">Ver</span>
          </Link>
        )}

        <section className="ca-book">
          <div className="ca-book-head">
            <h2 className="ca-book-title">Reservar <i>cancha</i></h2>
            <p className="ca-book-sub">{rangeLabel}</p>
          </div>
          {user ? (
            <Link href={`/club/${slug}?view=reservar`} className="ca-primary">
              <Zap size={15} /> Ver horarios
            </Link>
          ) : (
            <Link href={loginHref} className="ca-primary">
              <LogIn size={15} /> Ingresar con DNI
            </Link>
          )}
          {windowInfo ? (
            <p className="ca-line">
              <Clock size={12} />
              {windowInfo.hasMemberPriority
                ? `Socios desde las ${windowInfo.memberOpensAt} · resto desde las ${windowInfo.publicOpensAt}`
                : `Reservas desde las ${windowInfo.publicOpensAt}`}
            </p>
          ) : null}
        </section>

        {user ? (
          <section className="ca-section">
            <span className="ca-eyebrow">Tu próximo partido</span>
            {nextMatch && nextMatchLabels ? (
              <Link href="/bookings" className="ca-match">
                <span className="ca-date">
                  <span className="ca-date-day">{nextMatchLabels.day}</span>
                  <span className="ca-date-month">{nextMatchLabels.month}</span>
                </span>
                <span className="ca-match-info">
                  <span className="ca-match-title">{nextMatchLabels.title}</span>
                  <span className="ca-chips">
                    {nextMatchLabels.activity ? <span className="ca-chip">{nextMatchLabels.activity}</span> : null}
                    {nextMatchLabels.court ? <span className="ca-chip">{nextMatchLabels.court}</span> : null}
                    {nextMatchLabels.payment ? <span className={`ca-chip ${nextMatchLabels.payment.tone}`}>{nextMatchLabels.payment.label}</span> : null}
                  </span>
                </span>
                <ArrowRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </Link>
            ) : (
              <p className="ca-empty">Todavía no tenés partidos próximos en el club.</p>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
