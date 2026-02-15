import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import BookingGrid from '../../components/BookingGrid';
import Navbar from '../../components/NavBar';
import { ClubService, Club } from '../../services/ClubService';
import { 
  MapPin, 
  Calendar, 
  Clock, 
  ChevronRight, 
  Search, 
  Phone, 
  Mail, 
  Instagram,
  Heart,      
  Share2      
} from 'lucide-react';

const formatClubAddress = (club: Club) => {
  return [club.addressLine, club.city, club.province, club.country].filter(Boolean).join(', ');
};

export default function ClubPage() {
  const router = useRouter();
  const { slug } = router.query;
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadClub = async () => {
      if (!slug || typeof slug !== 'string') {
        setLoadingClub(false);
        return;
      }

      try {
        setLoadingClub(true);
        setError(null);
        const clubData = await ClubService.getClubBySlug(slug);
        setClub(clubData);
      } catch (error: any) {
        console.error('Error al cargar información del club:', error);
        setError('Club no encontrado');
      } finally {
        setLoadingClub(false);
      }
    };

    loadClub();
  }, [slug]);

  const slugReady = router.isReady && slug && typeof slug === 'string';
  const stillLoading = !slugReady || loadingClub;

  if (stillLoading) {
    return (
      <main className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4 bg-[#347048] text-[#D4C5B0]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-emerald-500/40 border-t-emerald-400 animate-spin" />
          <p className="text-[#D4C5B0]/80 text-sm">Cargando club...</p>
        </div>
      </main>
    );
  }

  if (error || !club) {
    return (
      <main className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4 bg-[#347048] text-[#D4C5B0]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#D4C5B0] mb-4">Club no encontrado</h1>
          <p className="text-[#D4C5B0]/80 mb-4">{error || 'El club solicitado no existe'}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 rounded-full bg-[#D4C5B0] text-[#347048] font-bold hover:bg-[#B9CF32] transition-all"
          >
            Volver al inicio
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen relative bg-[#347048] text-[#D4C5B0]">

      {/* Contenido (Z-10 para que esté sobre el fondo) */}
      <div className="absolute top-0 left-0 w-full z-50"> 
        <Navbar />
      </div>
      
      {/* FONDO AMBIENTAL */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </div>

        
      <div className="max-w-6xl mx-auto px-4 pt-20 pb-20 relative z-10">

        {/* --- HERO SECTION TIPO TARJETA REDONDEADA --- */}
        <header className="mb-10">
          <div className="relative bg-[#347048] rounded-[2.5rem] overflow-hidden shadow-2xl border border-black/10">
            
            {/* 1. FONDO GRADIENTE INTERNO */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#347048] via-[#347048] to-[#2a2438]"></div>
            <div className="absolute top-[-50%] right-[-20%] w-[600px] h-[600px] bg-[#B9CF32]/20 rounded-full blur-[120px] pointer-events-none"></div>
            

            {/* 2. CONTENIDO */}
            <div className="relative z-10 p-8 md:p-10 flex flex-col md:flex-row items-center md:items-end gap-8 text-center md:text-left">
              
              {/* LOGO DEL CLUB */}
              <div className="relative group shrink-0">
                <div className="absolute -inset-2 bg-gradient-to-tr from-[#B9CF32] to-[#926699] rounded-[2rem] blur-md opacity-60 group-hover:opacity-100 transition duration-500"></div>
                <div className="relative h-32 w-32 md:h-40 md:w-40 bg-white rounded-[1.8rem] p-3 shadow-xl flex items-center justify-center transform group-hover:-translate-y-1 transition-transform duration-300">
                  {club.logoUrl ? (
                    <img src={club.logoUrl} alt={club.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-4xl">🏆</span>
                  )}
                </div>
              </div>

              {/* NOMBRE E INFO */}
              <div className="flex-1 py-2">
                <div className="flex items-center justify-center md:justify-start gap-3 mb-3">
                  <span className="bg-[#B9CF32] text-[#347048] px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                    Club Verificado
                  </span>
                  <div className="flex items-center gap-1 text-[#EBE1D8] text-xs font-bold">
                    <span>⭐ 4.9</span>
                    <span className="opacity-50">(120 reseñas)</span>
                  </div>
                </div>

                <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-[#EBE1D8] italic tracking-tighter leading-[0.9] mb-4 drop-shadow-lg">
                  {club.name}
                </h1>

                <div className="flex flex-wrap justify-center md:justify-start gap-x-6 gap-y-3 text-[#EBE1D8]/90 text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-[#B9CF32]" />
                    <span>{[club.addressLine, club.city].filter(Boolean).join(', ')}</span>
                  </div>
                  
                  {club.instagramUrl && (
                    <a href={club.instagramUrl} target="_blank" className="flex items-center gap-2 hover:text-[#B9CF32] transition-colors group/insta">
                      <Instagram size={18} className="group-hover/insta:text-[#B9CF32]"/>
                      <span>@{club.instagramUrl.replace(/\/$/, '').split('/').pop() || 'Instagram'}</span>
                    </a>
                  )}
                </div>
              </div>

              {/* BOTONES DE ACCIÓN */}
              <div className="flex gap-3 shrink-0">
                <button className="h-12 w-12 rounded-2xl border-2 border-[#EBE1D8]/30 flex items-center justify-center text-[#EBE1D8] hover:bg-[#EBE1D8] hover:text-[#347048] hover:border-transparent transition-all bg-[#347048]/50 backdrop-blur-md">
                    <Heart size={22} />
                </button>
                <button className="h-12 w-12 rounded-2xl border-2 border-[#EBE1D8]/30 flex items-center justify-center text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] hover:border-transparent transition-all bg-[#347048]/50 backdrop-blur-md">
                    <Share2 size={22} />
                </button>
              </div>

            </div> {/* Cierre Contenido */}
          </div> {/* Cierre Tarjeta principal */}
        </header>

        {/* --- GRILLA PRINCIPAL --- */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
          <BookingGrid clubSlug={slug} />

          <div className="flex flex-col gap-6">
            {/* BLOQUE INFORMACIÓN */}
            <div className="bg-white/10 border border-white/20 rounded-3xl p-5 backdrop-blur shadow-[0_18px_40px_rgba(146,102,153,0.18)]">
              <h3 className="text-lg font-bold text-[#D4C5B0] mb-4">Información</h3>
              <div className="space-y-3 text-sm text-[#D4C5B0]/80">
                {club.description && <p className="text-[#D4C5B0] font-semibold">{club.description}</p>}
                
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' ' + formatClubAddress(club))}`} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 font-bold hover:text-[#B9CF32] transition-colors group cursor-pointer">
                  <MapPin size={16} />
                  <span className="group-hover:underline decoration-[#B9CF32] underline-offset-4">{formatClubAddress(club)}</span>
                </a>

                {club.phone && (
                  <a href={`tel:${club.phone.replace(/\s+/g, '')}`} className="flex items-start gap-2 font-bold hover:text-[#B9CF32] transition-colors group cursor-pointer">
                    <Phone size={16} />
                    <span className="group-hover:underline decoration-[#B9CF32] underline-offset-4">{club.phone}</span>
                  </a>
                )}
              </div>
            </div>

            {/* BLOQUE SOCIAL */}
            {(club.instagramUrl || club.facebookUrl || club.websiteUrl) && (
              <div className="bg-white/10 border border-white/20 rounded-3xl p-5 backdrop-blur">
                <h3 className="text-lg font-bold text-[#D4C5B0] mb-4">Social</h3>
                <div className="space-y-2">
                  {club.instagramUrl && (
                    <a href={club.instagramUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-bold hover:text-[#B9CF32] transition-colors">
                      <Instagram size={16} />
                      <span>{club.instagramUrl.replace(/^https?:\/\/(www\.)?(instagram\.com\/)?/, '@')}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <footer className="mt-16 mb-8 text-center border-t border-white/10 pt-8">
          <p className="text-xs text-[#D4C5B0]/70 font-medium">
            Sistema de Reservas 2026 v1.0 - Todos los derechos reservados
          </p>
        </footer>
      </div>
    </main>
  );
}
