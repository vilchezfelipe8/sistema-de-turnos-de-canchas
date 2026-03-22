import { useEffect, useState } from 'react';
import Image from 'next/image';
import Head from 'next/head';
import { useRouter } from 'next/router';
import BookingGrid from '../../components/BookingGrid';
import Navbar from '../../components/NavBar';
import { ClubService, Club } from '../../services/ClubService';
import { ClubReviewItem, getClubReviewsSummary, listClubReviews } from '../../services/ClubReviewService';
import { reportUiError } from '../../utils/uiError';
import { 
  MapPin, 
  Calendar, 
  ChevronRight, 
  Search, 
  Phone, 
  Mail, 
  Instagram,
  Share2,
  Trophy,
  Star,
  Check // 👉 Agregamos Check y sacamos Heart
} from 'lucide-react';

const formatClubAddress = (club: Club) => {
  return [club.addressLine, club.city, club.province, club.country].filter(Boolean).join(', ');
};

const formatRatingLabel = (value: number) => {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return '0';
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(1);
};

export default function ClubPage() {
  const router = useRouter();
  const { slug } = router.query;
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewsSummary, setReviewsSummary] = useState<{ count: number; averageRating: number }>({ count: 0, averageRating: 0 });
  const [reviews, setReviews] = useState<ClubReviewItem[]>([]);
  
  // 👉 1. Estado para el botón de compartir
  const [isCopied, setIsCopied] = useState(false);

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
        reportUiError({ area: 'ClubPage', action: 'loadClubBySlug' }, error);
        setError('Club no encontrado');
      } finally {
        setLoadingClub(false);
      }
    };

    loadClub();
  }, [slug]);

  useEffect(() => {
    const loadReviews = async () => {
      if (!slug || typeof slug !== 'string') return;
      try {
        const [summary, list] = await Promise.all([
          getClubReviewsSummary(slug),
          listClubReviews(slug, { take: 6 })
        ]);
        setReviewsSummary({
          count: Number(summary?.count || 0),
          averageRating: Number(summary?.averageRating || 0)
        });
        setReviews(Array.isArray(list?.items) ? list.items : []);
      } catch (error) {
        reportUiError({ area: 'ClubPage', action: 'loadClubReviews' }, error);
        setReviewsSummary({ count: 0, averageRating: 0 });
        setReviews([]);
      }
    };
    loadReviews();
  }, [slug]);

  // 👉 2. Función que copia la URL
  const handleShare = async () => {
    if (typeof window !== 'undefined') {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        reportUiError({ area: 'ClubPage', action: 'copyShareLink' }, err);
      }
    }
  };

  const slugReady = router.isReady && slug && typeof slug === 'string';
  const stillLoading = !slugReady || loadingClub;
  const pageTitle = club?.name ? `${club.name} | TuCancha` : 'TuCancha';

  if (stillLoading) {
    return (
      <>
        <Head>
          <title>{pageTitle}</title>
        </Head>
        <main className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4 bg-[#347048] text-[#D4C5B0]">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 rounded-full border-2 border-emerald-500/40 border-t-emerald-400 animate-spin" />
            <p className="text-[#D4C5B0]/80 text-sm">Cargando club...</p>
          </div>
        </main>
      </>
    );
  }

  if (error || !club) {
    return (
      <>
        <Head>
          <title>{pageTitle}</title>
        </Head>
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
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
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
            
            {/* 1. FONDO (BANNER DEL CLUB + OVERLAY) */}
            {club.clubImageUrl ? (
              <>
                <Image
                  src={club.clubImageUrl}
                  alt={`Banner de ${club.name}`}
                  fill
                  sizes="100vw"
                  className="absolute inset-0 h-full w-full object-cover"
                  unoptimized
                />
                <div className="absolute inset-0 bg-gradient-to-br from-[#347048]/85 via-[#347048]/70 to-[#2a2438]/75" />
              </>
            ) : (
              <>
                <div className="absolute inset-0 bg-gradient-to-br from-[#347048] via-[#347048] to-[#2a2438]"></div>
                <div className="absolute top-[-50%] right-[-20%] w-[600px] h-[600px] bg-[#B9CF32]/20 rounded-full blur-[120px] pointer-events-none"></div>
              </>
            )}
            

            {/* 2. CONTENIDO */}
            <div className="relative z-10 p-8 md:p-10 flex flex-col md:flex-row items-center md:items-end gap-8 text-center md:text-left">
              
              {/* LOGO DEL CLUB */}
              <div className="relative group shrink-0">
                <div className="absolute -inset-2 bg-gradient-to-tr from-[#B9CF32] to-[#926699] rounded-[2rem] blur-md opacity-60 group-hover:opacity-100 transition duration-500"></div>
                <div className="relative h-32 w-32 md:h-40 md:w-40 bg-white rounded-[1.8rem] p-3 shadow-xl flex items-center justify-center transform group-hover:-translate-y-1 transition-transform duration-300">
                  {club.logoUrl ? (
                    <Image
                      src={club.logoUrl}
                      alt={club.name}
                      fill
                      sizes="160px"
                      className="object-contain"
                      unoptimized
                    />
                  ) : (
                    <Trophy size={40} className="text-[#EBE1D8]/80" strokeWidth={2} />
                  )}
                </div>
              </div>

              {/* NOMBRE E INFO */}
              <div className="flex-1 py-2">
                {reviewsSummary.count > 0 && (
                  <div className="flex items-center justify-center md:justify-start gap-1 text-[#EBE1D8] text-xs font-bold mb-3">
                    <span className="flex items-center gap-1">
                      <Star size={14} className="text-[#B9CF32]" /> {formatRatingLabel(reviewsSummary.averageRating)}
                    </span>
                    <span className="opacity-70">({reviewsSummary.count} reseñas)</span>
                  </div>
                )}
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

              {/* 👉 3. BOTONES DE ACCIÓN (Corregidos) */}
              <div className="flex gap-3 shrink-0 relative">
                <button 
                  onClick={handleShare}
                  className={`relative h-12 w-12 rounded-2xl border-2 flex items-center justify-center transition-all backdrop-blur-md ${
                    isCopied 
                      ? 'bg-[#B9CF32] text-[#347048] border-transparent scale-105' 
                      : 'border-[#EBE1D8]/30 text-[#EBE1D8] bg-[#347048]/50 hover:bg-[#B9CF32] hover:text-[#347048] hover:border-transparent'
                  }`}
                  title="Copiar enlace"
                >
                    {isCopied ? <Check size={22} strokeWidth={3} className="animate-in zoom-in" /> : <Share2 size={22} />}
                    
                    {/* Cartelito flotante de copiado */}
                    {isCopied && (
                      <span className="absolute -top-10 bg-[#B9CF32] text-[#347048] text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-xl animate-in fade-in slide-in-from-bottom-2 whitespace-nowrap">
                        ¡Copiado!
                      </span>
                    )}
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
                {Array.isArray(club.openingDays) && club.openingDays.length > 0 && (
                  <div className="flex items-center gap-2 font-bold mt-2 text-sm text-[#D4C5B0]/90">
                    <Calendar size={16} />
                    <div className="flex gap-2">
                      {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((label, idx) => (
                        club.openingDays!.includes(idx) ? (
                          <span key={label} className="px-2 py-1 bg-[#B9CF32] text-[#347048] rounded-md text-xs font-black">{label}</span>
                        ) : null
                      ))}
                    </div>
                  </div>
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

            {reviewsSummary.count > 0 && (
              <div className="bg-white/10 border border-white/20 rounded-3xl p-5 backdrop-blur">
                <h3 className="text-lg font-bold text-[#D4C5B0] mb-4">Reseñas</h3>
                <div className="mb-3 text-sm font-bold text-[#D4C5B0]">
                  {formatRatingLabel(reviewsSummary.averageRating)} / 5 · {reviewsSummary.count} reseñas
                </div>
                <div className="space-y-3">
                  {reviews.slice(0, 3).map((review) => (
                    <div key={review.id} className="rounded-2xl bg-white/10 border border-white/10 p-3">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <p className="text-xs font-black text-[#D4C5B0] uppercase tracking-widest truncate">{review.user.name}</p>
                        <p className="text-xs font-black text-[#B9CF32]">{formatRatingLabel(Number(review.rating || 0))} / 5</p>
                      </div>
                      {review.comment ? (
                        <p className="text-sm text-[#D4C5B0]/90 leading-relaxed">{review.comment}</p>
                      ) : (
                        <p className="text-sm text-[#D4C5B0]/60 italic">Sin comentario</p>
                      )}
                    </div>
                  ))}
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
    </>
  );
}
