import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
import { LocationService, Location } from '../services/LocationService';
import DatePickerDark from '../components/ui/DatePickerDark';
import { Search, MapPin, Calendar, TrendingUp, ShieldCheck, ArrowRight, Menu, X, Phone, Mail, Instagram, Activity, ChevronRight, MousePointerClick, CalendarCheck, PlayCircle, Coffee, Droplets, Lightbulb, Trophy, ChevronDown } from 'lucide-react';
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
    if (ref.current) observer.observe(ref.current);
    return () => { if (ref.current) observer.unobserve(ref.current); };
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

  // Estados del Buscador
  const [searchCity, setSearchCity] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false); 
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [displayedClubs, setDisplayedClubs] = useState<Club[]>([]);
  const [clubCoords, setClubCoords] = useState<Record<number, { lat: number; lon: number } | null>>({});

  const [searchSport, setSearchSport] = useState('');
  const [showSportDropdown, setShowSportDropdown] = useState(false);
  const [searchDate, setSearchDate] = useState('');
  const [lastSearchLabel, setLastSearchLabel] = useState<string>('');

  const userInitials = useMemo(() => {
    if (!user) return 'TU';
    const first = (user.firstName || user.name || '').trim();
    const last = (user.lastName || '').trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.trim();
    return initials || 'TU';
  }, [user]);

  const sportOptions = useMemo(() => ([
    {
      value: '',
      label: 'Todos',
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18" />
          <path d="M12 3a15 15 0 0 0 0 18" />
        </svg>
      )
    },
    {
      value: 'padel',
      label: 'Pádel',
      icon: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="3" width="8" height="12" rx="2" />
          <circle cx="16.5" cy="14.5" r="2.5" />
          <path d="M10 15v6" />
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
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="6" />
          <path d="M14.5 14.5L20 20" />
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
    setDisplayedClubs(filtered.map(item => item.club));
    setLastSearchLabel(location.label);

    if (resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth' });
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
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowUserMenu((prev) => !prev);
                  }}
                  className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-all"
                >
                  <div className="relative">
                    <div className="h-9 w-9 rounded-full bg-black/70 border-2 border-white/60 flex items-center justify-center text-white text-xs font-black">
                      {userInitials}
                    </div>
                    <span className="absolute -right-1 -top-1 bg-[#0bbd49] text-white text-[10px] font-black rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                      {activeBookingsCount}
                    </span>
                  </div>
                  <span className="text-[#D4C5B0] font-bold text-sm">{user.firstName || user.name || 'Usuario'}</span>
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-4 w-[280px] md:w-[320px] bg-white rounded-3xl shadow-2xl border border-black/5 overflow-hidden z-[120]" onClick={(e) => e.stopPropagation()}>
                    <div className="p-6 flex flex-col items-center text-center">
                      <div className="relative mb-4">
                        <div className="h-24 w-24 rounded-full bg-black flex items-center justify-center text-white text-2xl font-black">
                          {userInitials}
                        </div>
                        <span className="absolute -right-1 -top-1 bg-[#0bbd49] text-white text-xs font-black rounded-full h-6 w-6 flex items-center justify-center">✓</span>
                      </div>
                      <h3 className="text-xl font-black text-[#2b3a4a]">{user.firstName || user.name || 'Usuario'}</h3>
                    </div>
                    <div className="border-t border-black/10 px-6 py-4">
                      <p className="text-[#2b3a4a] font-black text-lg mb-4">Datos proporcionados</p>
                      <div className="space-y-3 text-[#2b3a4a]/70">
                        <div className="flex items-center gap-3">
                          <span className="text-[#0bbd49]">✔</span>
                          <span>{user.phoneNumber || user.phone || 'Sin teléfono'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[#0bbd49]">✉️</span>
                          <span>{user.email || 'Sin email'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-black/10 px-6 py-4 space-y-4 text-[#2b3a4a] font-semibold">
                      <Link
                        href="/bookings"
                        className="flex items-center gap-3 hover:text-[#0bbd49]"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <span>📅</span> Mis Reservas
                      </Link>
                      <button
                        type="button"
                        className="flex items-center gap-3 hover:text-[#0bbd49] w-full text-left"
                        onClick={() => setShowUserMenu(false)}
                      >
                        <span>👤</span> Mi Perfil
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-3 text-[#e66a2c] w-full text-left"
                        onClick={() => {
                          logout();
                          setUser(null);
                          setShowUserMenu(false);
                          router.push('/');
                        }}
                      >
                        <span>↪</span> Cerrar sesión
                      </button>
                    </div>
                  </div>
                )}
              </div>
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
            className="w-full max-w-4xl bg-[#EBE1D8] rounded-[2rem] p-2 shadow-2xl shadow-[#347048]/50 flex flex-col md:flex-row items-center divide-y md:divide-y-0 md:divide-x divide-[#347048]/10 relative z-50"
            onClick={(e) => e.stopPropagation()} 
        >
            <div className="flex-1 md:flex-[1.4] w-full relative group">
                <div 
                    className="p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors cursor-pointer h-full flex items-center gap-3"
                    onClick={() => {
                        setShowSportDropdown(false);
                        setShowCityDropdown(true);
                        document.getElementById('cityInput')?.focus();
                    }}
                >
                    <MapPin className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
                    <div className="flex flex-col items-start text-left w-full overflow-hidden">
                        <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider">Ubicación</label>
                        <input 
                            id="cityInput"
                            type="text" 
                            placeholder="¿Dónde jugás?" 
                            className="bg-transparent border-none outline-none text-[#347048] font-bold placeholder-[#347048]/40 w-full p-0 leading-tight truncate"
                            value={searchCity}
                            onChange={(e) => {
                                setSearchCity(e.target.value);
                                setShowCityDropdown(true);
                            }}
                            onFocus={(e) => {
                                e.target.select();
                                setShowSportDropdown(false);
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

      <div className="flex-1 w-full relative group">
        <div
          className="p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors cursor-pointer h-full flex items-center gap-3"
          onClick={(e) => {
            e.stopPropagation();
            setShowCityDropdown(false);
            setShowSportDropdown((prev) => !prev);
          }}
        >
          <Activity className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
          <div className="flex flex-col items-start text-left w-full overflow-hidden">
            <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider">Deporte</label>
            <div className="flex items-center gap-2 text-[#347048] font-bold text-sm uppercase truncate">
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

      <div
        className="flex-1 w-full p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors group"
        onClick={() => { setShowCityDropdown(false); setShowSportDropdown(false); }}
      >
                <div className="flex items-center gap-3 h-full">
                    <Calendar className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
                    <div className="flex flex-col items-start text-left w-full">
                        <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider">Fecha</label>
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
                            inputClassName="bg-transparent border-none outline-none text-[#347048] font-bold text-sm w-full p-0 leading-tight uppercase cursor-pointer placeholder-[#347048]/40 h-auto px-0 py-0 focus:ring-0 focus:border-transparent"
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
                  <div className="h-40 shrink-0 w-full bg-[#dcd0c5] relative overflow-hidden border-b border-[#347048]/10">
                    {club.clubImageUrl ? (
                      <>
                        <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: `url(${club.clubImageUrl})` }} />
                        {club.logoUrl && (
                          <div className="absolute top-3 left-3 bg-white/80 backdrop-blur rounded-xl p-2 shadow-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={club.logoUrl} alt={club.name} className="h-10 w-10 object-contain" />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[#EBE1D8] to-[#d6c7ba] flex items-center justify-center transition-transform duration-700 group-hover:scale-105">
                          {club.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={club.logoUrl} alt={club.name} className="h-24 w-24 object-contain opacity-90 mix-blend-multiply" />
                          ) : (
                            <span className="text-4xl opacity-10 text-[#347048]">🎾</span>
                          )}
                      </div>
                    )}
                    <div className="absolute bottom-3 right-3 bg-[#926699] px-3 py-1 rounded-full text-xs font-bold text-[#EBE1D8] shadow-sm flex items-center gap-1">
                      <span>📍</span> {club.name || 'Club'}
                    </div>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <h3 className="text-xl font-black text-[#347048] mb-1 leading-tight">{club.name}</h3>
                    <p className="text-[#347048]/70 text-sm mb-5 font-medium line-clamp-1 flex-1">{formatClubAddress(club) || 'Ubicación no disponible'}</p>
                    <div className="w-full bg-[#347048] group-hover:bg-[#B9CF32] py-3 rounded-xl text-center transition-colors duration-300">
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
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300 ${showContact ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowContact(false)}
      />

      <div className={`fixed top-0 right-0 h-full w-full max-w-sm bg-[#EBE1D8] z-[70] shadow-2xl transform transition-transform duration-300 ease-out ${showContact ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="p-6 flex justify-between items-center border-b border-[#347048]/10">
                <h2 className="text-2xl font-black text-[#347048]">Contacto</h2>
                <button 
                    onClick={() => setShowContact(false)}
                    className="p-2 hover:bg-[#347048]/10 rounded-full text-[#347048] transition-colors"
                >
                    <X size={24} />
                </button>
            </div>
            <div className="p-8 flex flex-col gap-6">
                <p className="text-[#347048]/80 font-medium leading-relaxed">
                    ¿Tenés dudas sobre el sistema o querés dar de alta tu club? Escribinos, respondemos al toque.
                </p>
                <a href="https://wa.me/549351000000" target="_blank" rel="noreferrer" className="flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm border border-[#347048]/5 hover:border-[#B9CF32] hover:shadow-md transition-all group">
                    <div className="bg-[#B9CF32] h-12 w-12 rounded-full flex items-center justify-center text-[#347048] group-hover:scale-110 transition-transform">
                        <Phone size={20} fill="currentColor" className="text-[#347048]" />
                    </div>
                    <div>
                        <p className="text-[#347048]/50 text-xs font-bold uppercase tracking-wider">WhatsApp</p>
                        <p className="text-[#347048] font-bold text-lg">+54 9 351 ...</p>
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