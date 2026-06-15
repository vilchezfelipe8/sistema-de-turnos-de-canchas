import { useEffect, useState, useRef, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
import { getApiUrl } from '../utils/apiUrl';
import { LocationService, Location } from '../services/LocationService';
import DatePickerDark from '../components/ui/DatePickerDark';
import { Search, MapPin, Calendar, TrendingUp, ArrowRight, X, Phone, Mail, Instagram, Activity, ChevronRight, ChevronLeft, MousePointerClick, CalendarCheck, PlayCircle, Coffee, Droplets, Lightbulb, Trophy, ChevronDown, Check, MessageSquare, Calculator, Heart } from 'lucide-react';
import Link from 'next/link';
import { normalizeSessionUser } from '../utils/session';
import { reportUiError } from '../utils/uiError';
import { useAuth } from '../contexts/AuthContext';
import { useUserTheme } from '../contexts/UserThemeContext';
import { isAuthSessionInvalidatedError } from '../utils/apiClient';
import PiqueLogo from '../components/PiqueLogo';
import NavBar from '../components/NavBar';
// Importamos los iconos de la libreria
import { FaTableTennis } from "react-icons/fa"; // Paleta (Perfecta para Padel)
import { IoFootballOutline } from "react-icons/io5"; // Pelota de futbol limpia
import { IoTennisballOutline } from "react-icons/io5"; // Pelota de tenis limpia

const APP_NOTICE_EVENT = 'app:notice';
type AppNoticeTone = 'success' | 'error' | 'info' | 'warning';

const countActiveBookings = (rows: any[]): number => {
  const now = Date.now();
  return rows.filter((booking: any) => {
    const status = String(booking?.status || '').toUpperCase();
    if (status === 'CANCELLED' || status === 'COMPLETED') return false;
    const endValue = booking?.endDateTime || booking?.startDateTime;
    const endTs = new Date(endValue).getTime();
    if (!Number.isFinite(endTs)) return true;
    return endTs >= now;
  }).length;
};

// ReactDOM portal removed: menu will be rendered inside the sidebar to keep positioning stable under zoom

// --- COMPONENTE DE ANIMACION AL SCROLLEAR ---
const RevealOnScroll = ({ children, delay = 0, className = "" }: { children: React.ReactNode, delay?: number, className?: string }) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 } // Se activa cuando el 10% del elemento es visible
    );
    const currentRef = ref.current;
    if (currentRef) observer.observe(currentRef);
    return () => { if (currentRef) observer.unobserve(currentRef); };
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-1000 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

// --- HELPERS DE UBICACION ---
type LocationSuggestion = {
  label: string;
  query: string;
  city: string;
  province: string;
  country: string;
};

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const LOCATION_LIMIT = 6;
const DEFAULT_RADIUS_KM = 20;

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const sportAliases: Record<string, string[]> = {
  padel: ['padel'],
  tenis: ['tenis', 'tennis'],
  futbol: ['futbol', 'football']
};

const matchesSport = (activityName: string, sport: string) => {
  const normalizedActivity = normalizeText(activityName);
  const aliases = sportAliases[sport] || [sport];
  return aliases.some((alias) => normalizedActivity.includes(normalizeText(alias)));
};

const fetchLocations = async (
  query: string,
  limit = LOCATION_LIMIT,
  signal?: AbortSignal
): Promise<{ lat: number; lon: number }[]> => {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: `${limit}`,
    addressdetails: '1',
    q: query
  });
  const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, { signal });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data)
    ? data.map((item: any) => ({ lat: Number(item.lat), lon: Number(item.lon) }))
    : [];
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const calculateDistanceKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusKm * c;
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatClubAddress = (club: Club) => {
  return [club.addressLine, club.city, club.province, club.country].filter(Boolean).join(', ');
};

