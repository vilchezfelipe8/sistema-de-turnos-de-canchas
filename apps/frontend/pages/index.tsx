import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
import { PUBLIC_SPORT_OPTIONS, PUBLIC_SPORT_LABELS, PublicSport, getPublicClubLocations, matchesPublicClubFilters, normalizeFilterText as normalizeText } from '../utils/publicClubFilters';
import { Search, MapPin, Calendar, Activity, ChevronDown, Check, Volleyball } from 'lucide-react';
import { reportUiError } from '../utils/uiError';
import { useAuth } from '../contexts/AuthContext';
import MyClubsSection from '../components/home/MyClubsSection';
import HeroSportWord from '../components/home/HeroSportWord';
import { useUserTheme } from '../contexts/UserThemeContext';
import NavBar from '../components/NavBar';
import PublicFooter from '../components/PublicFooter';
import ContactPanel, { type ContactMode } from '../components/ContactPanel';
import ClubAppTabBar from '../components/clubApp/ClubAppTabBar';
import { useClubApp } from '../hooks/useClubApp';

import { IoFootballOutline } from "react-icons/io5"; // Pelota de futbol limpia
import { IoTennisballOutline } from "react-icons/io5"; // Pelota de tenis limpia
import UserLoadingState from "../components/UserLoadingState";
import BusyLabel from '../components/ui/BusyLabel';

// --- HELPERS DE UBICACION ---
type LocationSuggestion = {
  label: string;
  query: string;
  city: string;
  province: string;
  country: string;
};

const LOCATION_LIMIT = 6;
// Chips de ciudades: solo la ciudad, con nombres largos abreviados (como en Complejos).
const CITY_SHORT_LABELS: Record<string, string> = { "Ciudad Autónoma de Buenos Aires": "CABA" };
const cityChipLabel = (city: string) => CITY_SHORT_LABELS[city] || city;

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Fotos servidas desde /public/home (comprimidas), no desde un sitio externo.
const SPORT_CARDS = [
  { name: PUBLIC_SPORT_LABELS.football, sub: 'F5 · F7 · F11', sport: 'football', photo: '/home/sport-football.webp', bgPosition: 'center 52%', accent: 'var(--brand)', countKey: 'futbol' as const },
  { name: PUBLIC_SPORT_LABELS.padel, sub: 'Cubierto & Panorámico', sport: 'padel', photo: '/home/sport-padel.webp', bgPosition: 'center 42%', accent: 'var(--accent-fg)', countKey: 'padel' as const },
  { name: PUBLIC_SPORT_LABELS.tennis, sub: 'Polvo & cemento', sport: 'tennis', photo: '/home/sport-tennis.webp', bgPosition: 'center 54%', accent: 'var(--lima-500)', countKey: 'tenis' as const },
  { name: 'Otros deportes', sub: 'Hockey · Vóley · Básquet', sport: '', photo: '/home/sport-other.webp', bgPosition: 'center', accent: 'var(--accent-fg)', countKey: 'otros' as const },
];

// Solo cosas que la app hace hoy.
const VALUES = [
  { num: '01', title: 'Horarios en tiempo real', desc: 'Ves qué canchas están libres y reservás en el momento.' },
  { num: '02', title: 'Precio antes de confirmar', desc: 'Sabés cuánto pagás, con luces incluidas, antes de reservar.' },
  { num: '03', title: 'Todo en Mis reservas', desc: 'Tus turnos, invitaciones y pagos en un mismo lugar.' },
  { num: '04', title: 'Jugá con tu grupo', desc: 'Invitá a tus compañeros o avisales por WhatsApp.' },
];

// Coinciden con lo que muestra el checkout (cancelación, formas de pago).
const FAQ = [
  { q: '¿Tengo que pagar para usar Pique?', a: 'No. Usar Pique es gratis para jugadores. Solo pagás el valor de la reserva definido por el complejo.' },
  { q: '¿Puedo cancelar una reserva?', a: 'Sí. Desde Mis reservas la cancelás gratis hasta que empiece el turno, si todavía no la pagaste. Si ya pagaste, hablalo con el club.' },
  { q: '¿Cómo pago el turno?', a: 'Según el club: en el mostrador el día del turno o, si el club lo tiene activado, online con Mercado Pago al confirmar.' },
  { q: '¿Con cuánta anticipación puedo reservar?', a: 'Depende de cada club: en la grilla ves los días que tiene abiertos para reservar.' },
];

