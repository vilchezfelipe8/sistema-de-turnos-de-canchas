import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { ClubService } from '../../services/ClubService';
import { getMyBookings, type PlayerBookingDto } from '../../services/BookingService';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
import { clubInitials } from '../../utils/clubApp';
import { reportUiError } from '../../utils/uiError';

const MY_CLUBS_CSS = `
  .p-myclubs { padding:44px 40px 40px; background:var(--p-home-bg-a, var(--bg)); border-bottom:1px solid var(--border-subtle); }
  .p-myclubs-inner { max-width:1360px; margin:0 auto; }
  .p-myclubs-title { margin:0 0 20px; color:var(--text-primary); font-size:clamp(26px,3vw,36px); font-weight:800; letter-spacing:-.04em; line-height:1.05; }
  .p-myclubs-title i { font-style:italic; color:var(--accent-fg); }
  .p-myclubs-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap:12px; }
  .p-myclubs-card { min-width:0; display:flex; align-items:center; gap:14px; padding:16px; border-radius:20px; background:var(--surface-1); border:1px solid var(--border); color:var(--text-primary); text-decoration:none; transition:border-color .15s, transform .15s; }
  .p-myclubs-card:hover { border-color:var(--accent-border); transform:translateY(-1px); }
  .p-myclubs-mark { position:relative;  width:54px; height:54px; flex-shrink:0; border-radius:16px; overflow:hidden; background:var(--brand-on); color:var(--brand); border:1px solid var(--accent-border-subtle); display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900; letter-spacing:-.02em; }
  .p-myclubs-mark img { background:var(--surface-1); }
  .p-myclubs-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .p-myclubs-name { font-size:17px; font-weight:900; letter-spacing:-.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .p-myclubs-sub { color:var(--text-muted); font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .p-myclubs-cta { flex-shrink:0; display:inline-flex; align-items:center; gap:6px; height:40px; padding:0 14px; border-radius:12px; background:var(--brand); color:var(--brand-on); font-size:13px; font-weight:900; }
  @media(max-width:720px){
    .p-myclubs { padding:28px 16px 24px; }
    .p-myclubs-grid { grid-template-columns:minmax(0, 1fr); }
    .p-myclubs-card { gap:12px; padding:14px; }
    .p-myclubs-mark { width:48px; height:48px; border-radius:14px; font-size:16px; }
    /* En el celular el nombre puede ocupar dos líneas y el botón queda compacto. */
    .p-myclubs-name { font-size:16px; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.2; }
    .p-myclubs-cta { height:40px; padding:0 12px; }
    .p-myclubs-cta-label { display:none; }
  }
`;

type MyClub = { slug: string; name: string; logoUrl: string | null; nextLabel: string | null; nextAt: number };

const formatNext = (booking: PlayerBookingDto) => {
  const start = new Date(booking.startDateTime);
  const timeZone = booking.club?.timeZone || undefined;
  const weekday = start.toLocaleDateString('es-AR', { weekday: 'long', ...(timeZone ? { timeZone } : {}) });
  const time = start.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) });
  return `${booking.activity?.name ? `${booking.activity.name} · ` : ''}próximo ${weekday} ${time}`;
};

// Home con sesión: los clubes del jugador (favoritos y donde reservó) para entrar con un toque.
export default function MyClubsSection({ userId }: { userId: number }) {
  const [clubs, setClubs] = useState<MyClub[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [favorites, bookings] = await Promise.all([
          ClubService.getMyFavorites().catch(() => []),
          getMyBookings(userId).catch(() => [] as PlayerBookingDto[])
        ]);
        const bySlug = new Map<string, MyClub>();
        for (const favorite of favorites) {
          const slug = String(favorite?.club?.slug || '').trim();
          if (!slug) continue;
          bySlug.set(slug, { slug, name: favorite.club.name, logoUrl: favorite.club.logoUrl || null, nextLabel: null, nextAt: Infinity });
        }
        const now = Date.now();
        for (const booking of Array.isArray(bookings) ? bookings : []) {
          const slug = String(booking?.club?.slug || '').trim();
          if (!slug) continue;
          const current = bySlug.get(slug) || { slug, name: booking.club.name, logoUrl: booking.club.logoUrl || null, nextLabel: null, nextAt: Infinity };
          if (!current.logoUrl && booking.club.logoUrl) current.logoUrl = booking.club.logoUrl;
          const startAt = new Date(booking.startDateTime).getTime();
          const isUpcoming = booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' && startAt >= now;
          if (isUpcoming && startAt < current.nextAt) {
            current.nextAt = startAt;
            current.nextLabel = formatNext(booking);
          }
          bySlug.set(slug, current);
        }
        // Primero los que tienen un partido próximo, después por nombre.
        const sorted = Array.from(bySlug.values()).sort((a, b) => a.nextAt - b.nextAt || a.name.localeCompare(b.name));
        if (!cancelled) setClubs(sorted.slice(0, 6));
      } catch (error) {
        if (!isAuthSessionInvalidatedError(error)) reportUiError({ area: 'MyClubsSection', action: 'load' }, error);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (clubs.length === 0) return null;

  return (
    <section className="p-myclubs" aria-labelledby="p-myclubs-title">
      <style dangerouslySetInnerHTML={{ __html: MY_CLUBS_CSS }} />
      <div className="p-myclubs-inner">
        <span className="p-home-eyebrow">Mis clubes</span>
        <h2 id="p-myclubs-title" className="p-myclubs-title">Volvé a <i>jugar</i></h2>
        <div className="p-myclubs-grid">
          {clubs.map((club) => (
            <Link key={club.slug} href={`/club/${club.slug}`} className="p-myclubs-card">
              <span className="p-myclubs-mark" aria-hidden="true">
                {club.logoUrl
                  ? <Image src={club.logoUrl} alt="" fill sizes="54px" style={{ objectFit: 'contain' }} unoptimized />
                  : clubInitials(club.name)}
              </span>
              <span className="p-myclubs-info">
                <span className="p-myclubs-name">{club.name}</span>
                <span className="p-myclubs-sub">{club.nextLabel || 'Reservá tu próximo turno'}</span>
              </span>
              <span className="p-myclubs-cta" aria-label="Reservar">
                <span className="p-myclubs-cta-label">Reservar</span>
                <ArrowRight size={16} strokeWidth={2.4} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
