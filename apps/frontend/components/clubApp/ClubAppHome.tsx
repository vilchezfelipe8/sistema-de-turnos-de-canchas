import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock, LogIn, MapPin, Phone } from 'lucide-react';
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

const HOME_CSS = `
  .ca-home { max-width:640px; margin:0 auto; padding:24px 16px 12px; display:flex; flex-direction:column; gap:14px; }
  .ca-hello { margin:0 0 4px; color:var(--text-primary); font-size:30px; line-height:1.05; font-weight:900; letter-spacing:-.05em; }
  .ca-hello i { font-style:italic; color:var(--accent-fg); }
  .ca-cta { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:22px 20px; border-radius:22px; background:var(--brand); color:var(--brand-on); text-decoration:none; box-shadow:0 14px 28px rgba(182,243,106,.16); transition:background .15s, transform .15s; }
  .ca-cta:hover { background:var(--brand-hover); transform:translateY(-1px); }
  .ca-cta-title { display:block; font-size:22px; font-weight:900; letter-spacing:-.03em; color:var(--brand-on); }
  .ca-cta-sub { display:block; margin-top:4px; font-size:13px; font-weight:700; color:var(--brand-on); opacity:.8; }
  .ca-alert { display:flex; align-items:center; gap:12px; min-height:56px; padding:12px 16px; border-radius:18px; background:var(--accent-bg-soft); border:1px solid var(--accent-border); color:var(--text-primary); text-decoration:none; }
  .ca-alert-dot { width:10px; height:10px; flex-shrink:0; border-radius:999px; background:var(--brand); }
  .ca-alert-text { flex:1; font-size:15px; font-weight:800; line-height:1.35; }
  .ca-alert-link { color:var(--accent-fg); font-size:14px; font-weight:800; }
  .ca-card { border-radius:22px; background:var(--surface-1); border:1px solid var(--border); padding:18px; display:flex; flex-direction:column; gap:12px; }
  .ca-card-label { margin:0; color:var(--text-muted); font-size:12px; font-weight:800; letter-spacing:.01em; }
  .ca-match { display:flex; align-items:center; gap:14px; color:var(--text-primary); text-decoration:none; }
  .ca-date { width:58px; height:62px; flex-shrink:0; border-radius:16px; background:var(--positive-bg); border:1px solid var(--accent-border-subtle); display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .ca-date-day { color:var(--accent-fg); font-size:24px; font-weight:900; line-height:1; }
  .ca-date-month { margin-top:2px; color:var(--text-muted); font-size:11px; font-weight:800; }
  .ca-match-title { margin:0; font-size:18px; font-weight:900; letter-spacing:-.02em; }
  .ca-match-sub { margin:3px 0 0; color:var(--text-secondary); font-size:14px; font-weight:600; }
  .ca-empty { margin:0; color:var(--text-muted); font-size:14px; line-height:1.5; font-weight:600; }
  .ca-login { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:48px; padding:0 18px; border-radius:15px; background:var(--brand); color:var(--brand-on); font-size:15px; font-weight:900; text-decoration:none; }
  .ca-login:hover { background:var(--brand-hover); }
  .ca-line { margin:0; display:flex; align-items:center; gap:7px; color:var(--text-muted); font-size:13px; font-weight:600; line-height:1.4; }
  .ca-contact-row { display:flex; align-items:center; gap:12px; min-height:48px; color:var(--text-primary); font-size:15px; font-weight:700; text-decoration:none; }
  .ca-contact-row + .ca-contact-row { border-top:1px solid var(--border-subtle); }
  .ca-contact-icon { width:38px; height:38px; flex-shrink:0; border-radius:12px; background:var(--positive-bg); color:var(--accent-fg); display:flex; align-items:center; justify-content:center; }
`;

const formatClubAddress = (club: Club) =>
  [club.addressLine, club.city].filter(Boolean).join(', ');

type Props = {
  club: Club;
  slug: string;
  user: { id?: number; firstName?: string | null; name?: string | null } | null;
  loginHref: string;
};