export default function Home() {
  // En la app instalada de un club, el home de Pique mantiene la barra del club para poder volver.
  const clubApp = useClubApp();
  const router = useRouter();
  const { user: authUser } = useAuth();
  const { isLight } = useUserTheme();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  // Panel de contacto: null cerrado; 'owner' cuando lo abre un complejo que quiere sumarse.
  const [contactMode, setContactMode] = useState<ContactMode | null>(null);
  // Con sesión: cuántos clubes propios hay (null mientras carga). Si hay, ocupan la columna derecha de la portada.
  const [myClubsCount, setMyClubsCount] = useState<number | null>(null);
  const sportClubCounts = useMemo(() => {
    if (!clubs.length) return { futbol: 0, padel: 0, tenis: 0, otros: 0 };
    const counts = { futbol: 0, padel: 0, tenis: 0, otros: 0 };
    for (const club of clubs) {
      const sports = club.publicSports || [];
      if (sports.includes('football')) counts.futbol++;
      if (sports.includes('padel')) counts.padel++;
      if (sports.includes('tennis')) counts.tenis++;
      if (sports.every(sport => !['football', 'padel', 'tennis'].includes(sport))) counts.otros++;
    }
    return counts;
  }, [clubs]);

  // track which FAQ item is currently open (null if none)
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const faqRefs = useRef<Array<HTMLDivElement | null>>([]);
  const shouldAnimateMarquee = clubs.length >= 6;
  const marqueeClubs = shouldAnimateMarquee ? [...clubs, ...clubs] : clubs;
  const closeContact = useCallback(() => setContactMode(null), []);

  // close open FAQ when clicking outside the open item's box
  useEffect(() => {
    const handler = (evt: MouseEvent) => {
      if (openFaqIndex === null) return;
      const currentRef = faqRefs.current[openFaqIndex];
      if (currentRef && !currentRef.contains(evt.target as Node)) {
        setOpenFaqIndex(null);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openFaqIndex]);

  useEffect(() => {
    const els = document.querySelectorAll('.p-home-sr,.p-home-sr-up,.p-home-sr-left,.p-home-sr-right');
    if (!els.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('p-home-in'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    router.events.on('routeChangeStart', closeContact);
    return () => {
      router.events.off('routeChangeStart', closeContact);
    };
  }, [router.events, closeContact]);

  useEffect(() => {
    const ownerSection = ownerSectionRef.current;
    if (!ownerSection) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let sectionVisible = false;
    let rafId: number | null = null;

    const updateParallax = () => {
      if (reducedMotion.matches) {
        ownerSection.style.setProperty('--p-home-owner-parallax', '0px');
        return;
      }
      const rect = ownerSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height);
      const clamped = Math.max(0, Math.min(1, progress));
      ownerSection.style.setProperty('--p-home-owner-parallax', `${((clamped - 0.5) * 24).toFixed(2)}px`); // -12..12
    };

    const scheduleParallax = () => {
      if (!sectionVisible && !reducedMotion.matches) return;
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateParallax();
      });
    };

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      sectionVisible = entry.isIntersecting;
      scheduleParallax();
    }, { rootMargin: '120px 0px' });

    visibilityObserver.observe(ownerSection);
    window.addEventListener('scroll', scheduleParallax, { passive: true });
    window.addEventListener('resize', scheduleParallax);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      visibilityObserver.disconnect();
      window.removeEventListener('scroll', scheduleParallax);
      window.removeEventListener('resize', scheduleParallax);
    };
  }, []);

  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const ownerSectionRef = useRef<HTMLElement | null>(null);

  // Estados del Buscador
  const [searchCity, setSearchCity] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [searchSport, setSearchSport] = useState<PublicSport>('');
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  // Fecha seleccionada en formato YYYY-MM-DD. Por defecto, el dia de hoy.
  const getEffectiveToday = () => {
    // Aqui podemos aplicar offsets si fuera necesario (zona horaria / reglas de negocio).
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const [searchDate, setSearchDate] = useState(() => formatLocalDate(getEffectiveToday()));

  const sportIcons: Partial<Record<PublicSport, React.ReactNode>> = {
    padel: (
      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
        <g>
          <circle cx="12.41" cy="3.19" r="0.62" fill="currentColor" />
          <circle cx="14.17" cy="4.99" r="0.62" fill="currentColor" />
          <circle cx="15.94" cy="6.8" r="0.62" fill="currentColor" />
          <circle cx="10.61" cy="4.96" r="0.62" fill="currentColor" />
          <circle cx="12.37" cy="6.75" r="0.62" fill="currentColor" />
          <circle cx="14.14" cy="8.56" r="0.62" fill="currentColor" />
          <circle cx="8.81" cy="6.72" r="0.62" fill="currentColor" />
          <circle cx="10.56" cy="8.52" r="0.62" fill="currentColor" />
          <circle cx="12.34" cy="10.33" r="0.62" fill="currentColor" />
          <path
            fill="currentColor"
            d="M17.94,9.89a4.1,4.1,0,0,0,1.11-3.43A5.72,5.72,0,0,0,18,4l-.75-1-1-1-.15-.16A7.65,7.65,0,0,0,14.39.59,4.17,4.17,0,0,0,9.53,1,14.21,14.21,0,0,0,7.91,2.59,9.38,9.38,0,0,0,6,5.77c-.2.54-.28,1.12-.45,1.72-.42,1.36-.77,2.69-1.15,4a1.61,1.61,0,0,1-.42.74L2.77,13.47a.3.3,0,0,1-.41,0h0a.3.3,0,0,0-.43,0L.3,15.06a1,1,0,0,0,0,1.39l2.13,2.18a1,1,0,0,0,1.39,0L5.45,17a.32.32,0,0,0,0-.45h0a.29.29,0,0,1,0-.38L6.66,15a1.93,1.93,0,0,1,.78-.43l4-1,.3-.06a12.76,12.76,0,0,0,1.51-.36A11.46,11.46,0,0,0,17.94,9.89ZM3.3,17.54a.37.37,0,0,1-.52,0h0L1.4,16.12a.37.37,0,0,1,0-.52h0l.85-.84a.36.36,0,0,1,.51,0h0a.23.23,0,0,0,.29,0l1.57-1.52a.36.36,0,0,1,.51,0h0l.61.62a.37.37,0,0,1,0,.52h0L4.17,15.88a.24.24,0,0,0,0,.3h0a.37.37,0,0,1,0,.51Zm4.2-4.26A1.18,1.18,0,0,1,6.39,13L6,12.62a1.37,1.37,0,0,1-.26-1.12c.1-.38.2-.77.32-1.15A6.59,6.59,0,0,0,8.69,13ZM12.83,12a4.3,4.3,0,0,1-3.41,0A4.38,4.38,0,0,1,7.11,6.25,10.13,10.13,0,0,1,8.85,3.43c.27-.26.5-.55.75-.82A5,5,0,0,1,11,1.55a3,3,0,0,1,2.59.09,8.65,8.65,0,0,1,2.57,2.05,7.32,7.32,0,0,1,1.31,1.9A3,3,0,0,1,17,9,10.36,10.36,0,0,1,12.83,12Z"
          />
        </g>
      </svg>
    ),
    football: <IoFootballOutline className="h-5 w-5" />,
    tennis: <IoTennisballOutline className="h-5 w-5" />,
    volleyball: <Volleyball className="h-5 w-5" />,
  };
  const sportOptions = PUBLIC_SPORT_OPTIONS.map(option => ({
    ...option,
    icon: sportIcons[option.value] || <Activity className="h-5 w-5" />,
  }));

  const selectedSport = sportOptions.find((sport) => sport.value === searchSport) || sportOptions[0];

  useEffect(() => {
    const loadClubs = async () => {
      try {
        const allClubs = await ClubService.getAllClubs();
        setClubs(allClubs);
      } catch (error) {
        reportUiError({ area: 'HomePage', action: 'loadClubs' }, error);
      } finally {
        setLoadingClubs(false);
      }
    };
    loadClubs();
  }, []);

  const locationOptions = useMemo(() => getPublicClubLocations(clubs), [clubs]);
  const selectedCity = selectedLocation?.city || '';
  // Deportes sin clubes no se ofrecen (llevarían a una búsqueda vacía), salvo el elegido.
  const sportMenuOptions = sportOptions
    .map(option => ({ ...option, count: clubs.filter(club => matchesPublicClubFilters(club, { zone: selectedCity, sport: option.value })).length }))
    .filter(option => option.value === '' || option.count > 0 || option.value === searchSport);
  // Sin texto: todas las ciudades; con texto: las que coinciden. Siempre con su cantidad de clubes.
  const cityMenuOptions = (searchCity.trim() && !selectedLocation ? locationSuggestions : locationOptions.slice(0, LOCATION_LIMIT))
    .map(location => ({ location, count: clubs.filter(club => matchesPublicClubFilters(club, { zone: location.city, sport: searchSport })).length }))
    .filter(option => option.count > 0 || option.location.city === selectedCity);

  useEffect(() => {
    if (!searchCity.trim()) {
      setLocationSuggestions([]);
      if (selectedLocation) {
        setSelectedLocation(null);
      }
      return;
    }

    if (selectedLocation && searchCity !== selectedLocation.label) {
      setSelectedLocation(null);
    }

    const term = normalizeText(searchCity);
    const filtered = locationOptions.filter((option) =>
      normalizeText(option.query).includes(term) || normalizeText(option.label).includes(term)
    );
    setLocationSuggestions(filtered.slice(0, LOCATION_LIMIT));
  }, [searchCity, selectedLocation, locationOptions]);

  const handleSearch = () => {
    const query: Record<string, string> = {};
    const cityTerm = searchCity.trim();
    if (cityTerm) {
      const normalizedTerm = normalizeText(cityTerm);
      const matchedLocation = (
        selectedLocation && normalizeText(selectedLocation.label) === normalizedTerm
      )
        ? selectedLocation
        : locationOptions.find((option) =>
            normalizeText(option.label) === normalizedTerm ||
            normalizeText(option.city) === normalizedTerm
          ) || null;

      if (matchedLocation?.city) {
        query.zone = matchedLocation.city;
      } else {
        query.q = cityTerm;
      }
    }
    if (searchSport) query.sport = searchSport;
    // La fecha elegida viaja hasta la grilla del club (hoy es el valor por defecto, no hace falta).
    if (searchDate && searchDate !== formatLocalDate(getEffectiveToday())) query.date = searchDate;
    // El botón muestra el spinner mientras carga Complejos.
    setIsSearching(true);
    void router.push({ pathname: '/complejos', query }).finally(() => setIsSearching(false));
  };

  const selectCity = (location: LocationSuggestion) => {
    setSearchCity(location.label);
    setSelectedLocation(location);
    setShowCityDropdown(false);
  };

  const searchDays = (() => {
    const today = getEffectiveToday();
    const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const label = offset === 0 ? 'Hoy' : offset === 1 ? 'Mañana' : `${weekdays[date.getDay()]} ${date.getDate()}`;
      const sub = offset <= 1 ? `${weekdays[date.getDay()].toLowerCase()} ${date.getDate()}/${date.getMonth() + 1}` : `${date.getDate()}/${date.getMonth() + 1}`;
      return { key: formatLocalDate(date), label, sub };
    });
  })();
  const selectedDayLabel = searchDays.find(day => day.key === searchDate)?.label || 'Hoy';
  const heroCompact = Boolean(authUser?.id) && Boolean(myClubsCount);
  const showHowItWorks = !authUser?.id || myClubsCount === 0;

  const homeCss = `
    .p-home-root.p-home-clubapp { padding-bottom:calc(84px + env(safe-area-inset-bottom)); }
    .p-home-root { min-height:100vh; background:var(--bg); color:var(--text-primary); font-family:var(--font-sans); -webkit-font-smoothing:antialiased; overflow-x:clip; --p-home-bg-a:var(--bg); --p-home-bg-b:var(--surface-1); --p-home-bg-c:var(--surface-2); }
    .p-home-root *,.p-home-root *::before,.p-home-root *::after { box-sizing:border-box; }
    .p-home-root a { color:inherit; text-decoration:none; }
    .p-home-root ::selection { background:var(--brand); color:var(--brand-on); }
    /* Header actions */
    .p-home-btn { display:inline-flex; align-items:center; gap:8px; padding:9px 18px; border-radius:999px; font-size:13px; font-weight:700; border:1px solid var(--border); background:var(--surface-1); color:var(--text-secondary); cursor:pointer; transition:transform .15s,box-shadow .15s; font-family:inherit; }
    .p-home-btn:hover { transform:translateY(-1px); box-shadow:var(--shadow-md); }
    .p-home-btn-primary { background:var(--brand)!important; color:var(--brand-on)!important; border-color:var(--accent-fg)!important; }
    .p-home-btn-primary:hover { background:var(--accent-fg)!important; }
    .p-home-btn-ghost { background:var(--border-subtle); border-color:var(--border); }
    .p-home-btn-ghost:hover { background:var(--border); }
    /* Hero */
    .p-home-hero { position:relative; z-index:10; min-height:92vh; display:flex; align-items:flex-end; padding:120px 40px 64px; overflow:visible; }
    .p-home-hero-visuals { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
    .p-home-hero-bg { position:absolute; inset:0; overflow:hidden; background:linear-gradient(135deg,var(--ink-900) 0%,var(--bg) 45%,var(--lima-900) 100%); }
    .p-home-hero-bg::before,
    .p-home-hero-bg::after { content:''; position:absolute; inset:-22%; }
    .p-home-hero-bg::before {
      background:radial-gradient(ellipse 62% 50% at 20% 100%,var(--accent-bg-muted),transparent 70%),
                 radial-gradient(ellipse 42% 38% at 85% 15%,var(--accent-bg-faint),transparent 66%);
    }
    .p-home-hero-bg::after {
      background:radial-gradient(ellipse 44% 34% at 68% 72%,rgba(182,243,106,.13),transparent 68%),
                 radial-gradient(ellipse 36% 28% at 9% 20%,rgba(255,255,255,.08),transparent 64%);
      opacity:.7;
    }
    .p-home-hero-noise { position:absolute; inset:0; opacity:.022; pointer-events:none; background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
    .p-home-hero-inner { position:relative; z-index:2; max-width:1360px; margin:0 auto; width:100%; display:grid; grid-template-columns:1.2fr auto; align-items:end; gap:48px; }
    .p-home-hero-copy { max-width:720px; }
    .p-home-hero-eyebrow { display:inline-flex; align-items:center; gap:10px; padding:6px 14px 6px 10px; background:var(--border-subtle); border:1px solid var(--border); border-radius:999px; font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:28px; }
    .p-home-hero-eyebrow-dot { width:6px; height:6px; border-radius:50%; background:var(--brand); box-shadow:0 0 0 3px var(--accent-border); animation:p-home-pulse 1.6s ease-in-out infinite; }
    @keyframes p-home-pulse { 0%,100%{opacity:1}50%{opacity:.5} }
    .p-home-hero-h1 { font-size:clamp(52px,8vw,108px); font-weight:800; letter-spacing:-.045em; line-height:.96; margin:0 0 24px; color:var(--ink-50); }
    .p-home-hero-h1 i { font-style:italic; font-weight:700; color:var(--accent-fg); }
    .p-home-hero-h1 .p-home-grad-text { color:unset; }
    .p-home-hero-sub { font-size:17px; font-weight:400; color:var(--text-secondary); line-height:1.55; max-width:500px; margin:0 0 36px; }
    /* Search */
    .p-home-search { position:relative; z-index:25; display:flex; gap:0; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:999px; padding:4px; max-width:620px; align-items:center; flex-wrap:wrap; }
    .p-home-search-seg { display:flex; align-items:center; gap:8px; padding:10px 16px; font-size:13px; font-weight:600; color:var(--text-secondary); cursor:pointer; position:relative; white-space:nowrap; border-radius:999px; transition:background .15s; }
    .p-home-search-seg:hover { background:var(--border-subtle); }
    .p-home-search-caret { width:12px; height:12px; color:var(--text-muted); flex-shrink:0; transform-origin:center; transition:transform .22s ease, color .18s ease; }
    .p-home-search-seg:hover .p-home-search-caret { color:var(--text-muted); }
    .p-home-search-caret.p-home-search-caret-open { transform:rotate(180deg); color:var(--accent-fg); }
    .p-home-search-divider { width:1px; height:28px; background:var(--border); flex-shrink:0; margin:0 2px; }
    .p-home-search-loc { flex:1; position:relative; min-width:0; }
    .p-home-search-input { flex:1; min-width:120px; padding:10px 14px; background:transparent; border:none; color:var(--text-secondary); font-family:var(--font-sans); font-size:13px; font-weight:500; outline:none; }
    .p-home-search-input::placeholder { color:var(--text-secondary); }
    .p-home-search-cta { padding:12px 20px; background:var(--brand); color:var(--brand-on); border:none; border-radius:999px; font-size:13px; font-weight:700; display:inline-flex; align-items:center; gap:8px; transition:background .15s; cursor:pointer; font-family:inherit; white-space:nowrap; flex-shrink:0; }
    .p-home-search-cta:hover { background:var(--brand-hover); }
    .p-home-search-quicks { display:flex; gap:6px; margin-top:14px; flex-wrap:wrap; }
    .p-home-quick-chip { padding:5px 13px; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:999px; font-size:12px; font-weight:500; color:var(--text-secondary); transition:background .15s,color .15s; cursor:pointer; font-family:inherit; }
    .p-home-quick-chip:hover { background:var(--border-subtle); color:var(--ink-50); }
    /* Trust */
    /* Sports */
    .p-home-sports { padding:72px 40px; background:var(--p-home-bg-a); border-bottom:1px solid var(--border-subtle); }
    .p-home-sports-head { max-width:1360px; margin:0 auto 36px; display:flex; justify-content:space-between; align-items:flex-end; gap:24px; flex-wrap:wrap; }
    .p-home-sports-h3 { font-size:32px; font-weight:700; letter-spacing:-.03em; margin:0; color:var(--text-primary); }
    .p-home-sports-h3 i { font-style:italic; color:var(--accent-fg); }
    .p-home-sports-grid { max-width:1360px; margin:0 auto; display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .p-home-sport-card { position:relative; height:260px; border-radius:18px; overflow:hidden; border:1px solid var(--border-subtle); display:flex; flex-direction:column; justify-content:flex-end; padding:20px 22px; cursor:pointer; transition:border-color .3s,transform .3s; text-decoration:none; }
    .p-home-sport-card:hover { border-color:var(--accent-border); transform:translateY(-3px); }
    .p-home-sport-bg { position:absolute; inset:0; background-size:cover; background-position:center; transition:transform .5s; }
    .p-home-sport-card:hover .p-home-sport-bg { transform:scale(1.05); }
    .p-home-sport-bg::after { content:''; position:absolute; inset:0; background:linear-gradient(0deg,var(--overlay-strong),transparent 60%); }
    .p-home-sport-content { position:relative; z-index:2; }
    .p-home-sport-count { font-size:10px; color:var(--text-muted); letter-spacing:.03em; font-weight:600; margin-bottom:6px; }
    .p-home-sport-name { font-size:22px; font-weight:800; letter-spacing:-.02em; color:var(--ink-50); }
    /* Clubs */
    /* Section wrapper */
    .p-home-sec-w { max-width:1360px; margin:0 auto; padding:100px 40px; }
    .p-home-eyebrow { display:inline-flex; align-items:center; gap:10px; font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--text-secondary); margin-bottom:20px; }
    .p-home-eyebrow::before { content:''; display:inline-block; width:24px; height:1px; background:var(--text-muted); }
    .p-home-sec-h { font-size:clamp(36px,4.5vw,60px); font-weight:700; letter-spacing:-.035em; line-height:1.02; margin:0 0 20px; color:var(--text-primary); }
    .p-home-sec-h b { font-weight:900; }
    .p-home-sec-h i { font-style:italic; color:var(--accent-fg); }
    .p-home-sec-sub { font-size:16px; font-weight:400; color:var(--text-secondary); line-height:1.55; max-width:560px; margin:0 0 52px; }
    /* Values */
    .p-home-values-band { border-top:1px solid var(--border-subtle); background:var(--p-home-bg-b); }
    .p-home-values-grid { display:grid; grid-template-columns:1fr 1fr; gap:80px; align-items:start; }
    .p-home-values-h { position:sticky; top:90px; }
    .p-home-values-list { display:flex; flex-direction:column; }
    .p-home-value { padding:36px 0; border-top:1px solid var(--border-subtle); display:grid; grid-template-columns:72px 1fr; gap:24px; align-items:start; }
    .p-home-value:first-child { border-top:0; padding-top:0; }
    .p-home-value-num { font-size:34px; font-weight:700; color:var(--text-muted); letter-spacing:-.04em; line-height:1; }
    .p-home-value-body h4 { margin:0 0 8px; font-size:20px; font-weight:800; color:var(--text-primary); }

    .p-home-value-body p { margin:0; color:var(--text-secondary); font-size:14px; line-height:1.7; max-width:400px; }
    /* Stats */
    /* Steps */
    /* Owner */
    .p-home-owner { --p-home-owner-parallax:0px; position:relative; isolation:isolate; border-top:1px solid var(--border-subtle); background:var(--bg); overflow:hidden; }
    .p-home-owner-media { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; transform:translate3d(0,var(--p-home-owner-parallax),0); will-change:transform; }
    .p-home-owner-media-img { position:absolute; inset:-4%; background-image:url('/home/owner.webp'); background-size:cover; background-position:center; opacity:.58; transform:scale(1.03); will-change:transform; animation:p-home-owner-kenburns 24s ease-in-out infinite alternate; }
    .p-home-owner::after { content:''; position:absolute; inset:0; background:linear-gradient(112deg,var(--overlay-strong) 12%,var(--overlay-strong) 48%,var(--overlay-strong) 100%),linear-gradient(180deg,var(--overlay) 0%,var(--overlay-strong) 100%); z-index:1; pointer-events:none; }
    .p-home-owner-inner { position:relative; z-index:2; max-width:1360px; margin:0 auto; padding:106px 40px; display:grid; grid-template-columns:1.05fr .95fr; gap:72px; align-items:center; }
    .p-home-owner .p-home-sec-h { max-width:620px; }
    .p-home-owner .p-home-sec-sub { max-width:520px; margin-bottom:30px; color:var(--text-secondary); }
    .p-home-owner-side { padding:34px; border:1px solid var(--border-strong); border-radius:20px; background:var(--overlay); backdrop-filter:blur(8px); }
    .p-home-owner-side-h { font-size:10px; color:var(--text-muted); font-weight:700; letter-spacing:.04em; margin-bottom:20px; }
    .p-home-owner-perk { display:flex; gap:14px; align-items:center; padding:13px 0; border-top:1px solid var(--border-subtle); font-size:13px; color:var(--text-secondary); font-weight:400; }
    .p-home-owner-perk:first-child { border-top:0; padding-top:0; }
    .p-home-owner-perk b { color:var(--text-primary); font-size:16px; letter-spacing:-.02em; min-width:90px; font-weight:800; }
    .p-home-owner-ctas { display:flex; gap:10px; margin-top:32px; flex-wrap:wrap; }
    @keyframes p-home-owner-kenburns {
      0% { transform:scale(1.03) translate3d(-1.2%, -0.8%, 0); }
      50% { transform:scale(1.07) translate3d(0.9%, 1.1%, 0); }
      100% { transform:scale(1.05) translate3d(-0.6%, 1.3%, 0); }
    }
    /* FAQ */
    .p-home-faq-band { border-top:1px solid var(--border-subtle); background:linear-gradient(180deg,var(--p-home-bg-a) 0%,var(--p-home-bg-c) 100%); }
    .p-home-faq-grid { display:grid; grid-template-columns:1fr 1.2fr; gap:72px; align-items:start; }
    .p-home-faq-list { position:relative; display:flex; flex-direction:column; padding-left:26px; }
    .p-home-faq-list::before { content:''; position:absolute; left:0; top:6px; bottom:6px; width:1px; background:linear-gradient(180deg,var(--accent-border-strong) 0%,var(--border-subtle) 100%); }
    .p-home-faq-item { border-top:1px solid var(--border-subtle); padding:22px 0 22px 2px; cursor:pointer; }
    .p-home-faq-item:last-child { border-bottom:1px solid var(--border-subtle); }
    .p-home-faq-q { display:flex; justify-content:space-between; align-items:center; gap:16px; font-size:16px; font-weight:700; color:var(--text-primary); }
    .p-home-faq-icon { flex-shrink:0; color:var(--text-muted); transition:transform .3s,color .3s; }
    .p-home-faq-item.p-home-open .p-home-faq-icon { transform:rotate(45deg); color:var(--accent-fg); }
    .p-home-faq-a { max-height:0; overflow:hidden; transition:max-height .4s cubic-bezier(.2,.6,.2,1),margin .3s; color:var(--text-secondary); font-size:14px; line-height:1.7; }
    .p-home-faq-item.p-home-open .p-home-faq-a { max-height:300px; margin-top:14px; }
    /* Closing */
    .p-home-big-closing { font-size:clamp(44px,7vw,88px); font-weight:800; letter-spacing:-.05em; line-height:.98; color:var(--text-primary); margin:0 0 36px; }
    .p-home-big-closing i { font-style:italic; color:var(--accent-fg); }
    @media (prefers-reduced-motion: reduce) {
      .p-home-hero-bg::before,
      .p-home-hero-bg::after,
      .p-home-aurora-orb { animation:none; }
      .p-home-owner-media { transform:translate3d(0,0,0); }
      .p-home-owner-media-img { animation:none; transform:scale(1.03); }
    }
    /* Footer */
    /* Contact panel */
    /* Dropdowns */
    .p-home-dropdown { position:absolute; top:calc(100% + 8px); left:0; min-width:220px; width:max-content; max-width:min(360px, calc(100vw - 32px)); background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-md); z-index:100; }
    /* Responsive */
    @media(max-width:1024px){
      .p-home-hero-inner{grid-template-columns:1fr;gap:40px}
      .p-home-values-grid{grid-template-columns:1fr;gap:40px}
      .p-home-values-h{position:static}
      .p-home-owner-inner{grid-template-columns:1fr;gap:48px;padding:72px 32px}
      .p-home-faq-grid{grid-template-columns:1fr;gap:40px}
      .p-home-sports-grid{grid-template-columns:repeat(2,1fr)}
    }
    @media(max-width:900px){
    }
    @media(max-width:720px){
      .p-home-hero{padding:100px 24px 56px;min-height:auto}
      .p-home-sports{padding:52px 24px}
      .p-home-sports-grid{grid-template-columns:1fr;gap:10px}
      .p-home-sec-w{padding:64px 24px}
      .p-home-owner-inner{padding:56px 24px}
      .p-home-search{border-radius:24px;padding:8px;gap:8px}
      .p-home-search-divider{display:none}
      .p-home-search-sport{order:1;flex:1 1 0;min-width:0}
      .p-home-search-date{order:2;flex:0 0 auto;margin-left:auto}
      .p-home-search-loc{order:3;flex:1 0 100%}
      .p-home-search-input{width:100%;min-width:0;padding:12px 14px}
      .p-home-search-cta{order:4;width:100%;justify-content:center;padding:14px 18px}
      .p-home-search .p-home-dropdown{left:0;right:auto;width:100%;min-width:0;max-width:100%}
    }
    @media(max-width:480px){
    }
    /* Scroll reveal */
    .p-home-sr { opacity:0; transform:translateY(28px); transition:opacity .75s cubic-bezier(.2,.8,.2,1), transform .75s cubic-bezier(.2,.8,.2,1); }
    .p-home-sr.p-home-in { opacity:1; transform:translateY(0); }
    .p-home-sr-d1 { transition-delay:.08s; }
    .p-home-sr-d2 { transition-delay:.18s; }
    .p-home-sr-d3 { transition-delay:.28s; }
    .p-home-sr-d4 { transition-delay:.38s; }
    .p-home-sr-up { opacity:0; transform:translateY(40px); transition:opacity .8s cubic-bezier(.2,.8,.2,1), transform .8s cubic-bezier(.2,.8,.2,1); }
    .p-home-sr-up.p-home-in { opacity:1; transform:translateY(0); }
    .p-home-sr-left { opacity:0; transform:translateX(-24px); transition:opacity .75s cubic-bezier(.2,.8,.2,1), transform .75s cubic-bezier(.2,.8,.2,1); }
    .p-home-sr-left.p-home-in { opacity:1; transform:translateX(0); }
    .p-home-sr-right { opacity:0; transform:translateX(24px); transition:opacity .75s cubic-bezier(.2,.8,.2,1), transform .75s cubic-bezier(.2,.8,.2,1); }
    .p-home-sr-right.p-home-in { opacity:1; transform:translateX(0); }
    /* Hero fade-in stagger */
    @keyframes p-home-fade-up { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
    .p-home-hero-eyebrow { animation:p-home-fade-up .7s ease both .05s; }
    .p-home-hero-h1 { animation:p-home-fade-up .85s ease both .18s; }
    .p-home-hero-sub { animation:p-home-fade-up .7s ease both .38s; }
    .p-home-search { animation:p-home-fade-up .7s ease both .52s; }
    .p-home-search-quicks { animation:p-home-fade-up .6s ease both .68s; }
    /* Hero stat bar */
    .p-home-hero-stat { display:flex; align-items:center; gap:8px; margin-top:18px; font-size:13px; color:var(--text-secondary); font-weight:500; animation:p-home-fade-up .6s ease both .82s; }
    .p-home-hero-stat b { color:var(--positive-fg); font-weight:700; }
    .p-home-hero-stat-dot { width:6px; height:6px; border-radius:50%; background:var(--brand); opacity:.7; flex-shrink:0; }
    /* Marquee strip */
    .p-home-marquee-wrap { overflow:hidden; border-bottom:1px solid var(--border-subtle); background:var(--surface-1); padding:20px 0; }
    .p-home-marquee-track { display:flex; gap:14px; width:max-content; animation:p-home-marquee 40s linear infinite; }
    .p-home-marquee-wrap:hover .p-home-marquee-track { animation-play-state:paused; }
    .p-home-marquee-track.p-home-marquee-static { width:100%; min-width:100%; justify-content:center; flex-wrap:wrap; padding:0 24px; animation:none; }
    @keyframes p-home-marquee { to { transform:translateX(-50%); } }
    .p-home-marquee-item { display:inline-flex; align-items:center; gap:8px; padding:7px 16px; background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:999px; font-size:12px; font-weight:600; color:var(--text-muted); white-space:nowrap; transition:color .2s,border-color .2s; cursor:pointer; }
    .p-home-marquee-label { display:none; margin:0 20px 10px; font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); }
    .p-home-marquee-item:hover { color:var(--text-secondary); border-color:var(--border); }
    .p-home-marquee-dot { width:5px; height:5px; border-radius:50%; background:var(--brand); opacity:.5; flex-shrink:0; }
    /* Sport card count overlay */
    .p-home-sport-club-count { display:inline-block; margin-bottom:6px; padding:3px 9px; border-radius:999px; background:rgba(10,12,16,.62); color:#fff; font-size:11px; font-weight:800; letter-spacing:.02em; backdrop-filter:blur(4px); }
    /* Aurora orbs */
    .p-home-aurora-orb { position:absolute; border-radius:50%; pointer-events:none; background:radial-gradient(ellipse at center,var(--p-home-aurora-color) 0%,transparent 72%); }
    .p-home-aurora-1 { --p-home-aurora-color:var(--accent-bg-soft); width:700px; height:500px; top:-150px; left:-140px; }
    .p-home-aurora-2 { --p-home-aurora-color:var(--accent-bg-soft); width:580px; height:420px; bottom:-120px; right:8%; }
    .p-home-aurora-3 { --p-home-aurora-color:var(--accent-bg-faint); width:360px; height:280px; top:35%; right:22%; }
    /* Static gradient avoids repainting the large heading on every frame. */
    .p-home-grad-text { display:inline-block; overflow:visible; padding-inline:.14em; margin-inline:-.14em; background:linear-gradient(90deg,var(--accent-fg) 0%,var(--brand-hover) 35%,var(--brand-hover) 65%,var(--accent-fg) 100%); background-size:220% 100%; background-repeat:no-repeat; background-position:0% 50%; -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; font-style:italic; }
    /* Rotating sport word */
    .p-home-sport-word { display:inline-block; letter-spacing:0; line-height:1.02; overflow:visible; padding-inline:.1em; margin-inline:-.1em; transition:opacity .36s ease, transform .36s ease; }
    .p-home-sport-word-out { opacity:0; transform:translateY(12px); }
    @media(prefers-reduced-motion:reduce) {
      .p-home-hero *, .p-home-hero *::before, .p-home-hero *::after { animation:none!important; transition:none!important; }
    }
    /* Sport card per-card glow */
    .p-home-sport-card:hover { border-color:var(--border); transform:translateY(-5px); }
    /* Universal close button */
    /* Light theme */
    .p-home-root.p-home-theme-light { background:var(--bg); color:var(--text-primary); --p-home-bg-a:var(--bg); --p-home-bg-b:var(--surface-2); --p-home-bg-c:var(--surface-3); }
    .p-home-root.p-home-theme-light .p-home-btn { background:var(--surface-1); color:var(--text-primary); border-color:var(--border-strong); box-shadow:0 2px 12px var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-btn-primary { background:var(--brand)!important; color:var(--brand-on)!important; border-color:var(--accent-fg)!important; box-shadow:none; }
    .p-home-root.p-home-theme-light .p-home-btn-ghost { background:var(--surface-1); border-color:var(--border); }
    .p-home-root.p-home-theme-light .p-home-hero-bg { background:linear-gradient(180deg,#fbfff4 0%,rgba(245,244,240,.9) 52%,#eef8df 100%); }
    .p-home-root.p-home-theme-light .p-home-hero-bg::before {
      background:radial-gradient(ellipse 62% 52% at 18% 96%,rgba(182,243,106,.48) 0%,rgba(182,243,106,.22) 38%,transparent 72%),
                 radial-gradient(ellipse 42% 38% at 86% 15%,rgba(47,175,106,.22) 0%,rgba(47,175,106,.1) 36%,transparent 68%);
      opacity:1;
      filter:saturate(1.14);
    }
    .p-home-root.p-home-theme-light .p-home-hero-bg::after {
      background:radial-gradient(ellipse 44% 34% at 68% 72%,rgba(255,209,102,.22),transparent 68%);
      opacity:.58;
      mix-blend-mode:multiply;
    }
    .p-home-root.p-home-theme-light .p-home-hero-noise { opacity:0; }
    .p-home-root.p-home-theme-light .p-home-hero-h1 { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-grad-text { background-image:linear-gradient(90deg,var(--positive-fg) 0%,var(--accent-fg) 50%,var(--positive-fg) 100%); }
    .p-home-root.p-home-theme-light .p-home-hero-sub { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-hero-eyebrow { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); box-shadow:0 8px 20px var(--border); }
    .p-home-root.p-home-theme-light .p-home-search { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 24px var(--border); }
    .p-home-root.p-home-theme-light .p-home-search-seg { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-search-seg:hover { background:var(--surface-2); }
    .p-home-root.p-home-theme-light .p-home-search-caret { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-search-seg:hover .p-home-search-caret { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-search-caret.p-home-search-caret-open { color:var(--positive-fg); }
    .p-home-root.p-home-theme-light .p-home-search-divider { background:var(--border); }
    .p-home-root.p-home-theme-light .p-home-search-input { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-search-input::placeholder { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-quick-chip { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-quick-chip:hover { background:var(--surface-2); color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-sports { border-bottom-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-sports-h3,
    .p-home-root.p-home-theme-light .p-home-sec-h,
    .p-home-root.p-home-theme-light .p-home-value-body h4,
    .p-home-root.p-home-theme-light .p-home-big-closing { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-sport-card { border-color:var(--border); box-shadow:0 8px 26px var(--border); }
    .p-home-root.p-home-theme-light .p-home-sport-bg::after { background:linear-gradient(0deg,var(--overlay-strong),transparent 62%); }
    .p-home-root.p-home-theme-light .p-home-sport-count { color:var(--ink-50); }
    .p-home-root.p-home-theme-light .p-home-sport-name { color:var(--surface-1); }
    .p-home-root.p-home-theme-light .p-home-sec-sub,
    .p-home-root.p-home-theme-light .p-home-value-body p,
    .p-home-root.p-home-theme-light .p-home-faq-a { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-eyebrow,
    .p-home-root.p-home-theme-light .p-home-owner-side-h { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-eyebrow::before { background:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-values-band,
    .p-home-root.p-home-theme-light .p-home-owner,
    .p-home-root.p-home-theme-light .p-home-faq-band,
    .p-home-root.p-home-theme-light .p-home-value { border-top-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-value-num,
    .p-home-root.p-home-theme-light .p-home-owner-media-img { opacity:.96; }
    .p-home-root.p-home-theme-light .p-home-owner::after { background:linear-gradient(112deg,rgba(245,244,240,.78) 0%,rgba(245,244,240,.4) 42%,rgba(245,244,240,.08) 100%),linear-gradient(180deg,rgba(245,244,240,.18) 0%,rgba(245,244,240,.48) 100%); }
    .p-home-root.p-home-theme-light .p-home-owner .p-home-sec-sub { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-owner-side { background:var(--surface-1); border-color:var(--border); box-shadow:var(--shadow-lg); }
    .p-home-root.p-home-theme-light .p-home-owner-perk { border-top-color:var(--border-subtle); color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-owner-perk b { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-faq-list::before { background:linear-gradient(180deg,var(--accent-border-strong) 0%,var(--border) 100%); }
    .p-home-root.p-home-theme-light .p-home-faq-item { border-top-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-faq-item:last-child { border-bottom-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-faq-q { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-faq-icon { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-dropdown { background:var(--surface-1); border-color:var(--border); box-shadow:var(--shadow-md); }
    .p-home-root.p-home-theme-light .p-home-dropdown button { color:var(--text-primary)!important; }
    .p-home-root.p-home-theme-light .p-home-dropdown button:hover { background:var(--surface-2)!important; }
    .p-home-root.p-home-theme-light .p-home-marquee-wrap { background:var(--surface-2); border-bottom-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-marquee-item { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-marquee-item:hover { color:var(--text-primary); border-color:var(--border-strong); }
    /* Aurora orbs — reduce intensity on light background */
    .p-home-root.p-home-theme-light .p-home-aurora-1 { --p-home-aurora-color:rgba(182,243,106,.48); opacity:.78; }
    .p-home-root.p-home-theme-light .p-home-aurora-2 { --p-home-aurora-color:rgba(47,175,106,.22); opacity:.72; }
    .p-home-root.p-home-theme-light .p-home-aurora-3 { --p-home-aurora-color:rgba(255,209,102,.24); opacity:.7; }
    /* Value/step section numbers — stronger contrast in light mode */
    .p-home-root.p-home-theme-light .p-home-value-num,
    /* ── Portada solo para jugadores (sin tarjetas al costado) ── */
    /* Dos columnas: buscador a la izquierda; tus clubes o "Cómo funciona" a la derecha */
    .p-home-hero-inner.p-home-hero-has-side { grid-template-columns:minmax(0,1.25fr) minmax(320px,420px); align-items:end; }
    .p-home-hero-has-side .p-home-hero-copy { grid-column:1; grid-row:1; }
    .p-home-hero-aside { grid-column:2; grid-row:1; min-width:0; }
    .p-home-hero-aside:empty { display:none; }
    .p-home-steps { padding:24px; border-radius:20px; background:var(--surface-1); border:1px solid var(--border); box-shadow:var(--shadow-md); }
    .p-home-steps-h { margin:0 0 16px; font-size:11px; font-weight:800; letter-spacing:.04em; color:var(--text-muted); }
    .p-home-steps ol { list-style:none; margin:0; padding:0; display:grid; gap:16px; }
    .p-home-steps li { display:flex; gap:12px; align-items:flex-start; }
    .p-home-steps-num { width:28px; height:28px; flex-shrink:0; border-radius:999px; display:flex; align-items:center; justify-content:center; background:var(--accent-bg-muted); color:var(--accent-fg); font-size:13px; font-weight:900; }
    .p-home-steps b { display:block; font-size:14px; font-weight:800; color:var(--text-primary); }
    .p-home-steps-copy { display:block; margin-top:2px; font-size:12px; line-height:1.45; color:var(--text-secondary); }
    /* Con tus clubes al costado: título más chico y portada sin alto mínimo */
    .p-home-hero-compact { min-height:auto; }
    .p-home-hero-compact .p-home-hero-h1 { font-size:clamp(40px,5.5vw,72px); }
    .p-home-hero-compact .p-home-hero-h1 br:first-of-type { display:none; }
    @media(max-width:1024px){
      .p-home-hero-inner.p-home-hero-has-side { grid-template-columns:1fr; gap:28px; }
      .p-home-hero-has-side .p-home-hero-copy, .p-home-hero-aside { grid-column:1; grid-row:auto; }
      /* Tus clubes primero; "Cómo funciona" no hace falta en pantallas chicas */
      .p-home-hero-aside { order:-1; }
      .p-home-steps { display:none; }
    }
    .p-home-sport-card:focus-visible, .p-home-marquee-item:focus-visible { outline:2px solid var(--accent-fg); outline-offset:3px; }
    .p-home-marquee-item { text-decoration:none; }
    .p-home-value-body h3 { margin:0 0 8px; font-size:20px; font-weight:800; color:var(--text-primary); }
    .p-home-faq-q { width:100%; padding:0; border:0; background:none; font-family:inherit; text-align:left; cursor:pointer; }
    /* Pantallas táctiles: los campos van a 16px (evita el zoom de iPhone, ver pique.css);
       el resto del buscador acompaña para que todo tenga el mismo tamaño y grosor. */
    @media (hover:none) and (pointer:coarse) {
      .p-home-search-seg, .p-home-search-cta { font-size:16px; }
      .p-home-search-input { font-weight:600 !important; }
    }
    /* Desplegables del buscador: un solo diseño (opción, cantidad y ✓ en la elegida) */
    .p-home-dd-list { list-style:none; margin:0; padding:6px; max-height:300px; overflow-y:auto; scrollbar-width:thin; }
    .p-home-dd-option { display:flex; align-items:center; gap:10px; width:100%; min-height:44px; padding:8px 10px; border:0; border-radius:10px; background:transparent; color:var(--text-secondary); font-family:inherit; font-size:14px; font-weight:600; text-align:left; cursor:pointer; white-space:nowrap; }
    .p-home-dd-option:hover { background:var(--surface-2); color:var(--text-primary); }
    .p-home-dd-option[aria-selected="true"] { color:var(--positive-fg); }
    .p-home-dd-icon { display:flex; flex-shrink:0; color:var(--text-muted); }
    .p-home-dd-option[aria-selected="true"] .p-home-dd-icon { color:var(--positive-fg); }
    .p-home-dd-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .p-home-dd-count { flex-shrink:0; font-size:12px; font-weight:700; color:var(--text-muted); }
    .p-home-dd-check { width:16px; height:16px; flex-shrink:0; visibility:hidden; color:var(--positive-fg); }
    .p-home-dd-option[aria-selected="true"] .p-home-dd-check { visibility:visible; }
    .p-home-dd-empty { margin:0; padding:16px; text-align:center; font-size:13px; color:var(--text-muted); }
    /* Fecha: el desplegable se ubica respecto del buscador (no del botón) */
    .p-home-search-date-wrap { display:flex; }
    .p-home-search-date { border:0; background:transparent; font-family:inherit; }
    .p-home-date-dropdown { left:auto; right:0; }
    .p-home-days { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; padding:10px; width:min(360px, calc(100vw - 40px)); box-sizing:border-box; }
    .p-home-day { min-height:52px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; border:1px solid var(--border-subtle); border-radius:10px; background:var(--surface-2); color:var(--text-secondary); font-family:inherit; cursor:pointer; transition:background .15s,border-color .15s,color .15s; }
    .p-home-day:hover { border-color:var(--border); color:var(--text-primary); }
    .p-home-day b { font-size:13px; font-weight:800; white-space:nowrap; }
    .p-home-day small { font-size:10px; font-weight:700; opacity:.8; white-space:nowrap; }
    .p-home-day[aria-pressed="true"] { background:var(--accent-bg-muted); border-color:var(--accent-border-strong); color:var(--accent-fg); }
    /* ── Mobile: todo en ~3 pantallas ── */
    @media(max-width:720px){
      .p-home-hero { padding:92px 20px 32px; }
      .p-home-hero-eyebrow { margin-bottom:16px; }
      .p-home-hero-h1 { font-size:44px; margin-bottom:14px; }
      .p-home-hero-compact .p-home-hero-h1 { font-size:36px; }
      .p-home-hero-sub { font-size:15px; margin-bottom:20px; }
      .p-home-sports { padding:32px 20px; }
      .p-home-sports-head { margin-bottom:16px; }
      .p-home-sports-h3 { font-size:24px; }
      .p-home-sports-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      .p-home-sport-card { height:150px; padding:14px; border-radius:16px; }
      .p-home-sport-name { font-size:17px; }
      .p-home-sport-count { display:none; }
      .p-home-sec-w { padding:36px 20px; }
      .p-home-sec-h { font-size:30px; margin-bottom:10px; }
      .p-home-sec-h br { display:none; }
      .p-home-sec-sub { font-size:14px; margin-bottom:18px; }
      .p-home-eyebrow { margin-bottom:10px; }
      .p-home-values-grid { gap:12px; }
      .p-home-values-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      .p-home-value, .p-home-value:first-child { display:block; padding:14px; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface-1); }
      .p-home-value-num { display:none; }
      .p-home-value-body h3 { font-size:14px; margin-bottom:4px; }
      .p-home-value-body p { font-size:12px; line-height:1.45; }
      .p-home-owner-inner { padding:36px 20px; gap:0; }
      .p-home-owner-side { display:none; }
      .p-home-owner::after { background:var(--overlay-strong); }
      .p-home-root.p-home-theme-light .p-home-owner::after { background:rgba(245,244,240,.84); }
      .p-home-owner-ctas { margin-top:4px; }
      .p-home-faq-grid { gap:8px; }
      .p-home-faq-list { padding-left:0; }
      .p-home-faq-list::before { display:none; }
      .p-home-faq-item { padding:16px 0; }
      .p-home-faq-q { font-size:15px; }
      .p-home-faq-cta { display:none; }
      /* Ciudades: en el celular sobran (el campo ya sugiere lugares al tocarlo) */
      .p-home-search-quicks { display:none; }
      .p-home-search-date-wrap { order:2; margin-left:auto; }
      .p-home-search .p-home-date-dropdown { left:0; right:0; width:auto; }
      .p-home-search .p-home-days { width:auto; }
      /* Clubes: una fila con título, se desliza con el dedo (sin la copia del carrusel) */
      .p-home-marquee-wrap { padding:14px 0; }
      .p-home-marquee-label { display:block; }
      .p-home-marquee-track, .p-home-marquee-track.p-home-marquee-static { width:auto; min-width:0; justify-content:flex-start; flex-wrap:nowrap; overflow-x:auto; padding:0 20px; gap:8px; animation:none; scrollbar-width:none; }
      .p-home-marquee-track::-webkit-scrollbar { display:none; }
      .p-home-marquee-item[aria-hidden="true"] { display:none; }
    }
  `;

  return (
    <>
      <Head>
        <title>Pique | Reservá canchas en Argentina</title>
      </Head>
      <style dangerouslySetInnerHTML={{ __html: homeCss }} />
      <div className={`p-home-root${isLight ? ' p-home-theme-light' : ''}${clubApp ? ' p-home-clubapp' : ''}`} onClick={() => {
        setShowCityDropdown(false);
        setShowSportDropdown(false);
        setShowDateDropdown(false);
        }}>
      <NavBar onContactClick={() => setContactMode('general')} onNavbarInteract={closeContact} showContactLink showHomeShortcuts />

      {/* Hero: solo para jugadores */}
      <section className={`p-home-hero${heroCompact ? ' p-home-hero-compact' : ''}`}>
        <div className="p-home-hero-visuals" aria-hidden="true">
          <div className="p-home-hero-bg" />
          <div className="p-home-hero-noise" />
          <div className="p-home-aurora-orb p-home-aurora-1" />
          <div className="p-home-aurora-orb p-home-aurora-2" />
          <div className="p-home-aurora-orb p-home-aurora-3" />
        </div>
        <div className="p-home-hero-inner p-home-hero-has-side">
          {/* Columna derecha: tus clubes (con sesión) o cómo funciona (sin sesión). En mobile, tus clubes van primero. */}
          <aside className="p-home-hero-aside">
            {authUser?.id ? <MyClubsSection userId={Number(authUser.id)} placement="hero" onCountChange={setMyClubsCount} /> : null}
            {showHowItWorks && (
              <div className="p-home-steps">
                <p className="p-home-steps-h">Cómo funciona</p>
                <ol>
                  {[
                    { title: 'Elegí cancha y horario', copy: 'Ves qué está libre en cada club, al momento.' },
                    { title: 'Confirmá en un toque', copy: 'Sabés el precio antes de reservar.' },
                    { title: 'Jugá y avisale a tu grupo', copy: 'Invitalos desde la app o por WhatsApp.' },
                  ].map((step, index) => (
                    <li key={step.title}>
                      <span className="p-home-steps-num" aria-hidden="true">{index + 1}</span>
                      <span><b>{step.title}</b><span className="p-home-steps-copy">{step.copy}</span></span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </aside>
          <div className="p-home-hero-copy">
            {!loadingClubs && clubs.length > 0 && (
              <span className="p-home-hero-eyebrow">
                <span className="p-home-hero-eyebrow-dot" />
                <span>{clubs.length} {clubs.length === 1 ? 'club para reservar' : 'clubes para reservar'}</span>
              </span>
            )}
            <h1 className="p-home-hero-h1">
              Reservá{' '}<br />
              <HeroSportWord />
              {' '}<br />al toque.
            </h1>
            <p className="p-home-hero-sub">Buscá cancha, elegí horario y reservá en minutos.</p>

            {/* Search bar */}
            <div ref={searchBarRef} className="p-home-search" onClick={e => e.stopPropagation()}>
              {/* Sport selector */}
              <div className="p-home-search-seg p-home-search-sport" style={{ position: 'relative' }} onClick={(e) => { e.stopPropagation(); setShowCityDropdown(false); setShowDateDropdown(false); setShowSportDropdown(p => !p); }}>
                <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{selectedSport.icon}</span>
                <span>{selectedSport.label}</span>
                <ChevronDown className={`p-home-search-caret${showSportDropdown ? ' p-home-search-caret-open' : ''}`} />
                {showSportDropdown && (
                  <div className="p-home-dropdown" onClick={e => e.stopPropagation()}>
                    <ul className="p-home-dd-list" role="listbox" aria-label="Deporte">
                      {sportMenuOptions.map(sport => (
                        <li key={sport.value || 'all'}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={searchSport === sport.value}
                            className="p-home-dd-option"
                            onClick={() => { setSearchSport(sport.value); setShowSportDropdown(false); }}
                          >
                            <span className="p-home-dd-icon">{sport.icon}</span>
                            <span className="p-home-dd-label">{sport.label}</span>
                            <span className="p-home-dd-count">{sport.count}</span>
                            <Check className="p-home-dd-check" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="p-home-search-divider" />
              {/* Location */}
              <div className="p-home-search-loc">
                <input
                  id="cityInput"
                  type="text"
                  placeholder="¿Dónde jugás?"
                  aria-label="Ciudad o zona"
                  className="p-home-search-input"
                  value={searchCity}
                  onChange={(e) => { const v = e.target.value; setSearchCity(v); if (!v.trim()) setSelectedLocation(null); setShowCityDropdown(true); }}
                  onFocus={(e) => { e.target.select(); setShowSportDropdown(false); setShowDateDropdown(false); setShowCityDropdown(true); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setShowCityDropdown(false); handleSearch(); } }}
                  autoComplete="off"
                />
                {showCityDropdown && (
                  <div className="p-home-dropdown" style={{ minWidth: 260 }} onClick={e => e.stopPropagation()}>
                    {loadingClubs ? (
                      <div className="p-home-dd-empty"><UserLoadingState mode="inline" message="Cargando lugares..." /></div>
                    ) : cityMenuOptions.length > 0 ? (
                      <ul className="p-home-dd-list" role="listbox" aria-label="Ciudad">
                        {cityMenuOptions.map(({ location, count }) => (
                          <li key={location.city || location.label}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={selectedLocation?.city === location.city}
                              className="p-home-dd-option"
                              onClick={() => selectCity(location)}
                              title={location.label}
                            >
                              <span className="p-home-dd-icon"><MapPin size={15} /></span>
                              <span className="p-home-dd-label">{cityChipLabel(location.city || location.label)}</span>
                              <span className="p-home-dd-count">{count} {count === 1 ? 'club' : 'clubes'}</span>
                              <Check className="p-home-dd-check" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="p-home-dd-empty">Todavía no hay clubes en esa zona.</p>
                    )}
                  </div>
                )}
              </div>
              <div className="p-home-search-divider" />
              {/* Date: los mismos días que muestra la grilla del club, con un toque */}
              <div className="p-home-search-date-wrap">
                <button
                  type="button"
                  className="p-home-search-seg p-home-search-date"
                  aria-expanded={showDateDropdown}
                  aria-label={`Fecha: ${selectedDayLabel}`}
                  onClick={(e) => { e.stopPropagation(); setShowCityDropdown(false); setShowSportDropdown(false); setShowDateDropdown(p => !p); }}
                >
                  <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
                  <span>{selectedDayLabel}</span>
                </button>
                {showDateDropdown && (
                  <div className="p-home-dropdown p-home-date-dropdown" onClick={e => e.stopPropagation()}>
                    <div className="p-home-days" role="group" aria-label="Día">
                      {searchDays.map(day => (
                        <button
                          key={day.key}
                          type="button"
                          className="p-home-day"
                          aria-pressed={searchDate === day.key}
                          onClick={() => { setSearchDate(day.key); setShowDateDropdown(false); }}
                        >
                          <b>{day.label}</b>
                          <small>{day.sub}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* CTA */}
              <button className="p-home-search-cta" onClick={handleSearch} disabled={isSearching}>
                <BusyLabel busy={isSearching} spinnerSize={13}>Buscar<Search size={13} /></BusyLabel>
              </button>
            </div>

            {locationOptions.length > 0 && (
              <div className="p-home-search-quicks">
                {locationOptions.slice(0, 3).map((loc, i) => (
                  <button key={i} type="button" className="p-home-quick-chip" onClick={() => selectCity(loc)} title={loc.label}>{cityChipLabel(loc.city || loc.label)}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── MARQUEE STRIP: cada club lleva a su página ── */}
      {!loadingClubs && clubs.length > 0 && (
        <div className="p-home-marquee-wrap">
          <p className="p-home-marquee-label">Clubes en Pique</p>
          <div className={`p-home-marquee-track${shouldAnimateMarquee ? '' : ' p-home-marquee-static'}`}>
            {marqueeClubs.map((club, i) => (
              <Link
                key={`${club.id}-${i}`}
                href={`/club/${club.slug}`}
                className="p-home-marquee-item"
                aria-hidden={i >= clubs.length ? true : undefined}
                tabIndex={i >= clubs.length ? -1 : undefined}
              >
                <span className="p-home-marquee-dot" />
                {club.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── SPORTS GRID ── */}
      <section id="deportes" className="p-home-sports" style={{ scrollMarginTop: 88 }}>
        <div className="p-home-sports-head">
          <h2 className="p-home-sports-h3 p-home-sr">Encontrá tu deporte y <i>reservá sin vueltas.</i></h2>
        </div>
        <div className="p-home-sports-grid">
          {SPORT_CARDS.map((s, si) => (
            <Link
              key={s.name}
              href={{ pathname: '/complejos', query: s.sport ? { sport: s.sport } : {} }}
              className={`p-home-sport-card p-home-sr p-home-sr-d${si + 1}`}
              style={{ '--card-accent': s.accent } as React.CSSProperties}
            >
              <div
                className="p-home-sport-bg"
                style={{
                  backgroundImage: `linear-gradient(160deg, var(--overlay) 0%, var(--overlay) 58%, var(--overlay-strong) 100%), url('${s.photo}')`,
                  backgroundPosition: s.bgPosition,
                }}
              />
              <div className="p-home-sport-content">
                {!loadingClubs && sportClubCounts[s.countKey] > 0 && (
                  <div className="p-home-sport-club-count">{sportClubCounts[s.countKey]} {sportClubCounts[s.countKey] === 1 ? 'club' : 'clubes'}</div>
                )}
                <div className="p-home-sport-count">{s.sub}</div>
                <div className="p-home-sport-name">{s.name} →</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── VALUES (POR QUE PIQUE) ── */}
      <section id="por-que-pique" className="p-home-values-band" style={{ scrollMarginTop: 88 }}>
        <div className="p-home-sec-w">
          <div className="p-home-values-grid">
            <div className="p-home-values-h p-home-sr-left">
              <span className="p-home-eyebrow">Por qué Pique</span>
              <h2 className="p-home-sec-h">La forma más{' '}<br /><b>fluida</b> de <i>jugar.</i></h2>
              <p className="p-home-sec-sub">Elegís cancha, horario y confirmás en el momento.</p>
            </div>
            <div className="p-home-values-list">
              {VALUES.map((v, vi) => (
                <div key={v.num} className={`p-home-value p-home-sr p-home-sr-d${vi + 1}`}>
                  <div className="p-home-value-num">{v.num}</div>
                  <div className="p-home-value-body"><h3>{v.title}</h3><p>{v.desc}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── OWNER (PARA COMPLEJOS): el único bloque para dueños ── */}
      <section id="para-complejos" ref={ownerSectionRef} className="p-home-owner" style={{ scrollMarginTop: 88 }}>
        <div className="p-home-owner-media" aria-hidden="true">
          <div className="p-home-owner-media-img" />
        </div>
        <div className="p-home-owner-inner">
          <div className="p-home-sr-left">
            <span className="p-home-eyebrow">Para complejos</span>
            <h2 className="p-home-sec-h">Llená tu agenda con{' '}<br /><i>reservas online.</i></h2>
            <p className="p-home-sec-sub">Sumate a Pique y centralizá agenda, cobros y comunicación con jugadores en un solo lugar.</p>
            <div className="p-home-owner-ctas">
              <button type="button" className="p-home-btn p-home-btn-primary" onClick={() => setContactMode('owner')}>Quiero sumar mi complejo →</button>
            </div>
          </div>
          <div className="p-home-owner-side p-home-sr-right">
            <div className="p-home-owner-side-h">Qué resolvemos</div>
            <div>
              {[
                { b: 'Agenda', t: 'Horarios y canchas actualizados, sin cruces ni planillas.' },
                { b: 'Cobros', t: 'Pagos más claros y mejor seguimiento de cada reserva.' },
                { b: 'Clientes', t: 'Confirmaciones automáticas y menos idas y vueltas por WhatsApp.' },
              ].map(p => (
                <div key={p.b} className="p-home-owner-perk"><b>{p.b}</b>{p.t}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="p-home-faq-band" onClick={() => setOpenFaqIndex(null)} style={{ scrollMarginTop: 88 }}>
        <div className="p-home-sec-w">
          <div className="p-home-faq-grid">
            <div className="p-home-sr-up">
              <span className="p-home-eyebrow">FAQ</span>
              <h2 className="p-home-sec-h">Preguntas{' '}<br /><i>frecuentes.</i></h2>
              <p className="p-home-sec-sub">Lo básico antes de reservar.</p>
              <button type="button" className="p-home-btn p-home-btn-ghost p-home-faq-cta" onClick={(e) => { e.stopPropagation(); setContactMode('general'); }} style={{ marginTop: 4 }}>Escribinos →</button>
            </div>
            <div className="p-home-faq-list">
              {FAQ.map((item, idx) => (
                <div
                  key={idx}
                  ref={el => { faqRefs.current[idx] = el; }}
                  className={`p-home-faq-item${openFaqIndex === idx ? ' p-home-open' : ''}`}
                  onClick={e => { e.stopPropagation(); setOpenFaqIndex(openFaqIndex === idx ? null : idx); }}
                >
                  <button type="button" className="p-home-faq-q" aria-expanded={openFaqIndex === idx}>
                    {item.q}
                    <svg className="p-home-faq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                  <div className="p-home-faq-a">{item.a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER (el mismo de todas las páginas) ── */}
      {clubApp ? null : <PublicFooter onContactClick={() => setContactMode('general')} />}

      <ContactPanel open={contactMode !== null} mode={contactMode || 'general'} onClose={closeContact} />

      {clubApp ? <ClubAppTabBar slug={clubApp.slug} /> : null}
      </div>{/* end p-home-root */}
    </>
  );
}