export default function Home() {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const { isLight } = useUserTheme();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showContact, setShowContact] = useState(false);
  const [favoriteClubIds, setFavoriteClubIds] = useState<Set<number>>(new Set());
  const [favoriteClubs, setFavoriteClubs] = useState<Club[]>([]);
  const [favoriteBusyByClub, setFavoriteBusyByClub] = useState<Record<number, boolean>>({});
  // track which FAQ item is currently open (null if none)
  const sportClubCounts = useMemo(() => {
    if (!clubs.length) return { futbol: 0, padel: 0, tenis: 0, otros: 0 };
    const counts = { futbol: 0, padel: 0, tenis: 0, otros: 0 };
    for (const club of clubs) {
      const keys = club.fixedBookingSettingsByActivity ? Object.keys(club.fixedBookingSettingsByActivity) : [];
      if (keys.some(k => matchesSport(k, 'futbol'))) counts.futbol++;
      if (keys.some(k => matchesSport(k, 'padel'))) counts.padel++;
      if (keys.some(k => matchesSport(k, 'tenis'))) counts.tenis++;
      if (!keys.length || keys.every(k => !matchesSport(k, 'futbol') && !matchesSport(k, 'padel') && !matchesSport(k, 'tenis'))) counts.otros++;
    }
    return counts;
  }, [clubs]);

  const sportWords = ['fútbol', 'pádel', 'tenis', 'básquet'];
  const [heroSportIdx, setHeroSportIdx] = useState(0);
  const [heroWordVisible, setHeroWordVisible] = useState(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const faqRefs = useRef<Array<HTMLDivElement | null>>([]);
  const shouldAnimateMarquee = clubs.length >= 6;
  const marqueeClubs = shouldAnimateMarquee ? [...clubs, ...clubs] : clubs;

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
    const timer = setInterval(() => {
      setHeroWordVisible(false);
      setTimeout(() => {
        setHeroSportIdx(i => (i + 1) % sportWords.length);
        setHeroWordVisible(true);
      }, 380);
    }, 2700);
    return () => clearInterval(timer);
  }, [sportWords.length]);

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
    const closeTransientPanels = () => {
      setShowContact(false);
      setContactMenu(null);
      };
    router.events.on('routeChangeStart', closeTransientPanels);
    return () => {
      router.events.off('routeChangeStart', closeTransientPanels);
    };
  }, [router.events]);

  const toggleContactDrawer = () => {
    setContactMenu(null);
    setShowContact((prev) => !prev);
  };

  useEffect(() => {
    const closingSection = closingSectionRef.current;
    const ownerSection = ownerSectionRef.current;
    if (!closingSection && !ownerSection) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let rafId: number | null = null;

    const applyParallax = (section: HTMLElement, cssVarName: string, amplitude: number) => {
      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight || 1;
      const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height);
      const clamped = Math.max(0, Math.min(1, progress));
      const shift = (clamped - 0.5) * amplitude;
      section.style.setProperty(cssVarName, `${shift.toFixed(2)}px`);
    };

    const updateParallax = () => {
      if (reducedMotion.matches) {
        if (closingSection) closingSection.style.setProperty('--p-home-closing-parallax', '0px');
        if (ownerSection) ownerSection.style.setProperty('--p-home-owner-parallax', '0px');
        return;
      }
      if (closingSection) applyParallax(closingSection, '--p-home-closing-parallax', 28); // -14..14
      if (ownerSection) applyParallax(ownerSection, '--p-home-owner-parallax', 24); // -12..12
    };

    const scheduleParallax = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateParallax();
      });
    };

    scheduleParallax();
    window.addEventListener('scroll', scheduleParallax, { passive: true });
    window.addEventListener('resize', scheduleParallax);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleParallax);
      window.removeEventListener('resize', scheduleParallax);
    };
  }, []);

  const resultsRef = useRef<HTMLElement>(null);
  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const ownerSectionRef = useRef<HTMLElement | null>(null);
  const closingSectionRef = useRef<HTMLElement | null>(null);
  const apiBase = useMemo(() => `${getApiUrl()}/api`, []);

  // Estados del Buscador
  const [searchCity, setSearchCity] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false); 
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [displayedClubs, setDisplayedClubs] = useState<Club[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [clubCoords, setClubCoords] = useState<Record<number, { lat: number; lon: number } | null>>({});

  const [searchSport, setSearchSport] = useState('padel');
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  // Fecha seleccionada en formato YYYY-MM-DD. Por defecto, el dia de hoy.
  const getEffectiveToday = () => {
    // Aqui podemos aplicar offsets si fuera necesario (zona horaria / reglas de negocio).
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const [searchDate, setSearchDate] = useState(() => formatLocalDate(getEffectiveToday()));
  const [lastSearchLabel, setLastSearchLabel] = useState<string>('');
  const [availableTimesByClub, setAvailableTimesByClub] = useState<Record<number, string[]>>({});
  const searchRequestIdRef = useRef(0);

  // Menu de acciones para contactos (abrir / copiar)
  const [contactMenu, setContactMenu] = useState<{
    type: 'whatsapp' | 'email' | 'instagram';
    top: number;
    left: number;
    href: string;
    copyText: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setContactMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContactMenu(null);
    };
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const openContactMenu = (e: React.MouseEvent, type: 'whatsapp' | 'email' | 'instagram') => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    // If the sidebar ref exists, position the menu relative to the sidebar container
    let top = rect.bottom + 8;
    let left = rect.left;
    if (sidebarRef.current) {
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      top = rect.bottom - sidebarRect.top + 8; // relative to sidebar
      left = rect.left - sidebarRect.left;
    }
    let href = '#';
    let copyText = '';
    if (type === 'whatsapp') {
      href = 'https://wa.me/5493513436163';
      copyText = '+5493513436163';
    } else if (type === 'email') {
      href = 'mailto:soporte.pique@gmail.com';
      copyText = 'soporte.pique@gmail.com';
    } else if (type === 'instagram') {
      href = 'https://www.instagram.com/pique.app_/';
      copyText = '@pique.app_';
    }
    setContactMenu({ type, top: Math.max(top, 10), left: Math.max(left, 10), href, copyText });
  };

  const handleOpenHref = (href: string) => {
    window.open(href, '_blank');
    setContactMenu(null);
  };

  const handleCopy = async (text: string) => {
    setContactMenu(null);
    try {
      await navigator.clipboard.writeText(text);
      showAppNotice(`¡Copiado! ${text}`, 'success');
    } catch (err) {
      reportUiError({ area: 'HomePage', action: 'copyContactData' }, err);
    }
  };

  const handleNavbarInteract = () => {
    setShowContact(false);
    setContactMenu(null);
  };

  const sportOptions = useMemo(() => ([
  {
    value: 'padel',
    label: 'Padel',
    icon: (
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
    )
  },
  {
    value: 'futbol',
    label: 'Futbol',
    icon: <IoFootballOutline className="h-5 w-5" /> // Dejs la de la libreria que estaba buena
  },
  {
    value: 'tenis',
    label: 'Tenis',
    icon: <IoTennisballOutline className="h-5 w-5" /> // Dejs la de la libreria
  }
]), []);

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
    const loadLocations = async () => {
      try {
        const allLocations = await LocationService.getAllLocations();
        setLocations(allLocations);
      } catch (error) {
        reportUiError({ area: 'HomePage', action: 'loadLocations' }, error);
      } finally {
        setLoadingLocations(false);
      }
    };
    loadClubs();
    loadLocations();
  }, []);

  useEffect(() => {
    setUser(authUser ? normalizeSessionUser(authUser as any) : null);
    if (!authUser) {
      }
  }, [authUser]);

  useEffect(() => {
    const loadFavorites = async () => {
      if (!user?.id) {
        setFavoriteClubIds(new Set());
        setFavoriteClubs([]);
        return;
      }
      try {
        const favorites = await ClubService.getMyFavorites();
        const nextIds = new Set<number>(favorites.map((item) => Number(item.clubId)));
        const nextClubs = favorites
          .map((item) => item.club)
          .filter((club): club is Club => Boolean(club && club.id));
        setFavoriteClubIds(nextIds);
        setFavoriteClubs(nextClubs);
      } catch (error) {
        if (isAuthSessionInvalidatedError(error)) {
          return;
        }
        reportUiError({ area: 'HomePage', action: 'loadFavorites' }, error);
      }
    };
    void loadFavorites();
  }, [user?.id]);

  const showAppNotice = (message: string, tone: AppNoticeTone = 'info') => {
    if (typeof window === 'undefined') return;
    const safe = String(message || '').trim();
    if (!safe) return;
    window.dispatchEvent(new CustomEvent(APP_NOTICE_EVENT, { detail: { message: safe, tone } }));
  };


  const handleToggleFavorite = async (e: React.MouseEvent, club: Club) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user?.id) {
      showAppNotice('Iniciá sesión para guardar favoritos.', 'info');
      return;
    }

    const clubId = Number(club.id);
    if (!Number.isFinite(clubId) || clubId <= 0) return;
    if (favoriteBusyByClub[clubId]) return;

    setFavoriteBusyByClub((prev) => ({ ...prev, [clubId]: true }));
    try {
      if (favoriteClubIds.has(clubId)) {
        await ClubService.unmarkFavorite(clubId);
        setFavoriteClubIds((prev) => {
          const next = new Set(prev);
          next.delete(clubId);
          return next;
        });
        setFavoriteClubs((prev) => prev.filter((item) => Number(item.id) !== clubId));
        showAppNotice('Club eliminado de favoritos.', 'success');
      } else {
        await ClubService.markFavorite(clubId);
        setFavoriteClubIds((prev) => {
          const next = new Set(prev);
          next.add(clubId);
          return next;
        });
        setFavoriteClubs((prev) => {
          const exists = prev.some((item) => Number(item.id) === clubId);
          return exists ? prev : [club, ...prev];
        });
        showAppNotice('Club agregado a favoritos.', 'success');
      }
    } catch (error) {
      reportUiError({ area: 'HomePage', action: 'toggleFavorite' }, error);
      showAppNotice('No pudimos actualizar tus favoritos. Intentá nuevamente.', 'error');
    } finally {
      setFavoriteBusyByClub((prev) => ({ ...prev, [clubId]: false }));
    }
  };

  useEffect(() => {
    setDisplayedClubs(clubs);
  }, [clubs]);

  const locationOptions = useMemo(() => {
    const map = new Map<string, LocationSuggestion>();
    locations.forEach((location) => {
      const city = location.city?.trim();
      const province = location.province?.trim();
      const country = location.country?.trim();
      if (!city || !province || !country) return;
      const label = `${city}, ${province}`;
      const query = [city, province, country].filter(Boolean).join(', ');
      const key = normalizeText(query);
      if (!map.has(key)) {
        map.set(key, { label, query, city, province, country });
      }
    });
    return Array.from(map.values());
  }, [locations]);

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

  const resolveClubCoords = async (club: Club) => {
    if (club.id in clubCoords) return clubCoords[club.id];

    const queries = [
      [club.addressLine, club.city, club.province, club.country, club.name],
      [club.city, club.province, club.country],
      [club.city, club.country]
    ]
      .map(parts => parts.filter(Boolean).join(', '))
      .filter(Boolean);

    for (const query of queries) {
      const results = await fetchLocations(query, 1);
      if (results[0]) {
        const coords = { lat: results[0].lat, lon: results[0].lon };
        setClubCoords(prev => ({ ...prev, [club.id]: coords }));
        return coords;
      }
    }

    setClubCoords(prev => ({ ...prev, [club.id]: null }));
    return null;
  };

  const parseSearchDate = (s: string) => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const changeDateBy = (days: number) => {
    const current = parseSearchDate(searchDate) || getEffectiveToday();
    const next = new Date(current);
    next.setDate(current.getDate() + days);
    const min = getEffectiveToday();
    if (next < min) return; // no retroceder mas que el minimo
    setSearchDate(formatLocalDate(next));
  };

  const canGoPrev = () => {
    const current = parseSearchDate(searchDate) || getEffectiveToday();
    const prev = new Date(current);
    prev.setDate(current.getDate() - 1);
    const min = getEffectiveToday();
    return prev >= min;
  };

  const scrollToSearchBarTop = () => {
    if (!searchBarRef.current) return;
    const top = window.scrollY + searchBarRef.current.getBoundingClientRect().top;
    const navbarOffset = 18;
    window.scrollTo({ top: Math.max(top - navbarOffset, 0), behavior: 'smooth' });
  };

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
    router.push({ pathname: '/complejos', query });
  };

  // Cierra el DatePicker abierto (si existe) forzando blur sobre su input
  const closeDatepicker = () => {
    try {
      const el = document.querySelector('input[placeholder="Selecciona fecha"]') as HTMLInputElement | null;
      if (el) el.blur();
      // En algunos casos el popper queda montado en el body; lo removemos/ocultamos para asegurarnos
      try {
        document.querySelectorAll('.react-datepicker-popper, .react-datepicker').forEach((n) => {
          const eln = n as HTMLElement;
          if (eln && eln.parentNode) eln.parentNode.removeChild(eln);
        });
      } catch (err) {
        // noop
      }
    } catch (e) {
      // noop
    }
  };

  const selectCity = (location: LocationSuggestion) => {
    setSearchCity(location.label);
    setSelectedLocation(location);
    setShowCityDropdown(false);
  };

  const homeCss = `
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
    .p-home-hero-bg::after { content:''; position:absolute; inset:-22%; will-change:transform; }
    .p-home-hero-bg::before {
      background:radial-gradient(ellipse 62% 50% at 20% 100%,var(--accent-bg-muted),transparent 70%),
                 radial-gradient(ellipse 42% 38% at 85% 15%,var(--accent-bg-faint),transparent 66%);
      animation:p-home-hero-drift-a 18s ease-in-out infinite alternate;
    }
    .p-home-hero-bg::after {
      background:radial-gradient(ellipse 44% 34% at 68% 72%,rgba(182,243,106,.13),transparent 68%),
                 radial-gradient(ellipse 36% 28% at 9% 20%,rgba(255,255,255,.08),transparent 64%);
      opacity:.7;
      animation:p-home-hero-drift-b 24s ease-in-out infinite alternate;
    }
    @keyframes p-home-hero-drift-a {
      from { transform:translate3d(-1.3%, -1%, 0) scale(1); }
      to { transform:translate3d(1.7%, 1.2%, 0) scale(1.04); }
    }
    @keyframes p-home-hero-drift-b {
      from { transform:translate3d(1.1%, -.8%, 0) scale(1.02); }
      to { transform:translate3d(-1.5%, 1.3%, 0) scale(1.06); }
    }
    .p-home-hero-noise { position:absolute; inset:0; opacity:.022; pointer-events:none; background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
    .p-home-hero-inner { position:relative; z-index:2; max-width:1360px; margin:0 auto; width:100%; display:grid; grid-template-columns:1.2fr auto; align-items:end; gap:48px; }
    .p-home-hero-copy { max-width:720px; }
    .p-home-hero-eyebrow { display:inline-flex; align-items:center; gap:10px; padding:6px 14px 6px 10px; background:var(--border-subtle); border:1px solid var(--border); border-radius:999px; font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:28px; backdrop-filter:blur(12px); }
    .p-home-hero-eyebrow-dot { width:6px; height:6px; border-radius:50%; background:var(--brand); box-shadow:0 0 0 3px var(--accent-border); animation:p-home-pulse 1.6s ease-in-out infinite; }
    @keyframes p-home-pulse { 0%,100%{opacity:1}50%{opacity:.5} }
    .p-home-hero-h1 { font-size:clamp(52px,8vw,108px); font-weight:800; letter-spacing:-.045em; line-height:.96; margin:0 0 24px; color:var(--ink-50); }
    .p-home-hero-h1 i { font-style:italic; font-weight:700; color:var(--accent-fg); }
    .p-home-hero-h1 .p-home-grad-text { color:unset; }
    .p-home-hero-sub { font-size:17px; font-weight:400; color:var(--text-secondary); line-height:1.55; max-width:500px; margin:0 0 36px; }
    /* Search */
    .p-home-search { position:relative; z-index:25; display:flex; gap:0; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:999px; padding:4px; backdrop-filter:blur(20px); max-width:620px; align-items:center; flex-wrap:wrap; }
    .p-home-search-seg { display:flex; align-items:center; gap:8px; padding:10px 16px; font-size:13px; font-weight:600; color:var(--text-secondary); cursor:pointer; position:relative; white-space:nowrap; border-radius:999px; transition:background .15s; }
    .p-home-search-seg:hover { background:var(--border-subtle); }
    .p-home-search-caret { width:12px; height:12px; color:var(--text-muted); flex-shrink:0; transform-origin:center; transition:transform .22s ease, color .18s ease; }
    .p-home-search-seg:hover .p-home-search-caret { color:var(--text-muted); }
    .p-home-search-caret.p-home-search-caret-open { transform:rotate(180deg); color:var(--accent-fg); }
    .p-home-search-divider { width:1px; height:28px; background:var(--border); flex-shrink:0; margin:0 2px; }
    .p-home-search-loc { flex:1; position:relative; min-width:0; }
    .p-home-search-input { flex:1; min-width:120px; padding:10px 14px; background:transparent; border:none; color:var(--text-secondary); font-family:var(--font-sans); font-size:13px; font-weight:500; outline:none; }
    .p-home-search-input::placeholder { color:var(--text-muted); }
    .p-home-search-cta { padding:12px 20px; background:var(--brand); color:var(--brand-on); border:none; border-radius:999px; font-size:13px; font-weight:700; display:inline-flex; align-items:center; gap:8px; transition:background .15s; cursor:pointer; font-family:inherit; white-space:nowrap; flex-shrink:0; }
    .p-home-search-cta:hover { background:var(--brand-hover); }
    .p-home-search-quicks { display:flex; gap:6px; margin-top:14px; flex-wrap:wrap; }
    .p-home-quick-chip { padding:5px 13px; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:999px; font-size:12px; font-weight:500; color:var(--text-secondary); transition:background .15s,color .15s; cursor:pointer; font-family:inherit; }
    .p-home-quick-chip:hover { background:var(--border-subtle); color:var(--ink-50); }
    .p-home-hero-side { display:flex; flex-direction:column; gap:12px; min-width:260px; }
    .p-home-live-card { padding:20px 22px; background:var(--border-subtle); border:1px solid var(--border-subtle); border-radius:20px; backdrop-filter:blur(20px); }
    .p-home-live-head { display:flex; align-items:center; gap:8px; font-size:10px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); margin-bottom:10px; }
    .p-home-live-dot { width:7px; height:7px; border-radius:50%; background:var(--brand); animation:p-home-pulse 1.2s ease-in-out infinite; }
    .p-home-live-stat { font-size:26px; font-weight:700; letter-spacing:-.03em; color:var(--ink-50); }
    .p-home-live-label { font-size:12px; color:var(--text-secondary); margin-top:8px; line-height:1.5; font-weight:400; }
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
    .p-home-clubs { padding:80px 40px; background:var(--surface-1); border-top:1px solid var(--border-subtle); }
    .p-home-clubs-inner { max-width:1360px; margin:0 auto; }
    .p-home-clubs-h { font-size:28px; font-weight:700; letter-spacing:-.025em; color:var(--text-primary); margin:0 0 32px; display:flex; align-items:center; gap:10px; }
    .p-home-club-card { background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:16px; overflow:hidden; transition:border-color .2s,transform .2s; display:flex; flex-direction:column; text-decoration:none; height:100%; }
    .p-home-club-card:hover { border-color:var(--accent-border); transform:translateY(-2px); }
    .p-home-club-img { height:160px; background:var(--surface-3); position:relative; flex-shrink:0; }
    .p-home-club-body { padding:18px 20px; flex:1; display:flex; flex-direction:column; gap:4px; }
    .p-home-club-name { font-size:17px; font-weight:800; color:var(--text-primary); margin:0; }
    .p-home-club-addr { font-size:13px; color:var(--text-muted); margin:0; }
    .p-home-club-cta { margin-top:auto; padding-top:14px; display:block; text-align:center; background:var(--brand); color:var(--brand-on); border-radius:10px; padding:10px; font-size:12px; font-weight:800; letter-spacing:.01em; transition:background .15s; }
    .p-home-club-cta:hover { background:var(--brand-hover); }
    /* Section wrapper */
    .p-home-sec-w { max-width:1360px; margin:0 auto; padding:100px 40px; }
    .p-home-eyebrow { display:inline-flex; align-items:center; gap:10px; font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); margin-bottom:20px; }
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
    .p-home-step:hover { background:var(--surface-2); }
    .p-home-step-num { font-weight:800; font-size:60px; color:var(--text-muted); line-height:1; letter-spacing:-.05em; margin-bottom:24px; transition:color .3s; }
    .p-home-step:hover .p-home-step-num { color:var(--accent-fg); }
    .p-home-step-foot { margin-top:24px; padding-top:24px; border-top:1px solid var(--border-subtle); font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:8px; }
    .p-home-step-foot b { color:var(--text-primary); font-weight:700; }
    /* Owner */
    .p-home-owner { --p-home-owner-parallax:0px; position:relative; isolation:isolate; border-top:1px solid var(--border-subtle); background:var(--bg); overflow:hidden; }
    .p-home-owner-media { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; transform:translate3d(0,var(--p-home-owner-parallax),0); will-change:transform; }
    .p-home-owner-media-img { position:absolute; inset:-4%; background-image:url('https://images.pexels.com/photos/32474981/pexels-photo-32474981.jpeg?auto=compress&cs=tinysrgb&w=1800'); background-size:cover; background-position:center; opacity:.58; transform:scale(1.03); will-change:transform; animation:p-home-owner-kenburns 24s ease-in-out infinite alternate; }
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
    .p-home-closing { --p-home-closing-parallax:0px; position:relative; isolation:isolate; border-top:1px solid var(--border-subtle); padding:100px 40px 80px; background:var(--bg); overflow:hidden; }
    .p-home-closing-media { position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; transform:translate3d(0,var(--p-home-closing-parallax),0); will-change:transform; }
    .p-home-closing-media-img { position:absolute; inset:-4%; background-image:url('/closing-botines.jpg'); background-size:cover; background-position:center 43%; opacity:.84; transform:scale(1.03); will-change:transform; animation:p-home-closing-kenburns 26s ease-in-out infinite alternate; }
    .p-home-closing::after { content:''; position:absolute; inset:0; background:linear-gradient(110deg,var(--overlay) 8%,var(--overlay) 48%,var(--overlay) 100%),linear-gradient(180deg,var(--overlay) 0%,var(--overlay) 92%); z-index:1; pointer-events:none; }
    .p-home-closing-inner { position:relative; z-index:2; max-width:1360px; margin:0 auto; }
    .p-home-big-closing { font-size:clamp(44px,7vw,88px); font-weight:800; letter-spacing:-.05em; line-height:.98; color:var(--text-primary); margin:0 0 36px; }
    .p-home-big-closing i { font-style:italic; color:var(--accent-fg); }
    .p-home-closing-ctas { display:flex; gap:12px; flex-wrap:wrap; }
    @keyframes p-home-closing-kenburns {
      0% { transform:scale(1.03) translate3d(-1.3%, -1.1%, 0); }
      50% { transform:scale(1.08) translate3d(1.2%, 0.9%, 0); }
      100% { transform:scale(1.05) translate3d(-0.7%, 1.2%, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .p-home-hero-bg::before,
      .p-home-hero-bg::after,
      .p-home-aurora-orb { animation:none; }
      .p-home-owner-media { transform:translate3d(0,0,0); }
      .p-home-owner-media-img { animation:none; transform:scale(1.03); }
      .p-home-closing-media { transform:translate3d(0,0,0); }
      .p-home-closing-media-img { animation:none; transform:scale(1.03); }
    }
    /* Footer */
    .p-home-foot { background:var(--surface-1); border-top:1px solid var(--border-subtle); padding:52px 40px 28px; }
    .p-home-foot-inner { max-width:1360px; margin:0 auto; }
    .p-home-foot-cols { display:grid; grid-template-columns:1.6fr repeat(3,1fr); gap:48px; padding-bottom:36px; border-bottom:1px solid var(--border-subtle); }
    .p-home-foot-brand { display:flex; flex-direction:column; gap:12px; max-width:320px; }
    .p-home-foot-brand p { font-size:13px; line-height:1.6; color:var(--text-muted); margin:0; }
    .p-home-foot-col h6 { font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--text-muted); margin:0 0 14px; }
    .p-home-foot-col ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px; }
    .p-home-foot-col li a,.p-home-foot-col li button { font-size:13px; color:var(--text-muted); font-weight:500; transition:color .15s; background:none; border:none; padding:0; cursor:pointer; font-family:inherit; text-align:left; }
    .p-home-foot-col li a:hover,.p-home-foot-col li button:hover { color:var(--accent-fg); }
    .p-home-foot-base { padding-top:24px; display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; font-size:12px; color:var(--text-muted); margin-top:28px; }
    /* Contact panel */
    .p-home-contact-overlay { position:fixed; inset:0; background:var(--overlay); z-index:60; transition:opacity .3s; }
    .p-home-contact-panel { position:fixed; top:0; right:0; height:100%; width:100%; max-width:360px; background:var(--surface-1); z-index:70; box-shadow:var(--shadow-lg); transform:translateX(100%); transition:transform .3s ease-out; border-left:1px solid var(--border-subtle); }
    .p-home-contact-panel.p-home-open { transform:translateX(0); }
    /* Dropdowns */
    .p-home-dropdown { position:absolute; top:calc(100% + 8px); left:0; min-width:220px; width:max-content; max-width:min(360px, calc(100vw - 32px)); background:var(--surface-1); border:1px solid var(--border-subtle); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-md); z-index:100; }
    /* Responsive */
    @media(max-width:1024px){
      .p-home-hero-inner{grid-template-columns:1fr;gap:40px}
      .p-home-hero-side{flex-direction:row;min-width:auto;width:100%}
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
      .p-home-clubs{padding:56px 24px}
      .p-home-owner-inner{padding:56px 24px}
      .p-home-closing{padding:72px 24px}
      .p-home-foot{padding:44px 24px 24px}
      .p-home-foot-cols{grid-template-columns:1fr 1fr;gap:28px}
      .p-home-foot-brand{grid-column:1 / -1;max-width:none}
      .p-home-search{border-radius:24px;padding:8px;gap:8px}
      .p-home-search-divider{display:none}
      .p-home-search-sport{order:1;flex:1 1 0;min-width:0}
      .p-home-search-date{order:2;flex:0 0 auto;margin-left:auto}
      .p-home-search-loc{order:3;flex:1 0 100%}
      .p-home-search-input{width:100%;min-width:0;padding:12px 14px}
      .p-home-search-cta{order:4;width:100%;justify-content:center;padding:14px 18px}
      .p-home-search .p-home-dropdown{left:0;right:auto;width:100%;min-width:0;max-width:100%}
      .p-home-contact-panel{top:auto;right:0;bottom:0;left:0;height:auto;max-width:none;max-height:min(78vh,680px);border-left:none;border-top:1px solid var(--border-subtle);border-radius:20px 20px 0 0;transform:translateY(100%)}
      .p-home-contact-panel.p-home-open{transform:translateY(0)}
    }
    @media(max-width:480px){
      .p-home-foot-cols{grid-template-columns:1fr}
    }
    @keyframes p-home-spin{to{transform:rotate(360deg)}}
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
    .p-home-hero-stat { display:flex; align-items:center; gap:8px; margin-top:18px; font-size:13px; color:var(--text-muted); font-weight:500; animation:p-home-fade-up .6s ease both .82s; }
    .p-home-hero-stat b { color:var(--accent-fg); font-weight:700; }
    .p-home-hero-stat-dot { width:6px; height:6px; border-radius:50%; background:var(--brand); opacity:.7; flex-shrink:0; }
    /* Marquee strip */
    .p-home-marquee-wrap { overflow:hidden; border-bottom:1px solid var(--border-subtle); background:var(--surface-1); padding:20px 0; }
    .p-home-marquee-track { display:flex; gap:14px; width:max-content; animation:p-home-marquee 40s linear infinite; }
    .p-home-marquee-wrap:hover .p-home-marquee-track { animation-play-state:paused; }
    .p-home-marquee-track.p-home-marquee-static { width:100%; min-width:100%; justify-content:center; flex-wrap:wrap; padding:0 24px; animation:none; }
    @keyframes p-home-marquee { to { transform:translateX(-50%); } }
    .p-home-marquee-item { display:inline-flex; align-items:center; gap:8px; padding:7px 16px; background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:999px; font-size:12px; font-weight:600; color:var(--text-muted); white-space:nowrap; transition:color .2s,border-color .2s; cursor:default; }
    .p-home-marquee-item:hover { color:var(--text-secondary); border-color:var(--border); }
    .p-home-marquee-dot { width:5px; height:5px; border-radius:50%; background:var(--brand); opacity:.5; flex-shrink:0; }
    /* Sport card count overlay */
    .p-home-sport-club-count { font-size:11px; color:var(--card-accent,var(--brand)); font-weight:700; letter-spacing:.08em; margin-bottom:4px; opacity:.85; }
    /* Aurora orbs */
    .p-home-aurora-orb { position:absolute; border-radius:50%; filter:blur(90px); pointer-events:none; will-change:transform; }
    .p-home-aurora-1 { width:700px; height:500px; top:-150px; left:-140px; background:var(--accent-bg-soft); animation:p-home-aurora-1 16s ease-in-out infinite; }
    .p-home-aurora-2 { width:580px; height:420px; bottom:-120px; right:8%; background:var(--accent-bg-soft); animation:p-home-aurora-2 20s ease-in-out infinite; }
    .p-home-aurora-3 { width:360px; height:280px; top:35%; right:22%; background:var(--accent-bg-faint); animation:p-home-aurora-3 24s ease-in-out infinite; }
    @keyframes p-home-aurora-1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(70px,-60px) scale(1.1)} 66%{transform:translate(-40px,50px) scale(.93)} }
    @keyframes p-home-aurora-2 { 0%,100%{transform:translate(0,0) scale(1)} 40%{transform:translate(-90px,35px) scale(1.13)} 70%{transform:translate(55px,-25px) scale(.97)} }
    @keyframes p-home-aurora-3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(50px,70px) scale(1.18)} }
    /* Gradient animated text */
    .p-home-grad-text { display:inline-block; overflow:visible; padding-inline:.14em; margin-inline:-.14em; background:linear-gradient(90deg,var(--brand) 0%,var(--brand-hover) 35%,var(--brand-hover) 65%,var(--brand) 100%); background-size:220% 100%; background-repeat:no-repeat; background-position:0% 50%; -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; animation:p-home-grad-shift 4.6s ease-in-out infinite alternate; font-style:italic; }
    @keyframes p-home-grad-shift { from{background-position:0% 50%} to{background-position:100% 50%} }
    /* Rotating sport word */
    .p-home-sport-word { display:inline-block; letter-spacing:0; line-height:1.02; overflow:visible; padding-inline:.1em; margin-inline:-.1em; transition:opacity .36s ease, transform .36s ease; }
    .p-home-sport-word-out { opacity:0; transform:translateY(12px); }
    /* Sport card per-card glow */
    .p-home-sport-card:hover { border-color:var(--border); transform:translateY(-5px); }
    /* Universal close button */
    .p-home-close-btn { width:30px; height:30px; border-radius:8px; background:var(--border-subtle); border:1px solid var(--border-subtle); display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--text-muted); flex-shrink:0; transition:background .15s,color .15s; }
    .p-home-close-btn:hover { background:var(--border); color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-close-btn { background:var(--surface-2); border-color:var(--border); color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-close-btn:hover { background:var(--border); color:var(--text-secondary); }
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
    .p-home-root.p-home-theme-light .p-home-live-card { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 28px var(--border); }
    .p-home-root.p-home-theme-light .p-home-live-head { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-live-stat { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-live-label { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-sports { border-bottom-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-sports-h3,
    .p-home-root.p-home-theme-light .p-home-sec-h,
    .p-home-root.p-home-theme-light .p-home-value-body h4,
    .p-home-root.p-home-theme-light .p-home-clubs-h,
    .p-home-root.p-home-theme-light .p-home-big-closing { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-sport-card { border-color:var(--border); box-shadow:0 8px 26px var(--border); }
    .p-home-root.p-home-theme-light .p-home-sport-bg::after { background:linear-gradient(0deg,var(--overlay-strong),transparent 62%); }
    .p-home-root.p-home-theme-light .p-home-sport-count { color:var(--ink-50); }
    .p-home-root.p-home-theme-light .p-home-sport-name { color:var(--surface-1); }
    .p-home-root.p-home-theme-light .p-home-clubs { background:var(--surface-2); border-top-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-club-card { background:var(--surface-1); border-color:var(--border); box-shadow:0 10px 24px var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-club-name { color:var(--text-primary); }
    .p-home-root.p-home-theme-light .p-home-club-addr { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-sec-sub,
    .p-home-root.p-home-theme-light .p-home-value-body p,
    .p-home-root.p-home-theme-light .p-home-faq-a { color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-eyebrow,
    .p-home-root.p-home-theme-light .p-home-foot-col h6,
    .p-home-root.p-home-theme-light .p-home-owner-side-h { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-eyebrow::before { background:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-values-band,
    .p-home-root.p-home-theme-light .p-home-owner,
    .p-home-root.p-home-theme-light .p-home-faq-band,
    .p-home-root.p-home-theme-light .p-home-closing { border-top-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-value { border-top-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-value-num,
    .p-home-root.p-home-theme-light .p-home-step-num { color:var(--border-strong); }
    .p-home-root.p-home-theme-light .p-home-step-foot { border-top-color:var(--border-subtle); color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-step-foot b { color:var(--text-primary); }
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
    .p-home-root.p-home-theme-light .p-home-closing-media-img { opacity:.98; }
    .p-home-root.p-home-theme-light .p-home-closing::after { background:linear-gradient(110deg,rgba(245,244,240,.8) 0%,rgba(245,244,240,.42) 44%,rgba(245,244,240,.1) 100%),linear-gradient(180deg,rgba(245,244,240,.12) 0%,rgba(245,244,240,.5) 92%); }
    .p-home-root.p-home-theme-light .p-home-foot { background:var(--bg); border-top-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-foot-cols { border-bottom-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-foot-brand p,
    .p-home-root.p-home-theme-light .p-home-foot-col li a,
    .p-home-root.p-home-theme-light .p-home-foot-col li button,
    .p-home-root.p-home-theme-light .p-home-foot-base { color:var(--text-muted); }
    .p-home-root.p-home-theme-light .p-home-foot-col li a:hover,
    .p-home-root.p-home-theme-light .p-home-foot-col li button:hover { color:var(--positive-fg); }
    .p-home-root.p-home-theme-light .p-home-contact-overlay { background:var(--overlay); }
    .p-home-root.p-home-theme-light .p-home-contact-panel { background:var(--surface-1); border-left-color:var(--border); box-shadow:var(--shadow-lg); }
    .p-home-root.p-home-theme-light .p-home-contact-panel p,
    .p-home-root.p-home-theme-light .p-home-contact-panel div,
    .p-home-root.p-home-theme-light .p-home-contact-panel button { color:var(--text-primary)!important; }
    .p-home-root.p-home-theme-light .p-home-dropdown { background:var(--surface-1); border-color:var(--border); box-shadow:var(--shadow-md); }
    .p-home-root.p-home-theme-light .p-home-dropdown button { color:var(--text-primary)!important; }
    .p-home-root.p-home-theme-light .p-home-dropdown button:hover { background:var(--surface-2)!important; }
    .p-home-root.p-home-theme-light .p-home-marquee-wrap { background:var(--surface-2); border-bottom-color:var(--border-subtle); }
    .p-home-root.p-home-theme-light .p-home-marquee-item { background:var(--surface-1); border-color:var(--border); color:var(--text-secondary); }
    .p-home-root.p-home-theme-light .p-home-marquee-item:hover { color:var(--text-primary); border-color:var(--border-strong); }
    /* Aurora orbs — reduce intensity on light background */
    .p-home-root.p-home-theme-light .p-home-aurora-1 { background:rgba(182,243,106,.48); opacity:.78; }
    .p-home-root.p-home-theme-light .p-home-aurora-2 { background:rgba(47,175,106,.22); opacity:.72; }
    .p-home-root.p-home-theme-light .p-home-aurora-3 { background:rgba(255,209,102,.24); opacity:.7; }
    /* Value/step section numbers — stronger contrast in light mode */
    .p-home-root.p-home-theme-light .p-home-value-num,
    .p-home-root.p-home-theme-light .p-home-step-num { color:var(--text-muted); }
  `;

  return (
    <>
      <Head>
        <title>Pique — Reservá, jugá, encontrá jugadores</title>
      </Head>
      <style dangerouslySetInnerHTML={{ __html: homeCss }} />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <div className={`p-home-root${isLight ? ' p-home-theme-light' : ''}`} onClick={() => {
        setShowCityDropdown(false);
        setShowSportDropdown(false);
        }}>
      <NavBar onContactClick={toggleContactDrawer} onNavbarInteract={handleNavbarInteract} showContactLink showHomeShortcuts />

      {/* Hero */}
      <section className="p-home-hero">
        <div className="p-home-hero-visuals" aria-hidden="true">
          <div className="p-home-hero-bg" />
          <div className="p-home-hero-noise" />
          <div className="p-home-aurora-orb p-home-aurora-1" />
          <div className="p-home-aurora-orb p-home-aurora-2" />
          <div className="p-home-aurora-orb p-home-aurora-3" />
        </div>
        <div className="p-home-hero-inner">
          <div className="p-home-hero-copy">
            <span className="p-home-hero-eyebrow">
              <span className="p-home-hero-eyebrow-dot" />
              <span>Reservas y gestión para complejos en Argentina</span>
            </span>
            <h1 className="p-home-hero-h1">
              Reservá<br />
              <span className={`p-home-sport-word${heroWordVisible ? '' : ' p-home-sport-word-out'}`}>
                <span className="p-home-grad-text" style={{ backgroundImage: [
                  'linear-gradient(90deg,var(--brand) 0%,var(--brand-hover) 50%,var(--brand) 100%)',
                  'linear-gradient(90deg,var(--accent-fg) 0%,var(--brand-hover) 50%,var(--accent-fg) 100%)',
                  'linear-gradient(90deg,var(--lima-700) 0%,var(--brand) 50%,var(--lima-500) 100%)',
                  'linear-gradient(90deg,var(--ink-500) 0%,var(--brand-hover) 50%,var(--accent-fg) 100%)',
                ][heroSportIdx] }}>{sportWords[heroSportIdx]}</span>
              </span>
              <br />al toque.
            </h1>
            <p className="p-home-hero-sub">Buscá cancha, elegí horario y reservá en minutos. Y si tenés un complejo, empezá a gestionar tus turnos con Pique.</p>

            {/* Search bar */}
            <div ref={searchBarRef} className="p-home-search" onClick={e => e.stopPropagation()}>
              {/* Sport selector */}
              <div className="p-home-search-seg p-home-search-sport" style={{ position: 'relative' }} onClick={(e) => { e.stopPropagation(); setShowCityDropdown(false); closeDatepicker(); setShowSportDropdown(p => !p); }}>
                <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{selectedSport.icon}</span>
                <span>{selectedSport.label}</span>
                <ChevronDown className={`p-home-search-caret${showSportDropdown ? ' p-home-search-caret-open' : ''}`} />
                {showSportDropdown && (
                  <div className="p-home-dropdown" onClick={e => e.stopPropagation()}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-muted)' }}>Elegí deporte</div>
                    {sportOptions.map(sport => (
                      <button key={sport.value} onClick={() => { setSearchSport(sport.value); setShowSportDropdown(false); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 16px', background: searchSport === sport.value ? 'var(--accent-bg-soft)' : 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: searchSport === sport.value ? 'var(--brand)' : 'var(--text-secondary)', fontSize: 14, fontWeight: 600 }}>
                        <span style={{ color: searchSport === sport.value ? 'var(--brand)' : 'var(--text-muted)', display: 'flex' }}>{sport.icon}</span>
                        {sport.label}
                      </button>
                    ))}
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
                  className="p-home-search-input"
                  value={searchCity}
                  onChange={(e) => { const v = e.target.value; setSearchCity(v); if (!v.trim()) setSelectedLocation(null); setShowCityDropdown(true); }}
                  onFocus={(e) => { e.target.select(); setShowSportDropdown(false); closeDatepicker(); setShowCityDropdown(true); }}
                  autoComplete="off"
                />
                {showCityDropdown && (
                  <div className="p-home-dropdown" style={{ minWidth: 280 }} onClick={e => e.stopPropagation()}>
                    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-muted)' }}>Lugares disponibles</div>
                    <ul style={{ maxHeight: 220, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
                      {loadingLocations ? (
                        <li style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Cargando...</li>
                      ) : locationSuggestions.length > 0 ? (
                        locationSuggestions.map((loc, i) => (
                          <li key={i} onClick={() => selectCity(loc)} style={{ padding: '11px 16px', cursor: 'pointer', borderBottom: '1px solid var(--surface-2)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, transition: 'background .15s' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                            <MapPin size={13} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                            <div><div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{loc.label}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{loc.country}</div></div>
                          </li>
                        ))
                      ) : (
                        <li style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Sin resultados</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <div className="p-home-search-divider" />
              {/* Date */}
              <div className="p-home-search-seg p-home-search-date" onClick={() => { setShowCityDropdown(false); setShowSportDropdown(false); }}>
                <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
                <DatePickerDark
                  selected={searchDate ? (() => { const [y,m,d] = searchDate.split('-').map(Number); return new Date(y,m-1,d); })() : null}
                  onChange={(date: Date | null) => { if (!date) { setSearchDate(''); return; } setSearchDate(formatLocalDate(date)); }}
                  minDate={getEffectiveToday()}
                  showIcon={false}
                  inputSize="compact"
                  dateFormat="dd MMM"
                  inputClassName="bg-transparent border-none outline-none font-semibold text-xs p-0 w-[64px] cursor-pointer focus:ring-0"
                  variant="dark"
                />
              </div>
              {/* CTA */}
              <button className="p-home-search-cta" onClick={handleSearch} disabled={isSearching}>
                {isSearching ? 'Buscando...' : 'Buscar'}
                <Search size={13} />
              </button>
            </div>

            <div className="p-home-search-quicks">
              {locationOptions.slice(0, 4).map((loc, i) => (
                <button key={i} className="p-home-quick-chip" onClick={() => selectCity(loc)}>{loc.label}</button>
              ))}
            </div>
            {!loadingClubs && clubs.length > 0 && (
              <div className="p-home-hero-stat">
                <span className="p-home-hero-stat-dot" />
                <span>
                  <b>{clubs.length}</b>{' '}
                  {clubs.length === 1 ? 'club disponible en Argentina' : 'clubes disponibles en Argentina'}
                </span>
              </div>
            )}
          </div>

          <div className="p-home-hero-side">
            <div className="p-home-live-card">
              <div className="p-home-live-head"><span className="p-home-live-dot" />Reservas</div>
              <div className="p-home-live-stat">En minutos</div>
              <div className="p-home-live-label">Buscás, elegís y confirmás sin vueltas.</div>
            </div>
            <div className="p-home-live-card">
              <div className="p-home-live-head">Para complejos</div>
              <div className="p-home-live-stat" style={{ fontSize: 20 }}>Más orden</div>
              <div className="p-home-live-label">Publicá horarios, ordená cobros y recibí reservas desde un solo panel.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── MARQUEE STRIP ── */}
      {!loadingClubs && clubs.length > 0 && (
        <div className="p-home-marquee-wrap">
          <div className={`p-home-marquee-track${shouldAnimateMarquee ? '' : ' p-home-marquee-static'}`}>
            {marqueeClubs.map((club, i) => (
              <div key={i} className="p-home-marquee-item">
                <span className="p-home-marquee-dot" />
                {club.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SPORTS GRID ── */}
      <section id="deportes" className="p-home-sports" style={{ scrollMarginTop: 88 }}>
        <div className="p-home-sports-head">
          <h3 className="p-home-sports-h3 p-home-sr">Encontrá tu deporte y <i>reservá sin vueltas.</i></h3>
        </div>
        <div className="p-home-sports-grid">
          {[
            {
              name: 'Fútbol',
              sub: 'F5 · F7 · F11',
              sport: 'futbol',
              bg: 'linear-gradient(135deg,var(--ink-900),var(--lima-900))',
              photo: 'https://images.pexels.com/photos/27394466/pexels-photo-27394466.jpeg?auto=compress&cs=tinysrgb&w=1600',
              bgPosition: 'center 52%',
              accent: 'var(--brand)',
              countKey: 'futbol' as const
            },
            {
              name: 'Pádel',
              sub: 'Cubierto & Panorámico',
              sport: 'padel',
              bg: 'linear-gradient(135deg,var(--ink-900),var(--ink-700))',
              photo: 'https://images.pexels.com/photos/32897038/pexels-photo-32897038.jpeg?auto=compress&cs=tinysrgb&w=1600',
              bgPosition: 'center 42%',
              accent: 'var(--accent-fg)',
              countKey: 'padel' as const
            },
            {
              name: 'Tenis',
              sub: 'Polvo & cemento',
              sport: 'tenis',
              bg: 'linear-gradient(135deg,var(--ink-900),var(--lima-900))',
              photo: 'https://images.pexels.com/photos/19872965/pexels-photo-19872965.jpeg?auto=compress&cs=tinysrgb&w=1600',
              bgPosition: 'center 54%',
              accent: 'var(--lima-500)',
              countKey: 'tenis' as const
            },
            {
              name: 'Otros deportes',
              sub: 'Hockey · Vóley · Básquet',
              sport: '',
              bg: 'linear-gradient(135deg,var(--ink-900),var(--ink-700))',
              photo: 'https://images.pexels.com/photos/9716286/pexels-photo-9716286.jpeg?auto=compress&cs=tinysrgb&w=1600',
              bgPosition: 'center',
              accent: 'var(--accent-fg)',
              countKey: 'otros' as const
            },
          ].map((s, si) => (
            <div key={s.name} className={`p-home-sport-card p-home-sr p-home-sr-d${si + 1}`} style={{'--card-accent': s.accent} as React.CSSProperties} onClick={() => router.push({ pathname: '/complejos', query: s.sport ? { sport: s.sport } : {} })}>
              <div
                className="p-home-sport-bg"
                style={{
                  background: s.bg,
                  backgroundImage: s.photo
                    ? `linear-gradient(160deg, var(--overlay) 0%, var(--overlay) 58%, var(--overlay-strong) 100%), url('${s.photo}')`
                    : undefined,
                  backgroundPosition: s.bgPosition || 'center',
                }}
              />
              <div className="p-home-sport-content">
                {!loadingClubs && sportClubCounts[s.countKey] > 0 && (
                  <div className="p-home-sport-club-count">{sportClubCounts[s.countKey]} clubes</div>
                )}
                <div className="p-home-sport-count">{s.sub}</div>
                <div className="p-home-sport-name">{s.name} →</div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {/* ── VALUES (POR QUE PIQUE) ── */}
      <section id="por-que-pique" className="p-home-values-band" style={{ scrollMarginTop: 88 }}>
        <div className="p-home-sec-w">
          <div className="p-home-values-grid">
            <div className="p-home-values-h p-home-sr-left">
              <span className="p-home-eyebrow">Por qué Pique</span>
              <h2 className="p-home-sec-h">La forma más<br /><b>fluida</b> de <i>jugar.</i></h2>
              <p className="p-home-sec-sub">Elegís cancha, horario y confirmás en el momento.</p>
            </div>
            <div className="p-home-values-list">
              {[
                { num: '01', title: 'Confirmación al instante', desc: 'Si la cancha está libre, la reservás en segundos.' },
                { num: '02', title: 'Clubes verificados', desc: 'Fotos, precios y horarios más claros antes de reservar.' },
                { num: '03', title: 'Cambios más simples', desc: 'Si surge algo, gestionás tu reserva desde la app.' },
                { num: '04', title: 'Pago claro', desc: 'Ves cómo se paga cada turno antes de confirmar.' },
              ].map((v, vi) => (
                <div key={v.num} className={`p-home-value p-home-sr p-home-sr-d${vi + 1}`}>
                  <div className="p-home-value-num">{v.num}</div>
                  <div className="p-home-value-body"><h4>{v.title}</h4><p>{v.desc}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── OWNER (PARA COMPLEJOS) ── */}
      <section id="para-complejos" ref={ownerSectionRef} className="p-home-owner" style={{ scrollMarginTop: 88 }}>
        <div className="p-home-owner-media" aria-hidden="true">
          <div className="p-home-owner-media-img" />
        </div>
        <div className="p-home-owner-inner">
          <div className="p-home-sr-left">
            <span className="p-home-eyebrow">Para complejos</span>
            <h2 className="p-home-sec-h">Llená tu agenda con<br /><i>reservas online.</i></h2>
            <p className="p-home-sec-sub">Sumate a Pique y centralizá agenda, cobros y comunicación con jugadores en un solo lugar.</p>
            <div className="p-home-owner-ctas">
              <button className="p-home-btn p-home-btn-primary" onClick={toggleContactDrawer}>Quiero sumar mi complejo →</button>
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
              <h2 className="p-home-sec-h">Preguntas<br /><i>frecuentes.</i></h2>
              <p className="p-home-sec-sub">Lo básico antes de reservar o sumar tu complejo.</p>
              <button className="p-home-btn p-home-btn-ghost" onClick={toggleContactDrawer} style={{ marginTop: 4 }}>Escribinos →</button>
            </div>
            <div className="p-home-faq-list">
              {[
                { q: '¿Tengo que pagar para usar Pique?', a: 'No. Usar Pique es gratis para jugadores. Solo pagás el valor de la reserva definido por el complejo.' },
                { q: '¿Puedo cancelar una reserva si no puedo ir?', a: 'Sí. Cada complejo define su política y la ves antes de confirmar.' },
                { q: '¿Qué pasa si llueve el día de mi partido?', a: 'Si el club suspende por lluvia, se gestiona según la política del complejo.' },
                { q: '¿Con cuánta anticipación puedo reservar?', a: 'Podés reservar con anticipación según la disponibilidad que publique cada club.' },
                { q: '¿Puedo gestionar más de una cancha o sede?', a: 'Sí. Pique permite manejar múltiples canchas, horarios y precios desde un mismo panel.' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  ref={el => { faqRefs.current[idx] = el; }}
                  className={`p-home-faq-item${openFaqIndex === idx ? ' p-home-open' : ''}`}
                  onClick={e => { e.stopPropagation(); setOpenFaqIndex(openFaqIndex === idx ? null : idx); }}
                >
                  <div className="p-home-faq-q">
                    {item.q}
                    <svg className="p-home-faq-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>
                  </div>
                  <div className="p-home-faq-a">{item.a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CLOSING CTA ── */}
      <section ref={closingSectionRef} className="p-home-closing">
        <div className="p-home-closing-media" aria-hidden="true">
          <div className="p-home-closing-media-img" />
        </div>
        <div className="p-home-closing-inner">
          <div className="p-home-big-closing p-home-sr-up">
            ¿Tenés un club?<br /><i>Sumate a Pique.</i>
          </div>
          <div className="p-home-closing-ctas p-home-sr p-home-sr-d2">
            <button className="p-home-btn p-home-btn-primary" onClick={toggleContactDrawer}>
              Quiero sumar mi club →
            </button>
            <button className="p-home-btn p-home-btn-ghost" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => document.getElementById('cityInput')?.focus(), 600); }}>
              Buscar cancha
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="p-home-foot">
        <div className="p-home-foot-inner">
          <div className="p-home-foot-cols">
            <div className="p-home-foot-brand">
              <PiqueLogo variant={isLight ? 'horizontal' : 'horizontalDark'} style={{ width: 96, height: 'auto', display: 'block' }} />
              <p>Reservas deportivas y gestión de complejos, en un solo lugar.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { href: 'https://wa.me/5493513436163', label: 'WhatsApp', icon: <Phone size={15} /> },
                  { href: 'mailto:soporte.pique@gmail.com', label: 'Email', icon: <Mail size={15} /> },
                  { href: 'https://www.instagram.com/pique.app_/', label: 'Instagram', icon: <Instagram size={15} /> },
                ].map(s => (
                  <a key={s.label} href={s.href} target="_blank" rel="noopener" aria-label={s.label}
                    style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', transition: 'color .15s, border-color .15s' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.borderColor = 'var(--accent-border)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
                    {s.icon}
                  </a>
                ))}
              </div>
            </div>
            <div className="p-home-foot-col">
              <h6>Jugadores</h6>
              <ul>
                <li><Link href="/bookings">Mis reservas</Link></li>
                <li><Link href="/login">Crear cuenta</Link></li>
              </ul>
            </div>
            <div className="p-home-foot-col">
              <h6>Complejos</h6>
              <ul>
                <li><button onClick={toggleContactDrawer}>Sumá tu complejo</button></li>
                <li><button onClick={toggleContactDrawer}>Contactar ventas</button></li>
              </ul>
            </div>
            <div className="p-home-foot-col">
              <h6>Soporte</h6>
              <ul>
                <li><a href="mailto:soporte.pique@gmail.com">soporte.pique@gmail.com</a></li>
                <li><a href="https://wa.me/5493513436163" target="_blank" rel="noopener">WhatsApp</a></li>
                <li><Link href="/legal/privacy">Privacidad</Link></li>
                <li><Link href="/legal/terms">Términos</Link></li>
              </ul>
            </div>
          </div>
          <div className="p-home-foot-base">
            <span>© {new Date().getFullYear()} Pique · Hecho en Argentina · Con pasión por el juego</span>
          </div>
        </div>
      </footer>

      {/* ── CONTACT SIDEBAR ── */}
      <div className="p-home-contact-overlay" style={{ opacity: showContact ? 1 : 0, pointerEvents: showContact ? 'auto' : 'none' }} onClick={() => setShowContact(false)} />
      <div
        ref={sidebarRef}
        className={`p-home-contact-panel${showContact ? ' p-home-open' : ''}`}
        style={{
          visibility: showContact ? 'visible' : 'hidden',
          pointerEvents: showContact ? 'auto' : 'none',
        }}
        aria-hidden={!showContact}
      >
        <div style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${isLight ? 'var(--border)' : 'var(--border-subtle)'}` }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--brand)', margin: 0 }}>Contacto</h2>
          <button className="p-home-close-btn" onClick={() => setShowContact(false)} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>¿Tenés dudas o querés dar de alta tu club? Escribinos.</p>
          {([
            { type: 'whatsapp' as const, label: 'WhatsApp', value: '+54 351 343 6163', icon: <Phone size={16} /> },
            { type: 'email' as const, label: 'Email', value: 'soporte.pique@gmail.com', icon: <Mail size={16} /> },
          ]).map(c => (
            <button key={c.type} type="button" onClick={e => openContactMenu(e, c.type)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: isLight ? 'var(--surface-2)' : 'var(--border-subtle)', border: `1px solid ${isLight ? 'var(--border)' : 'var(--border-subtle)'}`, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'border-color .15s', width: '100%' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-border)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = isLight ? 'var(--border)' : 'var(--border-subtle)')}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'var(--positive-bg)',
                  border: '1px solid var(--accent-border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-fg)',
                  flexShrink: 0
                }}
              >
                {c.icon}
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.04em', color: isLight ? 'var(--text-muted)' : 'var(--text-muted)' }}>{c.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: isLight ? 'var(--text-primary)' : 'var(--text-primary)' }}>{c.value}</div>
              </div>
            </button>
          ))}
          <div style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${isLight ? 'var(--border)' : 'var(--border-subtle)'}` }}>
            <button type="button" onClick={e => openContactMenu(e, 'instagram')} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: isLight ? 'var(--surface-2)' : 'var(--border-subtle)', border: `1px solid ${isLight ? 'var(--border)' : 'var(--border-subtle)'}`, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', color: isLight ? 'var(--text-secondary)' : 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
              <Instagram size={15} /> @pique.app_
            </button>
          </div>
          {contactMenu && (
            <div ref={menuRef} role="dialog" style={{ position: 'absolute', top: contactMenu.top, left: contactMenu.left, zIndex: 90, background: isLight ? 'var(--surface-1)' : 'var(--surface-3)', border: `1px solid ${isLight ? 'var(--border)' : 'var(--border-subtle)'}`, borderRadius: 12, padding: 6, minWidth: 150, boxShadow: isLight ? '0 8px 24px var(--border)' : 'var(--shadow-md)' }}>
              <button onClick={() => handleOpenHref(contactMenu.href)} style={{ display: 'block', width: '100%', padding: '9px 13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: isLight ? 'var(--text-primary)' : 'var(--text-primary)', fontWeight: 500, textAlign: 'left', borderRadius: 8 }}
                onMouseEnter={e => (e.currentTarget.style.background = isLight ? 'var(--surface-2)' : 'var(--border-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>Abrir</button>
              <button onClick={() => handleCopy(contactMenu.copyText)} style={{ display: 'block', width: '100%', padding: '9px 13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: isLight ? 'var(--text-primary)' : 'var(--text-primary)', fontWeight: 500, textAlign: 'left', borderRadius: 8 }}
                onMouseEnter={e => (e.currentTarget.style.background = isLight ? 'var(--surface-2)' : 'var(--border-subtle)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>Copiar</button>
            </div>
          )}
        </div>
      </div>


      </div>{/* end p-home-root */}
    </>
  );
}
