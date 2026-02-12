import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
import { Search, MapPin, Calendar, TrendingUp, ShieldCheck, ArrowRight, Menu, X, Phone, Mail, Instagram, Activity, ChevronRight } from 'lucide-react';
import Link from 'next/link';

// --- 1. FUNCIÓN DE NORMALIZACIÓN (La clave para ignorar tildes) ---
// Transforma "Río Cuarto" -> "rio cuarto"
const normalizeText = (text: string) => {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

export default function Home() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showContact, setShowContact] = useState(false);
  const resultsRef = useRef<HTMLElement>(null);

  // Estados del Buscador
  const [searchCity, setSearchCity] = useState('');
  const [showCityDropdown, setShowCityDropdown] = useState(false); // Para mostrar/ocultar el combo
  
  const [searchSport, setSearchSport] = useState('');
  const [searchDate, setSearchDate] = useState('');

  useEffect(() => {
    // Carga Usuario
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (userStr) { try { setUser(JSON.parse(userStr)); } catch {} }

    // Carga Clubes
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
    loadClubs();
  }, []);

  // --- 2. EXTRAER CIUDADES ÚNICAS PARA EL COMBO ---
  // Creamos una lista de ciudades basada en los clubes que existen
  const uniqueCities = useMemo(() => {
    const cities = clubs.map(c => c.name || '').filter(Boolean);
    // Eliminamos duplicados
    return Array.from(new Set(cities));
  }, [clubs]);

  // Filtrar las sugerencias del combo mientras escribís
  const suggestedCities = uniqueCities.filter(city => 
    normalizeText(city).includes(normalizeText(searchCity))
  );

  // --- 3. FILTRADO PRINCIPAL (GRID) ---
  const filteredClubs = clubs.filter(club => {
    const term = normalizeText(searchCity); // Lo que escribió el usuario (normalizado)
    
    const name = normalizeText(club.name || '');
    const city = normalizeText(club.address || '');
    const address = normalizeText(club.address || '');

    // Si coincide con nombre, ciudad o dirección
    return name.includes(term) || city.includes(term) || address.includes(term);
  });

  const handleSearch = () => {
    setShowCityDropdown(false); // Cerramos el combo al buscar
    if (resultsRef.current) {
        resultsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Función al elegir una ciudad del combo
  const selectCity = (city: string) => {
    setSearchCity(city);
    setShowCityDropdown(false);
    // Opcional: Auto-scroll al seleccionar
    // if (resultsRef.current) resultsRef.current.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen relative overflow-x-hidden bg-[#347048] text-[#D4C5B0] selection:bg-[#B9CF32] selection:text-[#347048]" onClick={() => setShowCityDropdown(false)}>
      
      {/* NAVBAR */}
      <nav className="absolute top-0 left-0 right-0 z-50 px-6 py-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-tighter text-[#D4C5B0] italic opacity-90 hover:opacity-100 transition-opacity cursor-pointer">
                TuCancha
            </span>
        </div>
        <div className="flex items-center gap-4">
            <button onClick={() => setShowContact(true)} className="hidden md:flex items-center gap-2 px-5 py-2 rounded-full border border-[#D4C5B0]/30 text-[#D4C5B0] font-bold text-sm hover:bg-[#D4C5B0] hover:text-[#347048] transition-all">
                <span>Contacto</span>
            </button>
            {!user && (
                <Link href="/login" className="px-5 py-2 rounded-full bg-[#D4C5B0] text-[#347048] font-bold hover:bg-[#B9CF32] transition-all text-sm shadow-lg shadow-[#347048]/50">
                    Ingresar
                </Link>
            )}
            <button onClick={() => setShowContact(true)} className="md:hidden text-[#D4C5B0]"> <Menu /> </button>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative pt-32 pb-24 px-4 flex flex-col items-center text-center z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#B9CF32]/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
        
        <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight text-[#D4C5B0]">
          Tu cancha, <span className="text-[#B9CF32]">al toque.</span>
        </h1>
        <p className="text-[#D4C5B0]/80 text-lg md:text-xl max-w-2xl mb-12 font-medium leading-relaxed">
          Explorá las canchas disponibles en tu ciudad y en tiempo real.
        </p>

        {/* --- BARRA DE BÚSQUEDA --- */}
        <div 
            className="w-full max-w-4xl bg-[#EBE1D8] rounded-[2rem] p-2 shadow-2xl shadow-[#347048]/50 flex flex-col md:flex-row items-center divide-y md:divide-y-0 md:divide-x divide-[#347048]/10 relative z-50"
            onClick={(e) => e.stopPropagation()} // Evita que se cierre al hacer click adentro
        >
            
            {/* CAMPO 1: UBICACIÓN (Con Combo) */}
            <div className="flex-1 w-full relative group">
                <div 
                    className="p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors cursor-pointer h-full flex items-center gap-3"
                    // Al hacer click mostramos el combo
                    onClick={() => {
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
                            onFocus={() => setShowCityDropdown(true)}
                            autoComplete="off"
                        />
                    </div>
                </div>

                {/* --- EL COMBO FLOTANTE (Dropdown) --- */}
                {showCityDropdown && (
                    <div className="absolute top-full left-0 w-full md:w-[300px] mt-4 bg-white rounded-2xl shadow-xl border border-[#347048]/10 overflow-hidden z-[100] animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-3 bg-[#EBE1D8]/30 border-b border-[#347048]/5">
                            <span className="text-xs font-bold text-[#347048] uppercase tracking-wider">Lugares disponibles</span>
                        </div>
                        <ul className="max-h-60 overflow-y-auto">
                            {suggestedCities.length > 0 ? (
                                suggestedCities.map((city, idx) => (
                                    <li 
                                        key={idx}
                                        onClick={() => selectCity(city)}
                                        className="px-4 py-3 hover:bg-[#B9CF32]/10 cursor-pointer flex items-center justify-between group transition-colors border-b border-gray-50 last:border-0"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="bg-[#EBE1D8] p-1.5 rounded-full text-[#347048]">
                                                <MapPin size={14} />
                                            </div>
                                            <span className="text-[#347048] font-medium text-sm">{city}</span>
                                        </div>
                                        <ChevronRight size={14} className="text-[#B9CF32] opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
                                    </li>
                                ))
                            ) : (
                                <li className="px-4 py-6 text-center text-gray-400 text-sm">
                                    No hay clubes en esa ciudad aún.
                                </li>
                            )}
                        </ul>
                    </div>
                )}
            </div>

            {/* CAMPO 2: DEPORTE */}
            <div className="flex-1 w-full p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors group">
                <div className="flex items-center gap-3 h-full">
                    <Activity className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
                    <div className="flex flex-col items-start text-left w-full">
                        <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider">Deporte</label>
                        <select 
                            className="bg-transparent border-none outline-none text-[#347048] font-bold w-full p-0 leading-tight cursor-pointer appearance-none truncate"
                            value={searchSport}
                            onChange={(e) => setSearchSport(e.target.value)}
                        >
                            <option value="">Todos</option>
                            <option value="padel">Pádel</option>
                            <option value="futbol">Fútbol</option>
                            <option value="tenis">Tenis</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* CAMPO 3: FECHA */}
            <div className="flex-1 w-full p-2 px-4 hover:bg-[#d4c5b0]/20 rounded-xl transition-colors group">
                <div className="flex items-center gap-3 h-full">
                    <Calendar className="text-[#347048] group-hover:text-[#B9CF32] transition-colors shrink-0" size={20} />
                    <div className="flex flex-col items-start text-left w-full">
                        <label className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-wider">Fecha</label>
                        <input 
                            type="date" 
                            className="bg-transparent border-none outline-none text-[#347048] font-bold text-sm w-full p-0 leading-tight uppercase cursor-pointer"
                            value={searchDate}
                            onChange={(e) => setSearchDate(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* BOTÓN BUSCAR */}
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

      {/* RESULTADOS */}
      <section ref={resultsRef} className="container mx-auto px-4 py-10 pb-32 max-w-6xl">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2 text-[#D4C5B0]/90">
          <MapPin className="text-[#B9CF32]" /> 
          {searchCity ? `Resultados en ${searchCity}` : 'Clubes Disponibles'}
        </h2>

        {loadingClubs ? (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1,2,3].map(i => (
                <div key={i} className="h-64 bg-[#D4C5B0]/5 rounded-3xl animate-pulse border border-[#D4C5B0]/10"></div>
              ))}
           </div>
        ) : filteredClubs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClubs.map((club) => (
              <Link key={club.id} href={`/club/${club.slug}`} className="group relative bg-[#EBE1D8] border border-transparent rounded-3xl overflow-hidden hover:scale-[1.02] transition-all shadow-xl hover:shadow-[#B9CF32]/20 block">
                <div className="h-40 w-full bg-[#dcd0c5] relative overflow-hidden border-b border-[#347048]/10">
                   <div className="absolute inset-0 bg-gradient-to-br from-[#EBE1D8] to-[#d6c7ba] flex items-center justify-center">
                      {club.logoUrl ? (
                        <img src={club.logoUrl} alt={club.name} className="h-24 w-24 object-contain opacity-90 mix-blend-multiply group-hover:scale-110 transition-transform" />
                      ) : (
                        <span className="text-4xl opacity-10 text-[#347048]">🎾</span>
                      )}
                   </div>
                   <div className="absolute bottom-3 right-3 bg-[#926699] px-3 py-1 rounded-full text-xs font-bold text-[#EBE1D8] shadow-sm flex items-center gap-1">
                      <span>📍</span> {club.name || 'Club'}
                   </div>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-black text-[#347048] mb-1 leading-tight">{club.name}</h3>
                  <p className="text-[#347048]/70 text-sm mb-5 font-medium line-clamp-1">{club.address || 'Ubicación no disponible'}</p>
                  <div className="w-full bg-[#347048] group-hover:bg-[#B9CF32] py-3 rounded-xl text-center transition-colors duration-300">
                     <span className="text-xs font-black text-[#D4C5B0] group-hover:text-[#347048] uppercase tracking-widest">Reservar</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-[#D4C5B0]/5 rounded-3xl border border-dashed border-[#D4C5B0]/20">
            <p className="text-[#D4C5B0]/60">No encontramos canchas con ese criterio.</p>
            <button onClick={() => setSearchCity('')} className="mt-4 text-[#B9CF32] font-bold hover:underline">Ver todos</button>
          </div>
        )}
      </section>
      
      {/* ... (Aquí abajo va la sección B2B violeta y el footer que ya tenías) ... */}
      
      {/* ... (Y aquí el Sidebar de Contacto) ... */}
      
    </div>
  );
}