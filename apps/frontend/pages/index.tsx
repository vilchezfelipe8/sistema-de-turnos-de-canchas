import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
import { getApiUrl } from '../utils/apiUrl';
import { LocationService, Location } from '../services/LocationService';
import DatePickerDark from '../components/ui/DatePickerDark';
import { Search, MapPin, Calendar, TrendingUp, ShieldCheck, ArrowRight, Menu, X, Phone, Mail, Instagram, Activity, ChevronRight, MousePointerClick, CalendarCheck, PlayCircle, Coffee, Droplets, Lightbulb, Trophy, ChevronDown, LogOut, Check } from 'lucide-react';
import Link from 'next/link';
import { logout } from '../services/AuthService';
import { getMyBookings } from '../services/BookingService';

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
const ACTIVITY_IDS_BY_SPORT: Record<string, number> = {
  padel: 1,
  tenis: 2,
  futbol: 3
};

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

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
  const resultsRef = useRef<HTMLElement>(null);
  const apiUrl = useMemo(() => getApiUrl(), []);

  // Estados del Buscador
  const [searchCity, setSearchCity] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false); 
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [displayedClubs, setDisplayedClubs] = useState<Club[]>([]);
  const [clubCoords, setClubCoords] = useState<Record<number, { lat: number; lon: number } | null>>({});

  const [searchSport, setSearchSport] = useState('padel');
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [searchDate, setSearchDate] = useState('');
  const [lastSearchLabel, setLastSearchLabel] = useState<string>('');
  const [availableTimesByClub, setAvailableTimesByClub] = useState<Record<number, string[]>>({});

  const userInitials = useMemo(() => {
    if (!user) return 'TU';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.trim();
    return initials || 'TU';
  }, [user]);
  const isAdmin = user?.role === 'ADMIN';

  const sportOptions = useMemo(() => ([
    {
      value: 'padel',
      label: 'Pádel',
      icon: (
        <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
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
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7l3 2-1 4h-4l-1-4 3-2z" />
          <path d="M7 9l-3 2 2 4" />
          <path d="M17 9l3 2-2 4" />
        </svg>
      )
    },
    {
      value: 'tenis',
      label: 'Tenis',
      icon: (
        <svg viewBox="0 0 69.447 69.447" className="h-4 w-4" aria-hidden="true">
          <g transform="translate(-1271.769 -1574.648)">
            <path
              d="M1341.208,1609.372a34.719,34.719,0,1,1-34.72-34.724A34.724,34.724,0,0,1,1341.208,1609.372Z"
              fill="currentColor"
            />
            <path
              d="M1311.144,1574.993a35.139,35.139,0,0,0-4.61-.344,41.069,41.069,0,0,1-34.369,29.735,34.3,34.3,0,0,0-.381,4.635l.183-.026a45.921,45.921,0,0,0,39.149-33.881Zm29.721,34.692a45.487,45.487,0,0,0-33.488,34.054l-.071.313a34.54,34.54,0,0,0,4.818-.455,41.218,41.218,0,0,1,28.686-29.194,36.059,36.059,0,0,0,.388-4.8Z"
              fill="currentColor"
              opacity="0.55"
            />
          </g>
        </svg>
      )
    }
  ]), []);

  const selectedSport = sportOptions.find((sport) => sport.value === searchSport) || sportOptions[0];

  useEffect(() => {
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (userStr) { try { setUser(JSON.parse(userStr)); } catch {} }

    const loadClubs = async () => {
      try {
        const allClubs = await ClubService.getAllClubs();
        setClubs(allClubs);
      } catch (error) {
        console.error('Error al cargar clubes:', error);
      } finally {
        setLoadingClubs(false);
      }
    };
    const loadLocations = async () => {
      try {
        const allLocations = await LocationService.getAllLocations();
        setLocations(allLocations);
      } catch (error) {
        console.error('Error al cargar ubicaciones:', error);
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
        const active = Array.isArray(bookings)
          ? bookings.filter((booking: any) => !['CANCELLED', 'COMPLETED'].includes(booking.status)).length
          : 0;
        setActiveBookingsCount(active);
      } catch (error) {
        console.error('Error al cargar reservas activas:', error);
      }
    };

    loadActiveBookings();
  }, [user]);

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

  const handleSearch = async () => {
    setShowCityDropdown(false);
    setSearchError(null);

    if (locationOptions.length === 0 && searchCity.trim()) {
      setSearchError('No hay ubicaciones cargadas para validar la búsqueda.');
      setLastSearchLabel('');
      setDisplayedClubs([]);
      if (resultsRef.current) {
        resultsRef.current.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    let location = selectedLocation;
    if (!location && searchCity.trim()) {
      const normalized = normalizeText(searchCity);
      const exact = locationOptions.find(
        (option) => normalizeText(option.label) === normalized || normalizeText(option.query) === normalized
      );
      if (exact) {
        location = exact;
        setSelectedLocation(exact);
        setSearchCity(exact.label);
      }
    }

    if (!location) {
      setDisplayedClubs(clubs);
      if (searchCity.trim()) {
        setSearchError('Seleccioná una ubicación del listado para buscar clubes cercanos.');
      }
      setLastSearchLabel('');
      if (resultsRef.current) {
        resultsRef.current.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    const coordsResults = await fetchLocations(location.query, 1);
    const locationCoords = coordsResults[0];
    if (!locationCoords) {
      setSearchError('No pudimos ubicar esa ciudad. Probá con otra.');
      setDisplayedClubs([]);
      setLastSearchLabel('');
      if (resultsRef.current) {
        resultsRef.current.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    const filtered: { club: Club; distance: number }[] = [];
    for (const club of clubs) {
      const coords = await resolveClubCoords(club);
      if (!coords) continue;
      const distance = calculateDistanceKm({ lat: locationCoords.lat, lon: locationCoords.lon }, coords);
      if (distance <= DEFAULT_RADIUS_KM) {
        filtered.push({ club, distance });
      }
    }

    filtered.sort((a, b) => a.distance - b.distance);
    let finalClubs = filtered.map(item => item.club);

    if (searchDate) {
      const activityIds = searchSport
        ? [ACTIVITY_IDS_BY_SPORT[searchSport]].filter(Boolean)
        : Object.values(ACTIVITY_IDS_BY_SPORT);

      if (activityIds.length > 0) {
        const availabilityChecks = await Promise.all(
          finalClubs.map(async (club) => {
            try {
              let hasSlots = false;
              const times: string[] = [];
              for (const activityId of activityIds) {
                const res = await fetch(
                  `${apiUrl}/api/bookings/availability-with-courts?activityId=${activityId}&date=${searchDate}&clubSlug=${encodeURIComponent(club.slug)}&t=${Date.now()}`,
                  { cache: 'no-store' }
                );
                if (!res.ok) continue;
                const data = await res.json();
                const slots = Array.isArray(data?.slotsWithCourts)
                  ? data.slotsWithCourts.filter((slot: any) => Array.isArray(slot.availableCourts) && slot.availableCourts.length > 0)
                  : [];
                if (slots.length > 0) {
                  hasSlots = true;
                  slots.forEach((slot: any) => {
                    if (slot?.slotTime) times.push(String(slot.slotTime));
                  });
                }
              }
              if (!hasSlots) return { hasSlots: false, times: [] };
              const uniqueTimes = Array.from(new Set(times)).sort();
              return { hasSlots: true, times: uniqueTimes };
            } catch (error) {
              console.error('Error al validar disponibilidad:', error);
            }
            return { hasSlots: false, times: [] };
          })
        );

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

    setDisplayedClubs(finalClubs);
    setLastSearchLabel(location.label);

    if (resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
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

  return (
    <div className="min-h-screen relative overflow-x-hidden bg-[#347048] text-[#D4C5B0] selection:bg-[#B9CF32] selection:text-[#347048]" onClick={() => {
      setShowCityDropdown(false);
      setShowSportDropdown(false);
      setShowUserMenu(false);
    }}>
      
      {/* NAVBAR */}
      <nav className="absolute top-0 left-0 right-0 z-50 px-6 py-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-tighter text-[#D4C5B0] italic opacity-90 hover:opacity-100 transition-opacity cursor-pointer">
                TuCancha
            </span>
        </div>
        <div className="flex items-center gap-4 relative">
            {user ? (
              <>
                {!isAdmin && (
                  <div className="hidden sm:flex items-center gap-1 p-1 rounded-full bg-[#EBE1D8]/10">
                    <Link
                      href="/bookings"
                      className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest transition-all border-2 bg-[#EBE1D8] text-[#347048] border-[#EBE1D8]"
                      onClick={() => setShowUserMenu(false)}
                    >
                      <Calendar size={16} strokeWidth={2.5} />
                      Mis Turnos
                    </Link>
                  </div>
                )}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowUserMenu((prev) => !prev);
                    }}
                    className="hidden md:flex items-center gap-3 pl-1 pr-4 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 transition-all shadow-sm"
                  >
                    <div className="relative">
                      <div className="h-9 w-9 rounded-full bg-[#B9CF32] flex items-center justify-center text-[#347048] text-xs font-black shadow-inner">
                        {userInitials}
                      </div>
                      {activeBookingsCount > 0 && (
                        <span className="absolute -right-1 -top-1 bg-[#926699] text-white text-[9px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center shadow-md border-2 border-[#347048]">
                          {activeBookingsCount}
                        </span>
                      )}
                    </div>
                    <span className="text-[#D4C5B0] font-bold text-sm">{user.firstName || user.name || 'Usuario'}</span>
                  </button>

                  {showUserMenu && (
                    <div className="absolute right-0 mt-4 w-[280px] md:w-[320px] bg-[#EBE1D8] rounded-3xl shadow-2xl shadow-[#347048]/50 border border-[#347048]/10 overflow-hidden z-[120]" onClick={(e) => e.stopPropagation()}>
                      <div className="p-6 flex flex-col items-center text-center">
                        <div className="relative mb-4">
                          <div className="h-20 w-20 rounded-full bg-[#347048] flex items-center justify-center text-[#EBE1D8] text-xl font-black shadow-inner">
                            {userInitials}
                          </div>
                          <span className="absolute -right-1 -bottom-1 bg-[#B9CF32] text-[#347048] text-xs font-black rounded-full h-7 w-7 flex items-center justify-center border-4 border-[#EBE1D8]">
                            <Check size={14} strokeWidth={4} />
                          </span>
                        </div>
                        <h3 className="text-xl font-black text-[#347048] italic tracking-tight">{user.firstName || user.name || 'Usuario'}</h3>
                        <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest mt-1">Miembro</p>
                      </div>
                      <div className="border-t border-[#347048]/10 px-6 py-5 bg-[#347048]/5">
                        <p className="text-[#347048]/40 font-black text-[10px] uppercase tracking-widest mb-3">Mis Datos</p>
                        <div className="space-y-3 text-[#347048] text-sm font-bold">
                          <div className="flex items-center gap-3">
                            <Phone size={16} className="text-[#B9CF32]" strokeWidth={2.5} />
                            <span>{user.phoneNumber || user.phone || 'Sin teléfono'}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Mail size={16} className="text-[#B9CF32]" strokeWidth={2.5} />
                            <span className="truncate">{user.email || 'Sin email'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-[#347048]/10 px-6 py-4 space-y-2 font-bold">
                        <Link
                          href="/bookings"
                          className="flex items-center gap-3 text-[#347048] hover:text-[#B9CF32] p-2 rounded-xl hover:bg-[#347048]/5 transition-colors"
                          onClick={() => setShowUserMenu(false)}
                        >
                          <Calendar size={18} strokeWidth={2.5} /> Mis Reservas
                        </Link>
                        <button
                          type="button"
                          className="flex items-center gap-3 text-red-500 hover:text-red-600 w-full text-left p-2 rounded-xl hover:bg-red-50 transition-colors"
                          onClick={() => {
                            logout();
                            setUser(null);
                            setShowUserMenu(false);
                            router.push('/');
                          }}
                        >
                          <LogOut size={18} strokeWidth={2.5} /> Cerrar sesión
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button onClick={() => setShowContact(true)} className="hidden md:flex items-center gap-2 px-5 py-2 rounded-full border border-[#D4C5B0]/30 text-[#D4C5B0] font-bold text-sm hover:bg-[#D4C5B0] hover:text-[#347048] transition-all">
                  <span>Contacto</span>
              </button>
            )}
            {!user && (
                <Link href="/login" className="px-5 py-2 rounded-full bg-[#D4C5B0] text-[#347048] font-bold hover:bg-[#B9CF32] transition-all text-sm shadow-lg shadow-[#347048]/50">
                    Ingresar
                </Link>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (user) {
                  setShowUserMenu((prev) => !prev);
                } else {
                  setShowContact(true);
                }
              }}
              className="md:hidden text-[#D4C5B0]"
            >
              <Menu />
            </button>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative pt-32 pb-24 px-4 flex flex-col items-center text-center z-10 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#B9CF32]/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
        
        <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight text-[#D4C5B0]">
          Tu cancha, <span className="text-[#B9CF32]">al toque.</span>
        </h1>
        <p className="text-[#D4C5B0]/80 text-lg md:text-xl max-w-2xl mb-12 font-medium leading-relaxed">
          Explorá las canchas disponibles en tu ciudad y en tiempo real.
        </p>

        {/* BARRA DE BÚSQUEDA */}
    <div 
      className="w-full max-w-5xl bg-[#EBE1D8] rounded-[2rem] p-2 shadow-2xl shadow-[#347048]/50 flex flex-col md:flex-row items-center divide-y md:divide-y-0 md:divide-x divide-[#347048]/10 relative z-50"
            onClick={(e) => e.stopPropagation()} 
        >
      <div className="flex-1 md:flex-[1.4] w-full relative group">
                <div 
          className="p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors cursor-pointer h-full flex items-center gap-3 min-h-[56px]"
                    onClick={() => {
                        setShowSportDropdown(false);
                        // Al abrir el dropdown de ubicación cerramos el calendario si estaba abierto
                        closeDatepicker();
                        setShowCityDropdown(true);
                        document.getElementById('cityInput')?.focus();
                    }}
                >
                    <MapPin className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
          <div className="flex flex-col items-start text-left w-full overflow-hidden min-h-[38px] justify-center gap-1 flex-1">
                        <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider h-3 leading-3">Ubicación</label>
                        <input 
                            id="cityInput"
                            type="text" 
                            placeholder="¿Dónde jugás?" 
              className="bg-transparent border-none outline-none text-[#347048] font-bold placeholder-[#347048]/40 w-full p-0 leading-5 truncate h-full cursor-pointer"
                            value={searchCity}
                            onChange={(e) => {
                                setSearchCity(e.target.value);
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
                              // Si el usuario enfoca la caja de ubicación cerramos el calendario
                              closeDatepicker();
                              setShowCityDropdown(true);
                            }}
                            autoComplete="off"
                        />
                    </div>
                </div>

                {showCityDropdown && (
                    <div className="absolute top-full left-0 w-full md:w-[300px] mt-4 bg-white rounded-2xl shadow-xl border border-[#347048]/10 overflow-hidden z-[100] animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-3 bg-[#EBE1D8]/30 border-b border-[#347048]/5">
                            <span className="text-xs font-bold text-[#347048] uppercase tracking-wider">Lugares disponibles</span>
                        </div>
                        <ul className="max-h-60 overflow-y-auto">
              {loadingLocations ? (
                <li className="px-4 py-6 text-center text-gray-400 text-sm">Cargando ubicaciones...</li>
              ) : locationSuggestions.length > 0 ? (
                locationSuggestions.map((location, idx) => (
                                    <li 
                                        key={idx}
                                        onClick={() => selectCity(location)}
                                        className="px-4 py-3 hover:bg-[#B9CF32]/10 cursor-pointer flex items-center justify-between group transition-colors border-b border-gray-50 last:border-0"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="bg-[#EBE1D8] p-1.5 rounded-full text-[#347048]"><MapPin size={14} /></div>
                                            <div className="flex flex-col">
                                                <span className="text-[#347048] font-medium text-sm">{location.label}</span>
                                                <span className="text-xs text-[#347048]/60">{location.country}</span>
                                            </div>
                                        </div>
                                        <ChevronRight size={14} className="text-[#B9CF32] opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
                                    </li>
                                ))
                            ) : (
                                <li className="px-4 py-6 text-center text-gray-400 text-sm">No encontramos ubicaciones con ese texto.</li>
                            )}
                        </ul>
                    </div>
                )}
            </div>

  <div className="flex-1 md:flex-none md:w-[240px] w-full relative group">
        <div
          className="p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors cursor-pointer h-full flex items-center gap-3"
          onClick={(e) => {
            e.stopPropagation();
            setShowCityDropdown(false);
            // Al abrir/cerrar el dropdown de deporte, cerramos el calendario
            closeDatepicker();
            setShowSportDropdown((prev) => !prev);
          }}
        >
          <Activity className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
          <div className="flex flex-col items-start text-left w-full overflow-hidden min-h-[38px] justify-center gap-1">
            <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider h-3 leading-3">Deporte</label>
            <div className="flex items-center gap-2 text-[#347048] font-bold text-sm uppercase truncate leading-5">
              <span className="text-[#347048]">{selectedSport.icon}</span>
              <span className="truncate">{selectedSport.label}</span>
            </div>
          </div>
          <ChevronRight size={14} className="text-[#B9CF32] transition-transform group-hover:translate-x-0.5" />
        </div>

        {showSportDropdown && (
          <div className="absolute top-full left-0 w-full md:w-[240px] mt-4 bg-white rounded-2xl shadow-xl border border-[#347048]/10 overflow-hidden z-[100] animate-in fade-in zoom-in-95 duration-200">
            <div className="p-3 bg-[#EBE1D8]/30 border-b border-[#347048]/5">
              <span className="text-xs font-bold text-[#347048] uppercase tracking-wider">Elegí deporte</span>
            </div>
            <ul className="max-h-60 overflow-y-auto">
              {sportOptions.map((sport) => (
                <li
                  key={sport.value || 'all'}
                  onClick={() => {
                    setSearchSport(sport.value);
                    setShowSportDropdown(false);
                  }}
                  className="px-4 py-3 hover:bg-[#B9CF32]/10 cursor-pointer flex items-center justify-between group transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-[#EBE1D8] p-1.5 rounded-full text-[#347048]">{sport.icon}</div>
                    <span className="text-[#347048] font-medium text-sm">{sport.label}</span>
                  </div>
                  <ChevronRight size={14} className="text-[#B9CF32] opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

  <div className="flex-1 w-full relative group">
        <div
          className="p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors cursor-pointer h-full flex items-center gap-3"
          onClick={() => { setShowCityDropdown(false); setShowSportDropdown(false); }}
        >
          <Calendar className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
          <div className="flex flex-col items-start text-left w-full overflow-hidden min-h-[38px] justify-center gap-1">
            <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider h-3 leading-3">Fecha</label>
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
                if (!date) { setSearchDate(''); return; }
                setSearchDate(formatLocalDate(date));
              }}
              minDate={new Date()}
              showIcon={false}
              inputSize="compact"
              inputClassName="bg-transparent border-none outline-none text-[#347048] font-bold text-sm w-full p-0 leading-5 uppercase cursor-pointer placeholder-[#347048]/40 h-auto px-0 py-0 focus:ring-0 focus:border-transparent truncate"
              variant="light"
            />
          </div>
        </div>
      </div>

            <div className="p-2 w-full md:w-auto">
                <button 
                    onClick={handleSearch}
                    className="w-full md:w-auto bg-[#347048] hover:bg-[#B9CF32] hover:text-[#347048] text-[#EBE1D8] font-black py-4 px-8 rounded-full transition-all shadow-lg flex items-center justify-center gap-2 group"
                >
                    <Search size={20} strokeWidth={3} className="group-hover:scale-110 transition-transform"/>
                    <span className="md:hidden lg:inline">Buscar</span>
                </button>
            </div>
        </div>
      </section>

      {/* RESULTADOS (AHORA CON ANIMACIONES AL HACER SCROLL) */}
      <section ref={resultsRef} className="container mx-auto px-4 py-10 pb-20 max-w-6xl">
        <RevealOnScroll delay={0}>
          <h2 className="text-2xl font-bold mb-8 flex items-center gap-2 text-[#D4C5B0]/90">
            <MapPin className="text-[#B9CF32]" /> 
            {lastSearchLabel ? `Resultados cerca de ${lastSearchLabel}` : 'Clubes Disponibles'}
          </h2>
        </RevealOnScroll>

        {searchError && (
          <RevealOnScroll delay={100}><div className="mb-6 text-sm text-[#B9CF32] font-semibold">{searchError}</div></RevealOnScroll>
        )}

        {loadingClubs ? (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {[1,2,3].map(i => (
                <div key={i} className="h-64 bg-[#D4C5B0]/5 rounded-3xl animate-pulse border border-[#D4C5B0]/10"></div>
             ))}
           </div>
        ) : displayedClubs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayedClubs.map((club, index) => (
              <RevealOnScroll key={club.id} delay={index * 100} className="h-full block">
                <Link href={`/club/${club.slug}`} className="group relative h-full bg-[#EBE1D8] border border-transparent rounded-3xl overflow-hidden hover:scale-[1.02] transition-all shadow-xl hover:shadow-[#B9CF32]/20 flex flex-col">
                  <div className="h-40 shrink-0 w-full bg-[#dcd0c5] relative border-b border-[#347048]/10 rounded-t-3xl">
                    {club.clubImageUrl ? (
                      <>
                        <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 rounded-t-3xl" style={{ backgroundImage: `url(${club.clubImageUrl})` }} />
                        {club.logoUrl && (
                          <div className="absolute top-3 left-3 bg-white/80 backdrop-blur rounded-xl p-2 shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={club.logoUrl} alt={club.name} className="h-10 w-10 object-contain" />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#EBE1D8] to-[#d6c7ba] flex items-center justify-center transition-transform duration-700 rounded-t-3xl">
                          {club.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={club.logoUrl} alt={club.name} className="h-24 w-24 object-contain opacity-90 mix-blend-multiply" />
                          ) : (
                            <Activity size={32} className="text-[#347048]/20" strokeWidth={2} />
                          )}
                      </div>
                    )}
                    <div className="absolute bottom-3 right-3 bg-[#926699] px-3 py-1 rounded-full text-xs font-bold text-[#EBE1D8] shadow-sm flex items-center gap-1">
                      <MapPin size={12} className="text-[#EBE1D8]" /> {club.name || 'Club'}
                    </div>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <h3 className="text-xl font-black text-[#347048] mb-1 leading-tight">{club.name}</h3>
                    <p className="text-[#347048]/70 text-sm font-medium line-clamp-1">{formatClubAddress(club) || 'Ubicación no disponible'}</p>
                    {searchDate && (availableTimesByClub[club.id]?.length ?? 0) > 0 && (
                      <div className="mt-4 mb-5">
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-4 club-times-scrollbar">
                          {availableTimesByClub[club.id].map((time) => (
                            <Link
                              key={`${club.id}-${time}`}
                              href={{
                                pathname: `/club/${club.slug}`,
                                query: { date: searchDate, time, sport: searchSport }
                              }}
                              className="shrink-0 px-3 py-1.5 rounded-full border border-[#347048]/40 text-[#347048] font-black text-xs bg-white/80 hover:border-[#B9CF32] hover:text-[#B9CF32] transition-colors"
                            >
                              {time}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {searchDate && (availableTimesByClub[club.id]?.length ?? 0) === 0 && (
                      <div className="mb-5" />
                    )}
                    {!searchDate && <div className="mb-5" />}
                    <div className="w-full -mt-1 bg-[#347048] group-hover:bg-[#B9CF32] py-3 rounded-xl text-center transition-colors duration-300">
                      <span className="text-xs font-black text-[#D4C5B0] group-hover:text-[#347048] uppercase tracking-widest">Reservar</span>
                    </div>
                  </div>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
        ) : (
          <RevealOnScroll delay={100}>
            <div className="text-center py-20 bg-[#D4C5B0]/5 rounded-3xl border border-dashed border-[#D4C5B0]/20">
              <p className="text-[#D4C5B0]/60">No encontramos canchas con ese criterio.</p>
              <button onClick={() => setSearchCity('')} className="mt-4 text-[#B9CF32] font-bold hover:underline">Ver todos</button>
            </div>
          </RevealOnScroll>
        )}
      </section>

      {/* SECCIÓN: CÓMO FUNCIONA (CON ANIMACIONES) */}
      <section className="py-20 px-4 max-w-6xl mx-auto relative z-10 overflow-hidden">
        <RevealOnScroll delay={0}>
          <div className="text-center mb-16">
            <span className="text-[#B9CF32] font-black tracking-wider uppercase text-sm mb-3 block">Rápido y Fácil</span>
            <h2 className="text-4xl md:text-5xl font-black text-[#D4C5B0] italic tracking-tighter">¿CÓMO RESERVAR?</h2>
          </div>
        </RevealOnScroll>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <RevealOnScroll delay={100} className="h-full">
            <div className="h-full bg-[#EBE1D8] rounded-[2rem] p-8 text-center relative overflow-hidden group hover:-translate-y-2 transition-transform duration-300 shadow-xl shadow-[#B9CF32]/5 border-4 border-transparent hover:border-[#B9CF32]">
              <div className="absolute -top-6 -right-6 text-[100px] font-black text-[#347048]/5 group-hover:text-[#B9CF32]/20 transition-colors z-0 select-none">1</div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="bg-[#347048] text-[#B9CF32] h-16 w-16 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                  <Search size={32} strokeWidth={2.5} />
                </div>
                <h3 className="text-xl font-black text-[#347048] mb-3 uppercase tracking-wide">Buscá tu horario</h3>
                <p className="text-[#347048]/70 font-medium">Usá nuestro buscador para encontrar canchas disponibles en tu ciudad en tiempo real.</p>
              </div>
            </div>
          </RevealOnScroll>

          <RevealOnScroll delay={200} className="h-full">
            <div className="h-full bg-[#EBE1D8] rounded-[2rem] p-8 text-center relative overflow-hidden group hover:-translate-y-2 transition-transform duration-300 shadow-xl shadow-[#B9CF32]/5 border-4 border-transparent hover:border-[#B9CF32]">
              <div className="absolute -top-6 -right-6 text-[100px] font-black text-[#347048]/5 group-hover:text-[#B9CF32]/20 transition-colors z-0 select-none">2</div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="bg-[#347048] text-[#B9CF32] h-16 w-16 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                  <CalendarCheck size={32} strokeWidth={2.5} />
                </div>
                <h3 className="text-xl font-black text-[#347048] mb-3 uppercase tracking-wide">Elegí tu cancha</h3>
                <p className="text-[#347048]/70 font-medium">Revisá los clubes, compará precios e instalaciones, y confirmá tu turno con un clic.</p>
              </div>
            </div>
          </RevealOnScroll>

          <RevealOnScroll delay={300} className="h-full">
            <div className="h-full bg-[#EBE1D8] rounded-[2rem] p-8 text-center relative overflow-hidden group hover:-translate-y-2 transition-transform duration-300 shadow-xl shadow-[#B9CF32]/5 border-4 border-transparent hover:border-[#B9CF32]">
              <div className="absolute -top-6 -right-6 text-[100px] font-black text-[#347048]/5 group-hover:text-[#B9CF32]/20 transition-colors z-0 select-none">3</div>
              <div className="relative z-10 flex flex-col items-center">
                <div className="bg-[#B9CF32] text-[#347048] h-16 w-16 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                  <PlayCircle size={32} strokeWidth={2.5} />
                </div>
                <h3 className="text-xl font-black text-[#347048] mb-3 uppercase tracking-wide">¡A Jugar!</h3>
                <p className="text-[#347048]/70 font-medium">Presentate en el club y disfrutá de tu partido. ¡El tercer tiempo te está esperando!</p>
              </div>
            </div>
          </RevealOnScroll>
        </div>
      </section>

      {/* SECCIÓN: AMENIDADES PREMIUM */}
      <section className="py-24 px-4 relative z-10 overflow-hidden">
        <RevealOnScroll delay={0}>
          <div className="max-w-7xl mx-auto bg-[#EBE1D8] rounded-[3rem] p-8 md:p-16 shadow-2xl shadow-black/20 border-8 border-white/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-[#B9CF32]/20 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#926699]/10 rounded-full blur-[100px] pointer-events-none" />
            
            <div className="relative z-10">
              <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-black text-[#347048] italic tracking-tighter mb-4 uppercase">Más que una cancha</h2>
                <p className="text-[#347048]/70 font-bold max-w-2xl mx-auto uppercase tracking-widest text-sm">Disfrutá de instalaciones de primer nivel diseñadas para brindarte la mejor experiencia.</p>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                <RevealOnScroll delay={100}><div className="h-full flex flex-col items-center text-center p-6 bg-white/60 rounded-3xl border border-white"><div className="bg-[#926699]/10 text-[#926699] p-4 rounded-2xl mb-4"><Coffee size={32} strokeWidth={2} /></div><h4 className="text-[#347048] font-black text-lg mb-2">El 3er Tiempo</h4><p className="text-[#347048]/70 text-sm font-medium">Buffet completo con bebidas frías, snacks y el mejor ambiente post-partido.</p></div></RevealOnScroll>
                <RevealOnScroll delay={200}><div className="h-full flex flex-col items-center text-center p-6 bg-white/60 rounded-3xl border border-white"><div className="bg-[#347048]/10 text-[#347048] p-4 rounded-2xl mb-4"><Trophy size={32} strokeWidth={2} /></div><h4 className="text-[#347048] font-black text-lg mb-2">Pistas de Blindex</h4><p className="text-[#347048]/70 text-sm font-medium">Césped sintético profesional de última generación y medidas reglamentarias.</p></div></RevealOnScroll>
                <RevealOnScroll delay={300}><div className="h-full flex flex-col items-center text-center p-6 bg-white/60 rounded-3xl border border-white"><div className="bg-[#B9CF32]/20 text-[#347048] p-4 rounded-2xl mb-4"><Lightbulb size={32} strokeWidth={2} /></div><h4 className="text-[#347048] font-black text-lg mb-2">Iluminación Pro</h4><p className="text-[#347048]/70 text-sm font-medium">Focos LED de alta potencia para que juegues de noche sin puntos ciegos.</p></div></RevealOnScroll>
                <RevealOnScroll delay={400}><div className="h-full flex flex-col items-center text-center p-6 bg-white/60 rounded-3xl border border-white"><div className="bg-blue-50 text-blue-500 p-4 rounded-2xl mb-4"><Droplets size={32} strokeWidth={2} /></div><h4 className="text-[#347048] font-black text-lg mb-2">Vestuarios Premium</h4><p className="text-[#347048]/70 text-sm font-medium">Duchas amplias con agua caliente garantizada y lockers de seguridad.</p></div></RevealOnScroll>
              </div>
            </div>
          </div>
        </RevealOnScroll>
      </section>

      {/* SECCIÓN B2B (DUEÑOS) */}
      <section className="bg-[#926699] relative overflow-hidden">
        <div className="container mx-auto px-4 py-24 max-w-6xl relative z-10">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            
            <RevealOnScroll delay={0}>
              <div>
                <span className="text-[#B9CF32] font-black tracking-wider uppercase text-xs mb-3 block">
                  Software para complejos
                </span>
                <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight text-[#EBE1D8]">
                  Tu club, <br/>
                  <span className="opacity-70">a otro nivel.</span>
                </h2>
                <p className="text-[#EBE1D8]/80 text-lg mb-8 font-medium leading-relaxed">
                  Olvidate de los mensajes de WhatsApp y las planillas de excel. Automatizá reservas, cobros y estadísticas hoy mismo.
                </p>
                
                <ul className="space-y-4 mb-10">
                  <FeatureItem icon={<Calendar className="text-[#926699]" />} text="Reservas Online 24/7." />
                  <FeatureItem icon={<ShieldCheck className="text-[#926699]" />} text="Adiós a los deudores." />
                </ul>

                <button
                  type="button"
                  onClick={() => setShowContact(true)}
                  className="inline-flex items-center gap-2 bg-[#B9CF32] hover:bg-[#d6ed42] text-[#347048] px-8 py-4 rounded-2xl font-black transition-all shadow-xl shadow-[#347048]/20 hover:-translate-y-1"
                >
                  Probar Demo Gratis <ArrowRight size={20} />
                </button>
              </div>
            </RevealOnScroll>

            {/* MINI DASHBOARD VENDEDOR */}
            <div className="hidden md:block relative">
              <RevealOnScroll delay={300}>
                <div className="bg-[#EBE1D8] rounded-3xl p-8 shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500 border-4 border-[#EBE1D8]/20 select-none">
                    <div className="flex justify-between items-start mb-8 border-b border-[#347048]/10 pb-6">
                        <div>
                            <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-wider mb-1">Ingresos de Febrero</p>
                            <h3 className="text-4xl font-black text-[#347048] tracking-tight">$ 1.250.000</h3>
                        </div>
                        <div className="bg-[#B9CF32] px-3 py-1 rounded-full flex items-center gap-1 shadow-sm">
                            <TrendingUp size={16} className="text-[#347048]" />
                            <span className="text-[#347048] font-bold text-xs">+24%</span>
                        </div>
                    </div>
                    <div className="flex items-end justify-between gap-2 h-32 mb-8 px-2">
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[40%] hover:bg-[#B9CF32] transition-colors"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[60%] hover:bg-[#B9CF32] transition-colors"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[45%] hover:bg-[#B9CF32] transition-colors"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[70%] hover:bg-[#B9CF32] transition-colors"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[55%] hover:bg-[#B9CF32] transition-colors"></div>
                        <div className="w-full bg-[#347048]/20 rounded-t-lg h-[80%] hover:bg-[#B9CF32] transition-colors"></div>
                        <div className="w-full bg-gradient-to-t from-[#347048] to-[#B9CF32] rounded-t-lg h-[95%]"></div>
                    </div>
                </div>
              </RevealOnScroll>
            </div>

          </div>
        </div>
      </section>

      {/* SECCIÓN: PREGUNTAS FRECUENTES (FAQ) */}
      <section className="py-20 px-4 max-w-3xl mx-auto relative z-10 pb-32 overflow-hidden">
        <RevealOnScroll delay={0}>
          <div className="text-center mb-12">
            <span className="text-[#B9CF32] font-black tracking-wider uppercase text-sm mb-3 block">Dudas Comunes</span>
            <h2 className="text-3xl md:text-4xl font-black text-[#D4C5B0] italic tracking-tighter">PREGUNTAS FRECUENTES</h2>
          </div>
        </RevealOnScroll>
        <div className="space-y-4">
           <RevealOnScroll delay={100}><FAQItem question="¿Con cuánto tiempo de anticipación puedo reservar?" answer="Podés reservar tu cancha hasta con 30 días de anticipación utilizando nuestro calendario interactivo. Te recomendamos asegurar tu lugar temprano, ¡especialmente en horarios pico (18:00 a 22:00)!" /></RevealOnScroll>
           <RevealOnScroll delay={200}><FAQItem question="¿Puedo cancelar o reprogramar mi turno?" answer="Sí, podés cancelar tu turno desde tu panel de usuario o comunicándote con el club. El sistema devuelve automáticamente tu dinero en la caja si la cancelación se realiza dentro del margen de tiempo permitido por cada club." /></RevealOnScroll>
           <RevealOnScroll delay={300}><FAQItem question="¿Cuáles son los medios de pago aceptados?" answer="Aceptamos transferencias bancarias, Mercado Pago y efectivo directamente en el club. Al momento de confirmar la reserva, podrás ver todas las opciones disponibles." /></RevealOnScroll>
           <RevealOnScroll delay={400}><FAQItem question="¿Tienen servicio de alquiler de paletas o pelotas?" answer="¡Por supuesto! En la recepción del club vas a poder alquilar paletas de primera calidad y comprar pelotas nuevas para que no te falte nada a la hora de jugar." /></RevealOnScroll>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#D4C5B0]/10 py-10 bg-[#2a5c3b] text-center text-[#D4C5B0]/50 text-sm">
        <p className="font-medium">&copy; {new Date().getFullYear()} TuCancha App. Todos los derechos reservados.</p>
      </footer>
      
      {/* SIDEBAR DE CONTACTO (OFF-CANVAS) */}
      <div 
  className={`fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[60] transition-opacity duration-300 ${showContact ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowContact(false)}
      />

      <div className={`fixed top-0 right-0 h-full w-full max-w-sm bg-[#EBE1D8] z-[70] shadow-2xl transform transition-transform duration-300 ease-out ${showContact ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="p-6 flex justify-between items-center border-b border-[#347048]/10">
                <h2 className="text-2xl font-black text-[#347048]">Contacto</h2>
                <button 
                  onClick={() => setShowContact(false)}
                  className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                  title="Cerrar ventana"
                >
                  <X size={20} strokeWidth={3} />
                </button>
            </div>
            <div className="p-8 flex flex-col gap-6">
                <p className="text-[#347048]/80 font-medium leading-relaxed">
                    ¿Tenés dudas sobre el sistema o querés dar de alta tu club? Escribinos, respondemos al toque.
                </p>
        <a href="https://wa.me/543513436150" target="_blank" rel="noreferrer" className="flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm border border-[#347048]/5 hover:border-[#B9CF32] hover:shadow-md transition-all group">
                    <div className="bg-[#B9CF32] h-12 w-12 rounded-full flex items-center justify-center text-[#347048] group-hover:scale-110 transition-transform">
                        <Phone size={20} fill="currentColor" className="text-[#347048]" />
                    </div>
                    <div>
                        <p className="text-[#347048]/50 text-xs font-bold uppercase tracking-wider">WhatsApp</p>
            <p className="text-[#347048] font-bold text-lg">+54 351 343 6150</p>
                    </div>
                </a>
                <a href="mailto:hola@tucancha.app" className="flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm border border-[#347048]/5 hover:border-[#B9CF32] hover:shadow-md transition-all group">
                    <div className="bg-[#347048] h-12 w-12 rounded-full flex items-center justify-center text-[#EBE1D8] group-hover:scale-110 transition-transform">
                        <Mail size={20} />
                    </div>
                    <div>
                        <p className="text-[#347048]/50 text-xs font-bold uppercase tracking-wider">Email</p>
                        <p className="text-[#347048] font-bold text-lg">hola@tucancha.app</p>
                    </div>
                </a>
                <div className="mt-8 pt-8 border-t border-[#347048]/10">
                    <p className="text-[#347048]/60 text-sm font-bold mb-4 text-center">Seguinos en redes</p>
                    <div className="flex justify-center gap-4">
                        <a href="#" className="p-3 bg-[#347048] text-[#EBE1D8] rounded-full hover:bg-[#B9CF32] hover:text-[#347048] transition-colors">
                            <Instagram size={20} />
                        </a>
                    </div>
                </div>
            </div>
      </div>
    </div>
  );
}

const FeatureItem = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <li className="flex items-center gap-3">
    <div className="bg-[#EBE1D8] h-8 w-8 rounded-lg flex items-center justify-center shadow-sm shrink-0 opacity-90">
        {icon}
    </div>
    <span className="text-[#EBE1D8]/90 font-bold text-lg tracking-tight">{text}</span>
  </li>
);

const FAQItem = ({ question, answer }: { question: string, answer: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="bg-[#D4C5B0]/5 border border-[#D4C5B0]/10 rounded-2xl overflow-hidden transition-all duration-300 hover:bg-[#D4C5B0]/10">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full px-6 py-5 text-left flex justify-between items-center focus:outline-none">
        <span className="font-bold text-[#EBE1D8] pr-4">{question}</span>
        <ChevronDown className={`text-[#B9CF32] shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <div className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-40 pb-5 opacity-100' : 'max-h-0 opacity-0'}`}>
        <p className="text-[#EBE1D8]/70 text-sm leading-relaxed">{answer}</p>
      </div>
    </div>
  )
};