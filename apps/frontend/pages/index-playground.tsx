import { useEffect, useState, useRef, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
import { getApiUrl } from '../utils/apiUrl';
import { LocationService, Location } from '../services/LocationService';
import DatePickerDark from '../components/ui/DatePickerDark';
import { Search, MapPin, Calendar, TrendingUp, ShieldCheck, ArrowRight, ArrowUp, Menu, X, Phone, Mail, Instagram, Activity, ChevronRight, ChevronLeft, CalendarCheck, PlayCircle, ChevronDown, LogOut, Check, MessageSquare, Calculator, Users, Heart, Sparkles, Clock3, Building2, Landmark, CreditCard, QrCode } from 'lucide-react';
import Link from 'next/link';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';
import { getActiveClubSlug, hasOperatorAccess, normalizeSessionUser } from '../utils/session';
import { reportUiError } from '../utils/uiError';
import PiqueLogo from '../components/PiqueLogo';
import { IoFootballOutline } from "react-icons/io5"; // Pelota de fútbol limpia
import { IoTennisballOutline } from "react-icons/io5"; // Pelota de tenis limpia

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

// --- COMPONENTE DE ANIMACIÓN AL SCROLLEAR ---
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

// --- HELPERS DE UBICACIÓN ---
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
  padel: ['padel', 'pádel'],
  tenis: ['tenis', 'tennis'],
  futbol: ['futbol', 'fútbol', 'football']
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
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showContact, setShowContact] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeBookingsCount, setActiveBookingsCount] = useState(0);
  const [favoriteClubIds, setFavoriteClubIds] = useState<Set<number>>(new Set());
  const [favoriteClubs, setFavoriteClubs] = useState<Club[]>([]);
  const [favoriteFeedback, setFavoriteFeedback] = useState<string | null>(null);
  const [favoriteBusyByClub, setFavoriteBusyByClub] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (!favoriteFeedback) return;
    const timeout = window.setTimeout(() => setFavoriteFeedback(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [favoriteFeedback]);
  // track which FAQ item is currently open (null if none)
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const faqRefs = useRef<Array<HTMLDivElement | null>>([]);

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
  const resultsRef = useRef<HTMLElement>(null);
  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
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
  // Fecha seleccionada en formato YYYY-MM-DD. Por defecto, el día de hoy.
  const getEffectiveToday = () => {
    // Aquí podemos aplicar offsets si fuera necesario (zona horaria / reglas de negocio).
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const [searchDate, setSearchDate] = useState(() => formatLocalDate(getEffectiveToday()));
  const [lastSearchLabel, setLastSearchLabel] = useState<string>('');
  const [availableTimesByClub, setAvailableTimesByClub] = useState<Record<number, string[]>>({});
  const searchRequestIdRef = useRef(0);

  // Menú de acciones para contactos (abrir / copiar)
  const [contactMenu, setContactMenu] = useState<{
    type: 'whatsapp' | 'email' | 'instagram';
    top: number;
    left: number;
    href: string;
    copyText: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const navGlowRef = useRef<HTMLSpanElement | null>(null);
  const userMenuRootRef = useRef<HTMLDivElement | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

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
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      reportUiError({ area: 'HomePage', action: 'copyContactData' }, err);
    }
    setContactMenu(null);
  };

  const userInitials = useMemo(() => {
    if (!user) return 'TU';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.trim();
    return initials || 'TU';
  }, [user]);
  const isAdmin = hasOperatorAccess(user);
  const adminClubSlug = useMemo(() => {
    if (!user || !isAdmin) return null;

    const normalizedUser = normalizeSessionUser(user);
    const activeSlug = getActiveClubSlug(normalizedUser);
    if (activeSlug) return activeSlug;

    const fallbackClubId = Number(normalizedUser?.activeClubId || normalizedUser?.clubId || normalizedUser?.club?.id);
    if (!Number.isFinite(fallbackClubId) || fallbackClubId <= 0) return null;

    const club = clubs.find((item) => Number(item.id) === fallbackClubId);
    return club?.slug || null;
  }, [clubs, isAdmin, user]);

  const sportOptions = useMemo(() => ([
  {
    value: 'padel',
    label: 'Pádel',
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
    label: 'Fútbol',
    icon: <IoFootballOutline className="h-5 w-5" /> // Dejás la de la librería que estaba buena
  },
  {
    value: 'tenis',
    label: 'Tenis',
    icon: <IoTennisballOutline className="h-5 w-5" /> // Dejás la de la librería
  }
]), []);

  const selectedSport = sportOptions.find((sport) => sport.value === searchSport) || sportOptions[0];

  useEffect(() => {
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (userStr) {
      try {
        setUser(normalizeSessionUser(JSON.parse(userStr)));
      } catch {}
    }

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
    const loadActiveBookings = async () => {
      if (!user?.id) {
        setActiveBookingsCount(0);
        return;
      }
      try {
        const bookings = await getMyBookings(user.id);
        const active = Array.isArray(bookings) ? countActiveBookings(bookings) : 0;
        setActiveBookingsCount(active);
      } catch (error) {
        reportUiError({ area: 'HomePage', action: 'loadActiveBookings' }, error);
      }
    };

    loadActiveBookings();
  }, [user]);

  useEffect(() => {
    const loadFavorites = async () => {
      if (!user?.id) {
        setFavoriteClubIds(new Set());
        setFavoriteClubs([]);
        setFavoriteFeedback(null);
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
        reportUiError({ area: 'HomePage', action: 'loadFavorites' }, error);
      }
    };
    void loadFavorites();
  }, [user?.id]);

  const handleToggleFavorite = async (e: React.MouseEvent, club: Club) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user?.id) {
      setFavoriteFeedback('Iniciá sesión para guardar favoritos.');
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
        setFavoriteFeedback('Favorito eliminado.');
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
        setFavoriteFeedback('Favorito guardado.');
      }
    } catch (error) {
      reportUiError({ area: 'HomePage', action: 'toggleFavorite' }, error);
      setFavoriteFeedback('No se pudo actualizar favorito.');
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
      setLocationSuggestions(locationOptions.slice(0, LOCATION_LIMIT));
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
    if (next < min) return; // no retroceder más que el mínimo
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

  const handleSearch = async () => {
    const requestId = ++searchRequestIdRef.current;
    const isCurrentRequest = () => searchRequestIdRef.current === requestId;

    scrollToSearchBarTop();
    setIsSearching(true);
    setShowCityDropdown(false);
    setSearchError(null);
    setDisplayedClubs([]);
    setAvailableTimesByClub({});

    try {
      let location = searchCity.trim() ? selectedLocation : null;
      if (!location && searchCity.trim()) {
        const normalized = normalizeText(searchCity);
        const exact = locationOptions.find(
          (option) => normalizeText(option.label) === normalized || normalizeText(option.query) === normalized
        );
        if (exact) {
          location = exact;
          setSelectedLocation(exact);
          setSearchCity(exact.label);
        } else {
          const closest = locationOptions.find(
            (option) =>
              normalizeText(option.label).includes(normalized) || normalizeText(option.query).includes(normalized)
          );
          if (closest) {
            location = closest;
            setSelectedLocation(closest);
            setSearchCity(closest.label);
          }
        }
      }

      let finalClubs = clubs;
      if (location) {
        const coordsResults = await fetchLocations(location.query, 1);
        const locationCoords = coordsResults[0];
        if (!locationCoords) {
          if (!isCurrentRequest()) return;
          setSearchError('No pudimos ubicar esa ciudad. Probá con otra.');
          setDisplayedClubs([]);
          setLastSearchLabel('');
          scrollToSearchBarTop();
          return;
        }

        const filtered: { club: Club; distance: number }[] = (await Promise.all(
          clubs.map(async (club) => {
            const coords = await resolveClubCoords(club);
            if (!coords) return null;
            const distance = calculateDistanceKm({ lat: locationCoords.lat, lon: locationCoords.lon }, coords);
            if (distance > DEFAULT_RADIUS_KM) return null;
            return { club, distance };
          })
        )).filter((row): row is { club: Club; distance: number } => Boolean(row));

        filtered.sort((a, b) => a.distance - b.distance);
        finalClubs = filtered.map((item) => item.club);
      }

      if (searchDate) {
        try {
          if (/^\d{4}-\d{2}-\d{2}$/.test(searchDate)) {
            const [year, month, day] = searchDate.split('-').map(Number);
            const parsed = new Date(year, month - 1, day);
            if (!isNaN(parsed.getTime())) {
              const dayOfWeek = parsed.getDay(); // 0 (Dom) .. 6 (Sab)
              finalClubs = finalClubs.filter((club) => {
                const closureDates = Array.isArray((club as any).closureDates)
                  ? (club as any).closureDates.map((value: unknown) => String(value || '').trim())
                  : [];
                const clubOperationalStatus = String((club as any).clubOperationalStatus || 'OPEN');
                const temporaryClosureStartDate = String((club as any).temporaryClosureStartDate || '').trim();
                const temporaryClosureEndDate = String((club as any).temporaryClosureEndDate || '').trim();

                if (clubOperationalStatus === 'PERMANENTLY_CLOSED') return false;
                if (
                  clubOperationalStatus === 'TEMPORARY_CLOSED' &&
                  /^\d{4}-\d{2}-\d{2}$/.test(temporaryClosureStartDate) &&
                  /^\d{4}-\d{2}-\d{2}$/.test(temporaryClosureEndDate) &&
                  searchDate >= temporaryClosureStartDate &&
                  searchDate <= temporaryClosureEndDate
                ) {
                  return false;
                }

                if (closureDates.includes(searchDate)) return false;
                if (!Array.isArray(club.openingDays) || club.openingDays.length === 0) return true; // no config => open all days
                return club.openingDays.includes(dayOfWeek);
              });
            }
          }
        } catch (e) { /* noop */ }

        if (searchSport) {
          const availabilityChecks = await Promise.all(
            finalClubs.map(async (club) => {
              try {
                const courtsRes = await fetch(`${apiBase}/courts?clubSlug=${encodeURIComponent(club.slug)}`, {
                  cache: 'no-store'
                });
                if (!courtsRes.ok) return { hasSlots: false, times: [] };

                const courts = await courtsRes.json();
                const activityIds = Array.from(
                  new Set(
                    (Array.isArray(courts) ? courts : [])
                      .filter((court: any) => matchesSport(String(court?.activityType?.name || ''), searchSport))
                      .map((court: any) => Number(court?.activityType?.id))
                      .filter((activityId: number) => Number.isFinite(activityId) && activityId > 0)
                  )
                );

                if (activityIds.length === 0) return { hasSlots: false, times: [] };

                const times: string[] = [];
                const results = await Promise.all(
                  activityIds.map(async (activityId) => {
                    const res = await fetch(
                      `${apiBase}/bookings/availability-with-courts?activityId=${activityId}&date=${searchDate}&clubSlug=${encodeURIComponent(club.slug)}&t=${Date.now()}`,
                      { cache: 'no-store' }
                    );
                    if (!res.ok) return [];
                    const data = await res.json();
                    const slots = Array.isArray(data?.slotsWithCourts)
                      ? data.slotsWithCourts.filter((slot: any) => Array.isArray(slot.availableCourts) && slot.availableCourts.length > 0)
                      : [];
                    return slots
                      .map((slot: any) => (slot?.slotTime ? String(slot.slotTime) : null))
                      .filter((slotTime: string | null): slotTime is string => Boolean(slotTime));
                  })
                );

                results.forEach((slotTimes) => times.push(...slotTimes));
                const hasSlots = times.length > 0;
                if (!hasSlots) return { hasSlots: false, times: [] };
                const uniqueTimes = Array.from(new Set(times)).sort();
                return { hasSlots: true, times: uniqueTimes };
              } catch (error) {
                reportUiError({ area: 'HomePage', action: 'validateClubAvailability' }, error);
              }
              return { hasSlots: false, times: [] };
            })
          );

          if (!isCurrentRequest()) return;

          const filteredClubs: Club[] = [];
          const timesMap: Record<number, string[]> = {};
          availabilityChecks.forEach((result, index) => {
            if (result.hasSlots) {
              const club = finalClubs[index];
              filteredClubs.push(club);
              timesMap[club.id] = result.times;
            }
          });
          finalClubs = filteredClubs;
          setAvailableTimesByClub(timesMap);
        }
      } else {
        setAvailableTimesByClub({});
      }

      if (!isCurrentRequest()) return;

      setDisplayedClubs(finalClubs);
      setLastSearchLabel(location?.label || '');
      scrollToSearchBarTop();
    } catch (error) {
      if (!isCurrentRequest()) return;
      reportUiError({ area: 'HomePage', action: 'handleSearch' }, error);
      setSearchError('No pudimos completar la búsqueda. Intentá de nuevo.');
      setDisplayedClubs([]);
      setLastSearchLabel('');
      setAvailableTimesByClub({});
    } finally {
      if (isCurrentRequest()) {
        setIsSearching(false);
      }
    }
  };

  // Cierra el DatePicker abierto (si existe) forzando blur sobre su input
  const closeDatepicker = () => {
    try {
      const el = document.querySelector('input[placeholder="Selecciona fecha"]') as HTMLInputElement | null;
      if (el) el.blur();
    } catch (e) {
      // noop
    }
  };

  const selectCity = (location: LocationSuggestion) => {
    setSearchCity(location.label);
    setSelectedLocation(location);
    setShowCityDropdown(false);
  };

  const handleNavMenuMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!navMenuRef.current || !navGlowRef.current) return;
    const rect = navMenuRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    navGlowRef.current.style.opacity = '1';
    navGlowRef.current.style.transform = `translateX(${x}px) translateY(-50%)`;
  };

  const handleNavMenuLeave = () => {
    if (!navGlowRef.current) return;
    navGlowRef.current.style.opacity = '0';
  };

  const handleInteractiveMove = (event: React.MouseEvent<HTMLElement>) => {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const px = (x / rect.width) * 100;
    const py = (y / rect.height) * 100;
    const ry = ((x - rect.width / 2) / rect.width) * 6;
    const rx = ((rect.height / 2 - y) / rect.height) * 6;
    element.style.setProperty('--mx', `${px}%`);
    element.style.setProperty('--my', `${py}%`);
    element.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    element.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
  };

  const handleInteractiveLeave = (event: React.MouseEvent<HTMLElement>) => {
    const element = event.currentTarget;
    element.style.setProperty('--rx', '0deg');
    element.style.setProperty('--ry', '0deg');
  };

  useEffect(() => {
    const handleWindowScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      const maxScrollable = Math.max(scrollHeight - viewportHeight, 0);
      const progress = maxScrollable > 0 ? Math.min((scrollTop / maxScrollable) * 100, 100) : 0;
      setShowBackToTop(scrollTop > 220);
      setScrollProgress(progress);
    };

    handleWindowScroll();
    window.addEventListener('scroll', handleWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, []);

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as Node;

      if (searchBarRef.current && !searchBarRef.current.contains(target)) {
        setShowCityDropdown(false);
        setShowSportDropdown(false);
      }

      if (userMenuRootRef.current && !userMenuRootRef.current.contains(target)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleGlobalClick);
    return () => document.removeEventListener('mousedown', handleGlobalClick);
  }, []);

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <Head>
        <title>Inicio | Pique</title>
      </Head>
      <div
        className="min-h-screen relative overflow-x-hidden bg-ink-900 text-ink-50 selection:bg-lima-300 selection:text-ink-900"
        style={{ fontFamily: '"DM Sans","Manrope",sans-serif' }}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[460px] w-[760px] rounded-full bg-lima-300/10 blur-3xl ambient-drift soft-breathe" />
          <div className="absolute top-[220px] -left-28 h-[380px] w-[380px] rounded-full bg-lima-200/10 blur-3xl float-slow" />
          <div className="absolute bottom-[120px] -right-20 h-[360px] w-[360px] rounded-full bg-lima-100/10 blur-3xl float-medium float-delay" />
          <div className="absolute inset-0 gradient-pan bg-[radial-gradient(circle_at_top,var(--accent-bg-muted),transparent_52%),linear-gradient(180deg,var(--lima-900)_0%,var(--ink-800)_45%,var(--ink-900)_100%)]" />
        </div>

        <nav className="sticky top-0 z-50">
          <div className="mx-auto mt-5 flex w-[min(1120px,calc(100%-2rem))] items-center justify-between rounded-2xl border border-white/20 bg-p-surface/10 px-4 py-3 backdrop-blur-xl md:px-6">
            <div className="flex items-center gap-3">
              <PiqueLogo variant="horizontalDark" className="h-10 w-auto md:h-11" />
            </div>

            <div
              ref={navMenuRef}
              onMouseMove={handleNavMenuMove}
              onMouseLeave={handleNavMenuLeave}
              className="hidden md:flex relative items-center gap-2 p-1 rounded-full border border-white/10 bg-p-surface/5 text-sm font-semibold text-ink-50/80 overflow-hidden"
            >
              <span
                ref={navGlowRef}
                className="pointer-events-none absolute top-1/2 left-0 h-10 w-28 -translate-y-1/2 rounded-full bg-gradient-to-r from-lima-300/50 via-lima-200/50 to-lima-300/50 blur-md transition-opacity duration-200 opacity-0"
              />
              <button type="button" className="nav-pill-button" onClick={() => scrollToSection('resultados')}>Reservas</button>
              <button type="button" className="nav-pill-button" onClick={() => scrollToSection('funcionalidades')}>Funcionalidades</button>
              <button type="button" className="nav-pill-button" onClick={() => scrollToSection('precios')}>Precios</button>
              <button type="button" className="nav-pill-button" onClick={() => scrollToSection('faqs')}>FAQs</button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 relative">
              {user ? (
                <div ref={userMenuRootRef} className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowUserMenu((prev) => !prev);
                    }}
                    className="flex items-center gap-2 rounded-full border border-white/20 bg-p-surface/15 px-1.5 py-1.5 pr-3 hover:bg-p-surface/20 transition-all"
                  >
                    <div className="relative">
                      <div className="h-8 w-8 rounded-full bg-lima-300 text-ink-900 flex items-center justify-center font-black text-xs">{userInitials}</div>
                      {activeBookingsCount > 0 && (
                        <span className="absolute -right-1 -top-1 min-w-[16px] h-4 px-1 rounded-full bg-p-error text-ink-50 text-[9px] font-black flex items-center justify-center">
                          {activeBookingsCount}
                        </span>
                      )}
                    </div>
                    <span className="hidden sm:inline text-ink-50 text-sm font-bold">{user.firstName || user.name || 'Usuario'}</span>
                  </button>

                  {showUserMenu && (
                    <div
                      className="absolute right-0 mt-3 w-[290px] rounded-2xl border border-ink-700/20 bg-ink-50 shadow-2xl overflow-hidden z-[120]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-5 text-center">
                        <div className="relative mx-auto mb-3 h-16 w-16 rounded-full bg-lima-800 text-ink-50 flex items-center justify-center text-lg font-black">
                          {userInitials}
                          <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-lima-300 text-ink-900 border-2 border-ink-50 flex items-center justify-center">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        </div>
                        <h3 className="text-ink-700 text-lg font-black">{user.firstName || user.name || 'Usuario'}</h3>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-700/60 font-bold">{isAdmin ? 'Administrador' : 'Miembro'}</p>
                      </div>
                      <div className="border-t border-ink-700/10 px-5 py-4 text-sm space-y-3 text-ink-700">
                        <div className="flex items-center gap-2"><Phone size={15} className="text-lima-700" /> {user.phoneNumber || user.phone || 'Sin teléfono'}</div>
                        <div className="flex items-center gap-2 truncate"><Mail size={15} className="text-lima-700" /> {user.email || 'Sin email'}</div>
                      </div>
                      <div className="border-t border-ink-700/10 px-4 py-3 text-sm font-bold">
                        {isAdmin && (
                          <Link href="/admin/agenda" className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-ink-700/5" onClick={() => setShowUserMenu(false)}>
                            <ShieldCheck size={16} /> Gestión
                          </Link>
                        )}
                        {isAdmin && adminClubSlug && (
                          <Link href={`/club/${adminClubSlug}`} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-ink-700/5" onClick={() => setShowUserMenu(false)}>
                            <MapPin size={16} /> Mi club
                          </Link>
                        )}
                        {router.pathname !== '/perfil' && (
                          <Link href="/perfil" className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-ink-700/5" onClick={() => setShowUserMenu(false)}>
                            <Users size={16} /> Mi perfil
                          </Link>
                        )}
                        <Link href="/bookings" className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-ink-700/5" onClick={() => setShowUserMenu(false)}>
                          <span className="flex items-center gap-2"><Calendar size={16} /> Mis reservas</span>
                          {activeBookingsCount > 0 && <span className="h-5 min-w-[20px] px-1 rounded-full bg-p-error text-ink-50 text-[10px] font-black flex items-center justify-center">{activeBookingsCount}</span>}
                        </Link>
                        <button
                          type="button"
                          className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-2 text-p-error hover:bg-p-error-bg"
                          onClick={() => {
                            logout();
                            setUser(null);
                            setShowUserMenu(false);
                          }}
                        >
                          <LogOut size={16} /> Cerrar sesión
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Link href="/login" className="btn-aurora border-neon border-neon-slow rounded-full border border-[var(--accent-border)] bg-[var(--brand)] text-[var(--brand-on)] px-4 py-[11px] text-[12px] font-extrabold uppercase tracking-[.06em] leading-none hover:bg-[var(--brand-hover)] transition-colors">
                  <span>Ingresar</span>
                </Link>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (user) setShowUserMenu((prev) => !prev);
                  else setShowContact(true);
                }}
                className="md:hidden rounded-lg p-2 text-ink-50 hover:bg-p-surface/10"
              >
                <Menu size={20} />
              </button>
            </div>
          </div>
        </nav>

        <main className="relative z-10">
          <section className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-14 md:pt-20 pb-10">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-center">
              <RevealOnScroll>
                <div className="p-legacy-pill p-legacy-pill-on-dark text-xs md:text-sm mb-6 float-slow">
                  <Sparkles size={15} className="text-lima-300 icon-pop" />
                  Agenda premium para canchas y clubes deportivos
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl leading-[0.95] font-black text-ink-50 tracking-tight">
                  Reservas simples.
                  <br />
                  <span className="bg-gradient-to-r from-lima-300 via-lima-200 to-lima-100 bg-clip-text text-transparent">Imagen profesional.</span>
                </h1>
                <p className="mt-6 text-base md:text-xl text-ink-50/80 max-w-2xl">
                  Buscá canchas en tiempo real, guardá favoritos y convertí tu home en algo serio, con ritmo visual y mejor experiencia en desktop y mobile.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-ink-50/75">
                  <div className="p-legacy-pill p-legacy-pill-on-dark hover-lift float-slow"><Clock3 size={15} className="text-lima-300 icon-pop" /> Disponibilidad instantánea</div>
                  <div className="p-legacy-pill p-legacy-pill-on-dark hover-lift float-medium"><Building2 size={15} className="text-lima-200 icon-pop" /> Clubes verificados</div>
                  <div className="p-legacy-pill p-legacy-pill-on-dark hover-lift float-medium float-delay"><TrendingUp size={15} className="text-lima-100 icon-pop" /> Más reservas, menos fricción</div>
                </div>
              </RevealOnScroll>

              <RevealOnScroll delay={150}>
                <div className="relative">
                  <div
                    className="rounded-[28px] border border-white/15 bg-gradient-to-br from-white/20 to-white/5 p-5 md:p-6 backdrop-blur-xl shadow-p-lg float-slow gradient-pan mouse-flyer interactive-tilt"
                    onMouseMove={handleInteractiveMove}
                    onMouseLeave={handleInteractiveLeave}
                  >
                    <div className="rounded-2xl border border-white/15 bg-ink-50 p-5 text-ink-900">
                      <div className="flex items-center justify-between">
                        <p className="text-xs uppercase tracking-[0.2em] font-bold text-ink-900/60">Panel de hoy</p>
                        <span className="rounded-full bg-lima-300 px-2 py-1 text-[10px] font-black soft-breathe">Live</span>
                      </div>
                      <div className="mt-5 grid grid-cols-3 gap-3">
                        <div className="rounded-xl bg-ink-900/5 p-3 hover-lift">
                          <p className="text-xs text-ink-900/60">Reservas</p>
                          <p className="text-xl font-black">14</p>
                        </div>
                        <div className="rounded-xl bg-ink-900/5 p-3 hover-lift">
                          <p className="text-xs text-ink-900/60">Ingreso</p>
                          <p className="text-xl font-black">$210K</p>
                        </div>
                        <div className="rounded-xl bg-ink-900/5 p-3 hover-lift">
                          <p className="text-xs text-ink-900/60">Ocupación</p>
                          <p className="text-xl font-black">78%</p>
                        </div>
                      </div>
                      <div className="mt-5 space-y-3">
                        {['Cancha 1', 'Cancha 2', 'Cancha 3'].map((label, i) => (
                          <div key={label}>
                            <div className="flex justify-between text-xs font-bold text-ink-900/70">
                              <span>{label}</span>
                              <span>{[94, 71, 66][i]}%</span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-ink-900/10 overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-lima-700 to-lima-200" style={{ width: `${[94, 71, 66][i]}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="hidden md:block pointer-events-none absolute -right-8 top-10 rounded-2xl border border-white/35 bg-p-surface/95 px-4 py-3 text-ink-900 shadow-2xl shadow-ink-900/40 float-medium hover-lift">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-ink-900/55 font-bold">Ingresos del dia</p>
                    <p className="mt-1 text-2xl leading-none font-black">$210.000</p>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-p-positive-bg px-2 py-1 text-[10px] font-black text-lima-700">
                      <TrendingUp size={11} />
                      +15% vs ayer
                    </div>
                  </div>

                  <div className="hidden md:flex pointer-events-none absolute -bottom-7 -left-6 rounded-2xl border border-white/35 bg-p-surface/95 px-3.5 py-3 text-ink-900 shadow-2xl shadow-ink-900/40 float-slow float-delay hover-lift items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-p-positive-bg text-lima-700 flex items-center justify-center icon-pop">
                      <CalendarCheck size={15} />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-900/55 font-bold">Reserva confirmada</p>
                      <p className="text-sm font-black leading-tight">20:30 - Cancha 2</p>
                    </div>
                  </div>
                </div>
              </RevealOnScroll>
            </div>

            <div
              ref={searchBarRef}
              className="mt-10 rounded-[28px] border border-white/20 bg-p-surface/90 p-2 md:p-3 shadow-2xl shadow-black/20 relative z-30 interactive-tilt"
              onMouseMove={handleInteractiveMove}
              onMouseLeave={handleInteractiveLeave}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid gap-2 md:gap-0 md:grid-cols-[1.35fr_0.9fr_1fr_auto]">
                <div className="relative group">
                  <div
                    className="h-full rounded-2xl px-4 py-3 hover:bg-ink-900/5 transition-colors cursor-pointer flex items-center gap-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSportDropdown(false);
                      closeDatepicker();
                      setShowCityDropdown(true);
                      document.getElementById('cityInput')?.focus();
                    }}
                  >
                    <MapPin className="text-lima-700 group-hover:text-lima-900 shrink-0" size={20} />
                    <div className="flex flex-col w-full">
                      <label className="text-[10px] font-black uppercase tracking-[0.18em] text-ink-900/50">Ubicación</label>
                      <input
                        id="cityInput"
                        type="text"
                        placeholder="¿Dónde jugás?"
                        className="bg-transparent border-none outline-none text-ink-900 font-bold placeholder:text-ink-900/35 w-full p-0"
                        value={searchCity}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setSearchCity(nextValue);
                          if (!nextValue.trim()) setSelectedLocation(null);
                          setShowCityDropdown(true);
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          const input = e.currentTarget;
                          input.focus();
                          input.select();
                        }}
                        onFocus={(e) => {
                          e.target.select();
                          setShowSportDropdown(false);
                          closeDatepicker();
                          setShowCityDropdown(true);
                        }}
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  {showCityDropdown && (
                    <div className="absolute top-full left-0 mt-3 w-full md:w-[320px] rounded-2xl border border-ink-900/10 bg-p-surface shadow-xl overflow-hidden z-[160]">
                      <div className="px-4 py-3 border-b border-ink-900/10 bg-ink-50">
                        <span className="text-xs font-black uppercase tracking-[0.14em] text-ink-900/70">Lugares disponibles</span>
                      </div>
                      <ul className="max-h-64 overflow-y-auto">
                        {loadingLocations ? (
                          <li className="px-4 py-6 text-center text-ink-900/45 text-sm">Cargando ubicaciones...</li>
                        ) : locationSuggestions.length > 0 ? (
                          locationSuggestions.map((location, idx) => (
                            <li
                              key={idx}
                              onClick={() => selectCity(location)}
                              className="px-4 py-3 hover:bg-lima-50 cursor-pointer flex items-center justify-between group transition-colors border-b border-ink-900/5 last:border-0"
                            >
                              <div className="flex items-center gap-3">
                                <div className="h-7 w-7 rounded-full bg-lima-50 text-lima-700 flex items-center justify-center"><MapPin size={13} /></div>
                                <div>
                                  <p className="text-sm font-bold text-ink-900">{location.label}</p>
                                  <p className="text-xs text-ink-900/55">{location.country}</p>
                                </div>
                              </div>
                              <ChevronRight size={15} className="text-lima-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </li>
                          ))
                        ) : (
                          <li className="px-4 py-6 text-center text-ink-900/45 text-sm">No encontramos ubicaciones con ese texto.</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="relative group">
                  <div
                    className="h-full rounded-2xl px-4 py-3 hover:bg-ink-900/5 transition-colors cursor-pointer flex items-center gap-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCityDropdown(false);
                      closeDatepicker();
                      setShowSportDropdown((prev) => !prev);
                    }}
                  >
                    <Activity className="text-lima-700 shrink-0" size={20} />
                    <div className="flex flex-col overflow-hidden">
                      <label className="text-[10px] font-black uppercase tracking-[0.18em] text-ink-900/50">Deporte</label>
                      <div className="flex items-center gap-2 text-ink-900 font-bold text-sm truncate">
                        {selectedSport.icon}
                        <span>{selectedSport.label}</span>
                      </div>
                    </div>
                  </div>

                  {showSportDropdown && (
                    <div className="absolute top-full left-0 mt-3 w-full md:w-[260px] rounded-2xl border border-ink-900/10 bg-p-surface shadow-xl overflow-hidden z-[160]">
                      <div className="px-4 py-3 border-b border-ink-900/10 bg-ink-50 text-center">
                        <span className="text-xs font-black uppercase tracking-[0.18em] text-ink-900/70">Elegí deporte</span>
                      </div>
                      <ul className="py-1">
                        {sportOptions.map((sport) => {
                          const isSelected = searchSport === sport.value;
                          return (
                            <li
                              key={sport.value}
                              onClick={() => {
                                setSearchSport(sport.value);
                                setShowSportDropdown(false);
                              }}
                              className="px-4 py-3 hover:bg-lima-50 cursor-pointer flex items-center gap-3 border-b border-ink-900/5 last:border-0"
                            >
                              <div className={`h-9 w-9 rounded-full flex items-center justify-center ${isSelected ? 'bg-ink-900 text-ink-50' : 'bg-lima-50 text-ink-900'}`}>
                                {sport.icon}
                              </div>
                              <span className={`text-sm ${isSelected ? 'font-black text-ink-900' : 'font-semibold text-ink-900/80'}`}>{sport.label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="group" onClick={(e) => e.stopPropagation()}>
                  <div className="h-full rounded-2xl px-4 py-3 hover:bg-ink-900/5 transition-colors flex items-center gap-3">
                    <Calendar className="text-lima-700 shrink-0" size={20} />
                    <div className="flex flex-col w-full">
                      <label className="text-[10px] font-black uppercase tracking-[0.18em] text-ink-900/50">Fecha</label>
                      <div className="grid grid-cols-[24px,1fr,24px] items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            changeDateBy(-1);
                          }}
                          disabled={!canGoPrev()}
                          className="rounded-md p-1 text-ink-900 disabled:opacity-25 hover:bg-ink-900/10 transition-colors"
                          aria-label="Fecha anterior"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>

                        <DatePickerDark
                          selected={
                            searchDate
                              ? (() => {
                                  const [y, m, d] = searchDate.split('-').map(Number);
                                  return new Date(y, m - 1, d);
                                })()
                              : null
                          }
                          onChange={(date: Date | null) => {
                            if (!date) {
                              setSearchDate('');
                              return;
                            }
                            setSearchDate(formatLocalDate(date));
                          }}
                          minDate={getEffectiveToday()}
                          showIcon={false}
                          inputSize="compact"
                          dateFormat="EEE dd MMM yyyy"
                          inputClassName="bg-transparent border-none outline-none text-ink-900 font-bold text-sm w-full text-center p-0 uppercase cursor-pointer placeholder-ink-900/40 h-auto focus:ring-0"
                          variant="light"
                        />

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            changeDateBy(1);
                          }}
                          className="rounded-md p-1 text-ink-900 hover:bg-ink-900/10 transition-colors"
                          aria-label="Fecha siguiente"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-stretch">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSearch();
                    }}
                    disabled={isSearching}
                    className={`btn-aurora border-neon border-neon-fast border-neon-strong border-neon-search w-full rounded-2xl px-8 py-4 font-black text-sm flex items-center justify-center gap-2 transition-all ${
                      isSearching
                        ? 'bg-ink-900/70 text-ink-50 cursor-not-allowed'
                        : 'bg-ink-900 text-ink-50 hover:bg-lima-800 hover:-translate-y-[1px]'
                    }`}
                  >
                    <Search size={18} strokeWidth={3} />
                    <span>{isSearching ? 'Buscando...' : 'Buscar'}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section id="funcionalidades" className="mx-auto w-[min(1120px,calc(100%-2rem))] pt-2 pb-8">
            <RevealOnScroll>
              <div className="text-center mb-7">
                <span className="p-legacy-pill p-legacy-pill-on-dark text-xs md:text-sm">
                  <Sparkles size={14} className="text-lima-300" />
                  Funcionalidades
                </span>
                <h2 className="mt-4 text-3xl md:text-5xl font-black text-ink-50 tracking-tight">
                  Todo lo que necesita <span className="text-lima-200">tu club</span>
                </h2>
                <p className="mt-3 text-ink-50/75 text-base md:text-lg">
                  Reservas, comunicación y cobros en una sola plataforma.
                </p>
              </div>
            </RevealOnScroll>

            <RevealOnScroll delay={120}>
              <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-4 items-start">
                <div
                  className="self-start h-fit rounded-[30px] border border-ink-100/30 bg-gradient-to-br from-ink-700 via-ink-700 to-ink-800 p-5 md:p-7 shadow-2xl shadow-ink-900/45 mouse-flyer interactive-tilt"
                  onMouseMove={handleInteractiveMove}
                  onMouseLeave={handleInteractiveLeave}
                >
                  <div className="space-y-3">
                    <div className="pill-marquee-lane">
                      <div className="pill-marquee-track">
                        {[
                          'Reservas online',
                          'Recordatorios',
                          'Servicios personalizados',
                          'Pago online',
                          'Campos personalizados',
                          'Clientes frecuentes',
                          'Agenda por cancha'
                        ].concat([
                          'Reservas online',
                          'Recordatorios',
                          'Servicios personalizados',
                          'Pago online',
                          'Campos personalizados',
                          'Clientes frecuentes',
                          'Agenda por cancha'
                        ]).map((pill, idx) => (
                          <span key={`${pill}-a-${idx}`} className="pill-marquee-chip">{pill}</span>
                        ))}
                      </div>
                    </div>

                    <div className="pill-marquee-lane">
                      <div className="pill-marquee-track reverse">
                        {[
                          'WhatsApp integrado',
                          'Caja diaria',
                          'Stock buffet',
                          'Métricas en vivo',
                          'Usuarios y permisos',
                          'Cierres de caja',
                          'Bloqueo de horarios'
                        ].concat([
                          'WhatsApp integrado',
                          'Caja diaria',
                          'Stock buffet',
                          'Métricas en vivo',
                          'Usuarios y permisos',
                          'Cierres de caja',
                          'Bloqueo de horarios'
                        ]).map((pill, idx) => (
                          <span key={`${pill}-b-${idx}`} className="pill-marquee-chip">{pill}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="self-start rounded-[30px] border border-ink-100/55 bg-ink-50 p-5 md:p-6 text-center mouse-flyer interactive-tilt"
                  onMouseMove={handleInteractiveMove}
                  onMouseLeave={handleInteractiveLeave}
                >
                  <p className="text-ink-700 text-lg md:text-[1.65rem] leading-tight">
                    Cobrá una seña y reducí el
                  </p>
                  <p className="mt-2 text-ink-700 text-5xl md:text-6xl font-black leading-none">
                    <AnimatedPercent target={82} />
                  </p>
                  <p className="mt-3 text-ink-700 text-lg md:text-[1.65rem] leading-tight">
                    de las inasistencias a turnos
                  </p>
                </div>
              </div>
            </RevealOnScroll>

            <RevealOnScroll delay={220}>
              <div className="mt-2 rounded-[26px] border border-ink-100/45 bg-ink-50 py-3 px-3 md:py-4 md:px-4 overflow-hidden">
                <div className="payment-carousel-track">
                  {[
                    { label: 'Transferencia bancaria', icon: <Landmark size={20} /> },
                    { label: 'AstroPay', icon: <CreditCard size={20} /> },
                    { label: 'Mercado Pago', icon: <QrCode size={20} /> },
                    { label: 'Visa / Mastercard', icon: <CreditCard size={20} /> },
                    { label: 'Naranja X', icon: <CreditCard size={20} /> },
                    { label: 'QR interoperable', icon: <QrCode size={20} /> }
                  ]
                    .concat([
                      { label: 'Transferencia bancaria', icon: <Landmark size={20} /> },
                      { label: 'AstroPay', icon: <CreditCard size={20} /> },
                      { label: 'Mercado Pago', icon: <QrCode size={20} /> },
                      { label: 'Visa / Mastercard', icon: <CreditCard size={20} /> },
                      { label: 'Naranja X', icon: <CreditCard size={20} /> },
                      { label: 'QR interoperable', icon: <QrCode size={20} /> }
                    ])
                    .map((method, index) => (
                      <div key={`${method.label}-${index}`} className="payment-card">
                        <span className="payment-icon">{method.icon}</span>
                        <span>{method.label}</span>
                      </div>
                    ))}
                </div>
              </div>
            </RevealOnScroll>
          </section>

          <section id="resultados" ref={resultsRef} className="mx-auto w-[min(1120px,calc(100%-2rem))] py-8 md:py-12">
            <RevealOnScroll>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                  <span className="p-legacy-pill p-legacy-pill-on-dark text-xs md:text-sm">
                    <MapPin size={14} className="text-lima-300" />
                    Resultados
                  </span>
                  <h2 className="mt-3 text-2xl md:text-3xl font-black text-ink-50 tracking-tight">
                    {lastSearchLabel ? `Resultados cerca de ${lastSearchLabel}` : 'Clubes disponibles'}
                  </h2>
                </div>
                {user?.id && favoriteClubs.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {favoriteClubs.slice(0, 3).map((club) => (
                      <Link key={`favorite-chip-${club.id}`} href={`/club/${club.slug}`} className="p-legacy-pill p-legacy-pill-accent text-xs">
                        <Heart size={11} className="fill-lima-300 text-lima-300" />
                        {club.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </RevealOnScroll>

            {favoriteFeedback && (
              <RevealOnScroll delay={40}>
                <div className="mb-5 rounded-xl border border-white/15 bg-p-surface/10 px-4 py-3 text-sm font-semibold text-ink-50/90">
                  {favoriteFeedback}
                </div>
              </RevealOnScroll>
            )}

            {searchError && (
              <RevealOnScroll delay={60}>
                <div className="mb-5 rounded-xl border border-p-border bg-p-error-bg px-4 py-3 text-sm font-semibold text-p-error">{searchError}</div>
              </RevealOnScroll>
            )}

            {loadingClubs ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-72 rounded-3xl border border-white/15 bg-p-surface/10 animate-pulse" />
                ))}
              </div>
            ) : isSearching ? (
              <RevealOnScroll>
                <div className="py-16 rounded-3xl border border-white/20 bg-p-surface/10 text-center flex flex-col items-center gap-3">
                  <div className="h-10 w-10 rounded-full border-4 border-white/20 border-t-lima-300 animate-spin" />
                  <p className="font-semibold text-ink-50/85">Buscando canchas...</p>
                </div>
              </RevealOnScroll>
            ) : displayedClubs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {displayedClubs.map((club, index) => (
                  <RevealOnScroll key={club.id} delay={index * 80} className="h-full block">
                    <Link
                      href={`/club/${club.slug}`}
                      className="group card-gradient-edge mouse-flyer interactive-tilt h-full flex flex-col rounded-3xl border border-white/20 bg-p-surface/95 overflow-hidden shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all hover-lift"
                      onMouseMove={handleInteractiveMove}
                      onMouseLeave={handleInteractiveLeave}
                    >
                      <div className="relative h-44">
                        <button
                          type="button"
                          onClick={(event) => handleToggleFavorite(event, club)}
                          disabled={Boolean(favoriteBusyByClub[Number(club.id)])}
                          className={`absolute top-3 right-3 z-20 rounded-xl p-2 border transition-all ${
                            favoriteClubIds.has(Number(club.id))
                              ? 'bg-ink-900 border-lima-300 text-lima-300'
                              : 'bg-p-surface/90 border-ink-900/20 text-ink-900/70 hover:bg-ink-900 hover:text-lima-300'
                          }`}
                        >
                          <Heart size={16} className={favoriteClubIds.has(Number(club.id)) ? 'fill-lima-300' : ''} />
                        </button>

                        {club.clubImageUrl ? (
                          <>
                            <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105" style={{ backgroundImage: `url(${club.clubImageUrl})` }} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                            {club.logoUrl && (
                              <div className="absolute top-3 left-3 h-10 w-10 rounded-xl bg-p-surface/85 backdrop-blur flex items-center justify-center p-1">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={club.logoUrl} alt={club.name} className="max-h-full max-w-full object-contain" />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-ink-900 to-lima-800 flex items-center justify-center">
                            {club.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={club.logoUrl} alt={club.name} className="h-20 w-20 object-contain opacity-95" />
                            ) : (
                              <Activity size={36} className="text-ink-50/35" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="p-5 text-ink-900 flex-1 flex flex-col">
                        <h3 className="text-xl font-black leading-tight">{club.name}</h3>
                        <p className="text-sm text-ink-900/65 mt-1">{formatClubAddress(club) || 'Ubicación no disponible'}</p>

                        {searchDate && (availableTimesByClub[club.id]?.length ?? 0) > 0 ? (
                          <div className="mt-4 mb-5">
                            <div className="flex items-center gap-2 overflow-x-auto pb-2 club-times-scrollbar">
                              {availableTimesByClub[club.id].map((time) => (
                                <Link
                                  key={`${club.id}-${time}`}
                                  href={{ pathname: `/club/${club.slug}`, query: { date: searchDate, time, sport: searchSport } }}
                                  className="shrink-0 rounded-full border border-ink-900/25 bg-ink-50 px-3 py-1 text-xs font-black hover:border-lima-700 hover:text-lima-700 transition-colors"
                                >
                                  {time}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 mb-5 text-xs text-ink-900/40">
                            {searchDate ? 'Sin horarios visibles para este filtro.' : 'Elegí una fecha para ver horarios.'}
                          </div>
                        )}

                        <div className="mt-auto border-neon border-neon-subtle border-neon-slow rounded-xl bg-ink-900 text-ink-50 text-center py-3 text-xs font-black uppercase tracking-[0.2em] group-hover:bg-lima-700 transition-colors">
                          Reservar
                        </div>
                      </div>
                    </Link>
                  </RevealOnScroll>
                ))}
              </div>
            ) : (
              <RevealOnScroll>
                <div className="rounded-3xl border border-white/15 bg-p-surface/10 px-6 py-14 text-center">
                  <p className="text-ink-50/80">No encontramos canchas con ese criterio.</p>
                  <button
                    onClick={() => {
                      setSearchCity('');
                      setSelectedLocation(null);
                      setSearchError(null);
                      setLastSearchLabel('');
                      setAvailableTimesByClub({});
                      setDisplayedClubs(clubs);
                    }}
                    className="mt-4 text-lima-300 font-bold hover:underline"
                  >
                    Ver todos
                  </button>
                </div>
              </RevealOnScroll>
            )}
          </section>

          <section id="como-funciona" className="mx-auto w-[min(1120px,calc(100%-2rem))] py-16">
            <RevealOnScroll>
              <div className="text-center mb-10">
                <span className="p-legacy-pill p-legacy-pill-on-dark text-xs md:text-sm">
                  <PlayCircle size={14} className="text-lima-300" />
                  Flujo rápido
                </span>
                <h2 className="mt-4 text-3xl md:text-4xl font-black text-ink-50">Cómo reservás en 3 pasos</h2>
                <p className="mt-3 text-ink-50/75 text-base md:text-lg">Un recorrido simple para pasar de búsqueda a reserva confirmada.</p>
              </div>
            </RevealOnScroll>

            <div className="grid md:grid-cols-3 gap-5">
              <RevealOnScroll delay={80}>
                <div
                  className="rounded-3xl border border-white/15 bg-p-surface/10 p-6 backdrop-blur-sm h-full hover-lift float-slow mouse-flyer interactive-tilt"
                  onMouseMove={handleInteractiveMove}
                  onMouseLeave={handleInteractiveLeave}
                >
                  <div className="h-12 w-12 rounded-xl bg-lima-300 text-ink-900 flex items-center justify-center mb-4 icon-pop"><Search size={24} /></div>
                  <h3 className="text-xl font-black text-ink-50">Buscá tu zona</h3>
                  <p className="mt-2 text-ink-50/75">Filtrá por ubicación, deporte y fecha para quedarte sólo con opciones útiles.</p>
                </div>
              </RevealOnScroll>
              <RevealOnScroll delay={160}>
                <div
                  className="rounded-3xl border border-white/15 bg-p-surface/10 p-6 backdrop-blur-sm h-full hover-lift float-medium mouse-flyer interactive-tilt"
                  onMouseMove={handleInteractiveMove}
                  onMouseLeave={handleInteractiveLeave}
                >
                  <div className="h-12 w-12 rounded-xl bg-lima-200 text-ink-900 flex items-center justify-center mb-4 icon-pop"><CalendarCheck size={24} /></div>
                  <h3 className="text-xl font-black text-ink-50">Elegí horario</h3>
                  <p className="mt-2 text-ink-50/75">Entrá al club, compará disponibilidad y resolvé la reserva sin fricción.</p>
                </div>
              </RevealOnScroll>
              <RevealOnScroll delay={240}>
                <div
                  className="rounded-3xl border border-white/15 bg-p-surface/10 p-6 backdrop-blur-sm h-full hover-lift float-medium float-delay mouse-flyer interactive-tilt"
                  onMouseMove={handleInteractiveMove}
                  onMouseLeave={handleInteractiveLeave}
                >
                  <div className="h-12 w-12 rounded-xl bg-lima-100 text-ink-900 flex items-center justify-center mb-4 icon-pop"><PlayCircle size={24} /></div>
                  <h3 className="text-xl font-black text-ink-50">Salí a jugar</h3>
                  <p className="mt-2 text-ink-50/75">Todo listo: confirmación clara, datos del club y experiencia más prolija.</p>
                </div>
              </RevealOnScroll>
            </div>
          </section>

          <section id="precios" className="mx-auto w-[min(1120px,calc(100%-2rem))] pb-16">
            <RevealOnScroll>
              <div className="text-center mb-6">
                <span className="p-legacy-pill p-legacy-pill-on-dark text-xs md:text-sm">
                  <Calculator size={14} className="text-lima-300" />
                  Precios
                </span>
              </div>
              <div className="rounded-[34px] border border-ink-100 bg-p-surface-2 p-6 md:p-10 shadow-p-lg">
                <div className="grid lg:grid-cols-[0.9fr_1fr_1fr] gap-5 md:gap-6 items-stretch">
                  <div className="p-2 md:p-4">
                    <h3 className="mt-1 text-3xl md:text-4xl leading-[0.98] font-black tracking-tight text-ink-900">
                      Planes
                    </h3>
                    <p className="mt-4 text-base md:text-lg leading-relaxed text-ink-500 max-w-[340px]">
                      Elegí el plan que mejor se ajuste a tu club. Pausalo o cancelalo cuando quieras.
                    </p>
                  </div>

                  <div
                    className="rounded-[34px] border border-ink-100 bg-p-surface p-6 md:p-7 hover-lift mouse-flyer interactive-tilt"
                    onMouseMove={handleInteractiveMove}
                    onMouseLeave={handleInteractiveLeave}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-2xl md:text-[2rem] font-black text-ink-900 leading-none">Gratuito</h4>
                        <p className="mt-2 text-ink-400 text-base md:text-lg">De por vida</p>
                      </div>
                      <span className="p-legacy-pill p-legacy-pill-soft text-sm font-bold">Más elegido</span>
                    </div>

                    <div className="mt-7 flex items-end gap-2">
                      <span className="text-4xl md:text-5xl font-black leading-none text-ink-900">$0</span>
                      <span className="text-xl text-ink-400 pb-1">/mes</span>
                    </div>

                    <div className="mt-6 border-t border-ink-100 pt-5 space-y-3 text-ink-500 text-base md:text-lg">
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Hasta 2 canchas.</div>
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Hasta 100 reservas /mes.</div>
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Todas las integraciones.</div>
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Soporte por correo.</div>
                    </div>
                  </div>

                  <div
                    className="rounded-[34px] border border-ink-100 bg-p-surface p-6 md:p-7 hover-lift mouse-flyer interactive-tilt"
                    onMouseMove={handleInteractiveMove}
                    onMouseLeave={handleInteractiveLeave}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-2xl md:text-[2rem] font-black text-ink-900 leading-none">Avance</h4>
                        <p className="mt-2 text-ink-400 text-base md:text-lg">Para crecer</p>
                      </div>
                      <span className="p-legacy-pill p-legacy-pill-soft text-sm font-bold">Mejor opción</span>
                    </div>

                    <div className="mt-7 flex items-end gap-2">
                      <span className="text-4xl md:text-5xl font-black leading-none text-ink-900">$89.900</span>
                      <span className="text-xl text-ink-400 pb-1">/mes</span>
                    </div>

                    <div className="mt-6 border-t border-ink-100 pt-5 space-y-3 text-ink-500 text-base md:text-lg">
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Agendas y reservas ilimitadas.</div>
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Caja y stock integrados.</div>
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Recordatorios automáticos por WhatsApp.</div>
                      <div className="flex items-start gap-3"><Check size={18} className="mt-1 text-ink-700 shrink-0" /> Soporte preferencial y onboarding.</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowContact(true)}
                      className="mt-8 w-full btn-aurora border-neon border-neon-fast inline-flex items-center justify-center gap-2 rounded-2xl bg-ink-900 text-ink-50 px-6 py-4 text-base font-black hover:translate-y-[-1px] transition-transform"
                    >
                      <span>Pedir cotización</span> <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </RevealOnScroll>
          </section>

          <section id="faqs" onClick={() => setOpenFaqIndex(null)} className="mx-auto w-[min(900px,calc(100%-2rem))] pb-24">
            <RevealOnScroll>
              <div className="text-center mb-8">
                <span className="p-legacy-pill p-legacy-pill-on-dark text-xs md:text-sm">
                  <MessageSquare size={14} className="text-lima-300" />
                  FAQs
                </span>
                <h2 className="mt-4 text-3xl md:text-4xl font-black text-ink-50">Preguntas frecuentes</h2>
                <p className="mt-3 text-ink-50/75 text-base md:text-lg">Respuestas rápidas sobre reservas, gestión y uso de la plataforma.</p>
              </div>
            </RevealOnScroll>
            <div className="space-y-3">
              {[
                { q: '¿Con cuánto tiempo de anticipación puedo reservar?', a: 'Podés reservar un turno hasta con 30 días de anticipación desde el calendario.' },
                { q: '¿Puedo cancelar o reprogramar mi turno?', a: 'Sí, podés hacerlo desde tu panel según la política del club.' },
                { q: '¿Cómo recibo avisos de reservas?', a: 'Las notificaciones llegan por WhatsApp y quedan reflejadas en el sistema.' },
                { q: '¿Puedo gestionar varias canchas y deportes?', a: 'Sí, la plataforma permite múltiples canchas, horarios y precios por actividad.' },
                { q: '¿Necesito instalar algo?', a: 'No, funciona en la nube y podés usarlo desde celular, tablet o computadora.' }
              ].map((item, idx) => (
                <RevealOnScroll delay={idx * 70} key={item.q}>
                  <div ref={(el) => { faqRefs.current[idx] = el; }}>
                    <FAQItem
                      question={item.q}
                      answer={item.a}
                      isOpen={openFaqIndex === idx}
                      onToggle={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                    />
                  </div>
                </RevealOnScroll>
              ))}
            </div>
          </section>
        </main>

        <footer className="border-t border-white/10 py-8 text-center text-ink-50/55 text-sm">
          <div className="flex flex-col items-center justify-center gap-3">
            <PiqueLogo variant="horizontalDark" className="h-9 w-auto opacity-80" />
            <p className="font-medium">&copy; {new Date().getFullYear()} Todos los derechos reservados.</p>
            <div className="flex flex-wrap items-center justify-center gap-4 text-ink-50/70">
              <Link href="/legal/privacy" className="hover:text-ink-50 transition-colors">Privacidad</Link>
              <Link href="/legal/terms" className="hover:text-ink-50 transition-colors">Términos</Link>
            </div>
          </div>
        </footer>

        <div
          className={`fixed inset-0 bg-black/55 z-[60] transition-opacity duration-300 ${showContact ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setShowContact(false)}
        />

        <div ref={sidebarRef} className={`fixed top-0 right-0 h-full w-full max-w-sm bg-ink-50 z-[70] shadow-2xl transform transition-transform duration-300 ease-out overflow-hidden ${showContact ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="pointer-events-none absolute -top-14 -right-12 h-56 w-56 rounded-full bg-lima-300/25 blur-3xl" />
          <div className="pointer-events-none absolute top-40 -left-20 h-52 w-52 rounded-full bg-lima-200/20 blur-3xl" />

          <div className="relative p-6 flex justify-between items-center border-b border-ink-700/10 bg-p-surface/55 backdrop-blur-md">
            <div>
              <span className="p-legacy-pill p-legacy-pill-soft text-[11px]">
                <MessageSquare size={12} />
                Soporte Pique
              </span>
              <h2 className="mt-3 text-2xl font-black text-ink-700 leading-none">Contacto</h2>
            </div>
            <button
              onClick={() => setShowContact(false)}
              className="h-10 w-10 rounded-full bg-ink-700/10 text-ink-700 hover:bg-ink-700 hover:text-ink-50 transition-colors flex items-center justify-center"
              title="Cerrar ventana"
            >
              <X size={18} strokeWidth={3} />
            </button>
          </div>

          <div className="relative p-6 md:p-7 flex flex-col gap-4">
            <p className="text-ink-700/80 font-medium leading-relaxed">
              ¿Tenés dudas o querés activar tu club? Escribinos y coordinamos una demo con setup inicial.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-ink-700/10 bg-p-surface/80 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ink-700/55 font-bold">Tiempo de respuesta</p>
                <p className="mt-1 text-sm font-black text-ink-700">Menos de 24h</p>
              </div>
              <div className="rounded-xl border border-ink-700/10 bg-p-surface/80 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-ink-700/55 font-bold">Atención</p>
                <p className="mt-1 text-sm font-black text-ink-700">Lun a Sáb</p>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => openContactMenu(e, 'whatsapp')}
              className="group flex items-center gap-4 px-4 py-3.5 bg-p-surface rounded-2xl shadow-sm border border-ink-700/10 hover:border-lima-700 hover:-translate-y-[1px] transition-all"
            >
              <div className="bg-lima-300 h-11 w-11 rounded-full flex items-center justify-center text-ink-900 shrink-0">
                <Phone size={19} />
              </div>
              <div className="text-left">
                <p className="text-ink-700/55 text-xs font-bold uppercase tracking-[0.16em]">WhatsApp</p>
                <p className="text-ink-700 font-bold">+54 351 343 6163</p>
              </div>
              <ChevronRight size={16} className="ml-auto text-ink-700/35 group-hover:text-ink-700 transition-colors" />
            </button>

            <button
              type="button"
              onClick={(e) => openContactMenu(e, 'email')}
              className="group w-full flex items-center gap-4 px-4 py-3.5 bg-p-surface rounded-2xl shadow-sm border border-ink-700/10 hover:border-lima-700 hover:-translate-y-[1px] transition-all"
            >
              <div className="bg-ink-700 h-11 w-11 rounded-full flex items-center justify-center text-ink-50 shrink-0">
                <Mail size={18} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-ink-700/55 text-xs font-bold uppercase tracking-[0.16em]">Email</p>
                <p className="text-ink-700 font-bold truncate">soporte.pique@gmail.com</p>
              </div>
              <ChevronRight size={16} className="text-ink-700/35 group-hover:text-ink-700 transition-colors" />
            </button>

            <button
              type="button"
              onClick={(e) => openContactMenu(e, 'instagram')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-ink-700 text-ink-50 rounded-2xl hover:bg-lima-700 transition-colors font-bold"
            >
              <Instagram size={18} />
              <span>@pique.app_</span>
            </button>
          </div>
          {contactMenu && (
            <div
              ref={menuRef}
              role="dialog"
              aria-label="Acciones de contacto"
              style={{ position: 'absolute', top: contactMenu.top, left: contactMenu.left }}
              className="z-[90] bg-p-surface rounded-xl shadow-lg border border-ink-700/10 p-2 w-52"
            >
              <button onClick={() => handleOpenHref(contactMenu.href)} className="w-full text-left px-3 py-2.5 hover:bg-ink-50 rounded text-sm text-ink-700 font-medium">Abrir</button>
              <button onClick={() => handleCopy(contactMenu.copyText)} className="w-full text-left px-3 py-2.5 hover:bg-ink-50 rounded text-sm text-ink-700 font-medium">
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleBackToTop}
          aria-label="Volver arriba"
          className={`fixed bottom-7 right-6 z-[80] h-14 w-14 rounded-full bg-p-surface/92 backdrop-blur-md shadow-xl shadow-ink-900/35 border border-white/80 text-ink-700 transition-all duration-300 ${
            showBackToTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full">
            <circle cx="32" cy="32" r="21.5" fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle
              cx="32"
              cy="32"
              r="21.5"
              fill="none"
              stroke="var(--accent-fg)"
              strokeWidth="3.3"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${scrollProgress} 100`}
              className="backtotop-progress"
            />
          </svg>
          <span className="relative z-10 inline-flex items-center justify-center">
            <ArrowUp size={24} strokeWidth={2.8} />
          </span>
        </button>
      </div>
    </>
  );
}

const FeatureItem = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <li className="flex items-center gap-3">
    <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-p-surface text-ink-900 shadow-sm shrink-0">
      {icon}
    </div>
    <span className="text-ink-50/95 font-bold text-lg tracking-tight">{text}</span>
  </li>
);

const AnimatedPercent = ({ target }: { target: number }) => {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || started) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const duration = 1400;
    const startTs = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - startTs) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, target]);

  return <span ref={ref}>{value}%</span>;
};

// FAQ item now controlled by parent via props
const FAQItem = ({
  question,
  answer,
  isOpen,
  onToggle
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  return (
    <div className="rounded-2xl overflow-hidden border border-white/15 bg-p-surface/10 backdrop-blur-sm transition-all duration-300 hover:bg-p-surface/15">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="w-full px-6 py-5 text-left flex justify-between items-center focus:outline-none"
      >
        <span className="font-bold text-ink-50 pr-4">{question}</span>
        <ChevronDown className={`text-lima-300 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <div className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-48 pb-5 opacity-100' : 'max-h-0 opacity-0'}`}>
        <p className="text-ink-50/75 text-sm leading-relaxed">{answer}</p>
      </div>
    </div>
  );
};
