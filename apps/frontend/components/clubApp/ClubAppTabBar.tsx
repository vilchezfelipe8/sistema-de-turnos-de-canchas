import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { CalendarDays, Home, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { BOOKING_INVITATIONS_CHANGED_EVENT, getMyBookingInvitations } from '../../services/BookingService';
import { isAuthSessionInvalidatedError } from '../../utils/apiClient';
import { reportUiError } from '../../utils/uiError';

const TAB_BAR_CSS = `
  .p-clubapp-tabbar { position:fixed; left:0; right:0; bottom:0; z-index:9990; background:var(--surface-1); border-top:1px solid var(--border); box-shadow:0 -10px 28px var(--border-subtle); padding-bottom:env(safe-area-inset-bottom); }
  .p-clubapp-tabbar-inner { max-width:640px; margin:0 auto; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); }
  .p-clubapp-tab { position:relative; min-height:68px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; color:var(--text-muted); font-family:var(--font-sans); font-size:12px; font-weight:700; letter-spacing:.01em; text-decoration:none; transition:color .15s; }
  .p-clubapp-tab:hover { color:var(--text-primary); }
  .p-clubapp-tab[aria-current="page"] { color:var(--accent-fg); font-weight:800; }
  .p-clubapp-tab[aria-current="page"]::before { content:''; position:absolute; top:0; left:28%; right:28%; height:3px; border-radius:0 0 999px 999px; background:var(--accent-fg); }
  .p-clubapp-tab-icon { position:relative; display:inline-flex; }
  .p-clubapp-tab-badge { position:absolute; top:-6px; right:-12px; min-width:18px; height:18px; padding:0 5px; border-radius:999px; border:2px solid var(--surface-1); background:var(--brand); color:var(--brand-on); display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:900; line-height:1; }
`;

// Barra de pestañas de la app del club: lo esencial a un toque y siempre a la vista.
export default function ClubAppTabBar({ slug }: { slug: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [invitationsCount, setInvitationsCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setInvitationsCount(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await getMyBookingInvitations();
        if (!cancelled) setInvitationsCount(Array.isArray(rows) ? rows.length : 0);
      } catch (error) {
        if (!isAuthSessionInvalidatedError(error)) reportUiError({ area: 'ClubAppTabBar', action: 'loadInvitations' }, error);
      }
    };
    void load();
    const onChange = () => { void load(); };
    window.addEventListener('focus', onChange);
    window.addEventListener(BOOKING_INVITATIONS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onChange);
      window.removeEventListener(BOOKING_INVITATIONS_CHANGED_EVENT, onChange);
    };
  }, [user]);

  const onClubPage = router.pathname === '/club/[slug]' && router.query.slug === slug;
  const isBooking = onClubPage && router.query.view === 'reservar';
  const tabs = [
    { key: 'inicio', href: `/club/${slug}`, label: 'Inicio', icon: <Home size={22} strokeWidth={2} />, active: onClubPage && !isBooking },
    { key: 'reservar', href: `/club/${slug}?view=reservar`, label: 'Reservar', icon: <Plus size={22} strokeWidth={2.2} />, active: isBooking },
    {
      key: 'reservas',
      href: '/bookings',
      label: 'Mis reservas',
      icon: <CalendarDays size={22} strokeWidth={2} />,
      active: router.pathname === '/bookings',
      badge: invitationsCount
    }
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: TAB_BAR_CSS }} />
      <nav className="p-clubapp-tabbar" aria-label="Secciones del club">
        <div className="p-clubapp-tabbar-inner">
          {tabs.map((tab) => (
            <Link key={tab.key} href={tab.href} className="p-clubapp-tab" aria-current={tab.active ? 'page' : undefined}>
              <span className="p-clubapp-tab-icon">
                {tab.icon}
                {tab.badge ? <span className="p-clubapp-tab-badge">{tab.badge > 9 ? '9+' : tab.badge}</span> : null}
              </span>
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