// Inicio de la app instalada del club: lo que un socio necesita, sin tener que buscar.
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

  const firstName = String(user?.firstName || user?.name || '').trim().split(' ')[0];
  const windowInfo = bookingWindow && bookingWindow.enabled ? bookingWindow : null;
  const rangeLabel = windowInfo
    ? windowInfo.daysAhead === 0 ? 'Hoy' : windowInfo.daysAhead === 1 ? 'Hoy y mañana' : `Próximos ${windowInfo.daysAhead} días`
    : 'Elegí día y horario';

  const nextMatchLabels = useMemo(() => {
    if (!nextMatch) return null;
    const start = new Date(nextMatch.startDateTime);
    const timeZone = nextMatch.club?.timeZone || undefined;
    const day = start.toLocaleDateString('es-AR', { day: 'numeric', ...(timeZone ? { timeZone } : {}) });
    const month = start.toLocaleDateString('es-AR', { month: 'short', ...(timeZone ? { timeZone } : {}) }).replace('.', '');
    const weekday = start.toLocaleDateString('es-AR', { weekday: 'long', ...(timeZone ? { timeZone } : {}) });
    const time = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) });
    return {
      day,
      month,
      title: `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${time}`,
      sub: [nextMatch.court?.name, nextMatch.activity?.name].filter(Boolean).join(' · ')
    };
  }, [nextMatch]);

  const invitationText = invitations.length === 1
    ? `${String(invitations[0].invitedByName || '').trim().split(' ')[0] || 'Te'} ${invitations[0].invitedByName ? 'te invitó' : 'invitaron'} a jugar`
    : `Tenés ${invitations.length} invitaciones para jugar`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      <div className="ca-home">
        <h1 className="ca-hello">
          {firstName ? <>Hola, <i>{firstName}</i></> : <>Bienvenido a <i>{club.name}</i></>}
        </h1>

        <Link href={`/club/${slug}?view=reservar`} className="ca-cta">
          <span>
            <span className="ca-cta-title">Reservar cancha</span>
            <span className="ca-cta-sub">{rangeLabel}</span>
          </span>
          <ArrowRight size={28} strokeWidth={2.4} />
        </Link>

        {invitations.length > 0 && (
          <Link href="/bookings#invitaciones" className="ca-alert">
            <span className="ca-alert-dot" aria-hidden="true" />
            <span className="ca-alert-text">{invitationText}</span>
            <span className="ca-alert-link">Ver</span>
          </Link>
        )}

        {user ? (
          <section className="ca-card">
            <p className="ca-card-label">Tu próximo partido</p>
            {nextMatch && nextMatchLabels ? (
              <Link href="/bookings" className="ca-match">
                <span className="ca-date">
                  <span className="ca-date-day">{nextMatchLabels.day}</span>
                  <span className="ca-date-month">{nextMatchLabels.month}</span>
                </span>
                <span>
                  <p className="ca-match-title">{nextMatchLabels.title}</p>
                  {nextMatchLabels.sub ? <p className="ca-match-sub">{nextMatchLabels.sub}</p> : null}
                </span>
              </Link>
            ) : (
              <p className="ca-empty">Todavía no tenés partidos próximos en el club.</p>
            )}
          </section>
        ) : (
          <section className="ca-card">
            <p className="ca-empty">Ingresá con tu DNI para reservar y ver tus partidos.</p>
            <Link href={loginHref} className="ca-login">
              <LogIn size={17} /> Ingresar
            </Link>
          </section>
        )}

        {windowInfo ? (
          <p className="ca-line">
            <Clock size={14} />
            {windowInfo.hasMemberPriority
              ? `Socios reservan desde las ${windowInfo.memberOpensAt} · resto desde las ${windowInfo.publicOpensAt}`
              : `Reservas desde las ${windowInfo.publicOpensAt}`}
          </p>
        ) : null}

        {(club.addressLine || club.city || club.phone) && (
          <section className="ca-card" style={{ gap: 0, paddingBlock: 8 }}>
            {(club.addressLine || club.city) && (
              <a
                className="ca-contact-row"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${club.name} ${formatClubAddress(club)}`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="ca-contact-icon"><MapPin size={17} /></span>
                {formatClubAddress(club)}
              </a>
            )}
            {club.phone && (
              <a className="ca-contact-row" href={`tel:${club.phone.replace(/\s+/g, '')}`}>
                <span className="ca-contact-icon"><Phone size={17} /></span>
                Llamar al club
              </a>
            )}
          </section>
        )}
      </div>
    </>
  );
}
