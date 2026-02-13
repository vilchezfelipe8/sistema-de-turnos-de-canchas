import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import BookingGrid from '../../components/BookingGrid';
import Navbar from '../../components/NavBar';
import { ClubService, Club } from '../../services/ClubService';

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
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center p-4 bg-[#347048] text-[#D4C5B0]">
      
      {/* FONDO AMBIENTAL (Luces traseras) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
      </div>

      {/* Contenido (Z-10 para que esté sobre el fondo) */}
      <div className="relative z-10 w-full flex flex-col items-center">
        <Navbar />
        
        <div className="w-full max-w-6xl mt-24 md:mt-20 mb-8 px-4">
          

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
            {/* Reservas: solo canchas y turnos de este club */}
            <BookingGrid clubSlug={slug} />

            {/* Info del club */}
            <div className="flex flex-col gap-6">
            {/* BLOQUE INFORMACIÓN */}
            <div className="bg-white/10 border border-white/20 rounded-3xl p-5 backdrop-blur shadow-[0_18px_40px_rgba(146,102,153,0.18)]">
              <h3 className="text-lg font-bold text-[#D4C5B0] mb-4">Información</h3>
              <div className="space-y-3 text-sm text-[#D4C5B0]/80">
                                
                {club.description && (
                  <p className="text-[#D4C5B0] font-semibold">{club.description}</p>
                )}

                {/* 📍 DIRECCIÓN -> GOOGLE MAPS */}
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(club.name + ' ' + formatClubAddress(club))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  // 👇 CAMBIO: hover:text-white (Texto blanco al pasar mouse)
                  className="flex items-start gap-2 font-bold hover:text-[#B9CF32] transition-colors group cursor-pointer"
                >
                  <span>📍</span>
                  {/* 👇 CAMBIO: decoration-white (Subrayado blanco) */}
                  <span className="group-hover:underline decoration-[#B9CF32] underline-offset-4">
                    {formatClubAddress(club)}
                  </span>
                </a>

                {/* 📞 TELÉFONO -> LLAMAR */}
                {club.phone && (
                  <a 
                    href={`tel:${club.phone.replace(/\s+/g, '')}`}
                    // 👇 CAMBIO: hover:text-white
                    className="flex items-start gap-2 font-bold hover:text-[#B9CF32] transition-colors group cursor-pointer"
                  >
                    <span>📞</span>
                    {/* 👇 CAMBIO: decoration-white */}
                    <span className="group-hover:underline decoration-[#B9CF32] underline-offset-4">
                      {club.phone}
                    </span>
                  </a>
                )}

                {/* ✉️ CONTACTO / EMAIL */}
                {club.contactInfo && (
                  <div className="flex items-center gap-2">
                    <span>✉️</span>
                    {club.contactInfo.includes('@') ? (
                      <a 
                        href={`mailto:${club.contactInfo}`}
                        // 👇 CAMBIO: hover:text-white y decoration-white
                        className="flex items-start gap-2 font-bold hover:text-[#B9CF32] transition-colors group cursor-pointer"
                      >
                        {club.contactInfo}
                      </a>
                    ) : (
                      <span>{club.contactInfo}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* BLOQUE SOCIAL (Este lo dejé igual, avisame si también querés el social en blanco) */}
            {(club.instagramUrl || club.facebookUrl || club.websiteUrl) && (
              <div className="bg-white/10 border border-white/20 rounded-3xl p-5 backdrop-blur shadow-[0_18px_40px_rgba(146,102,153,0.18)]">
                <h3 className="text-lg font-bold text-[#D4C5B0] mb-4">Social</h3>
                <div className="space-y-2">
                  {club.instagramUrl && (
                    <a
                      href={club.instagramUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-2 font-bold hover:text-[#B9CF32] transition-colors group cursor-pointer"
                    >
                      <span aria-hidden="true" className="inline-flex">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="5" />
                          <circle cx="12" cy="12" r="4" />
                          <circle cx="17" cy="7" r="1.2" fill="currentColor" stroke="none" />
                        </svg>
                      </span>
                      <span>{club.instagramUrl.replace(/^https?:\/\/(www\.)?(instagram\.com\/)?/, '@')}</span>
                    </a>
                  )}
                  {club.facebookUrl && (
                    <a
                      href={club.facebookUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[#D4C5B0]/80 hover:text-[#B9CF32] hover:underline decoration-[#B9CF32] transition-colors flex items-center gap-2"
                    >
                      <span aria-hidden="true" className="inline-flex">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                      </span>
                      <span>Facebook</span>
                    </a>
                  )}
                  {club.websiteUrl && (
                    <a
                      href={club.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[#D4C5B0]/80 hover:text-[#B9CF32] hover:underline decoration-[#B9CF32] transition-colors flex items-center gap-2"
                    >
                      <span aria-hidden="true" className="inline-flex">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="2" y1="12" x2="22" y2="12"/>
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                      </span>
                      <span>Sitio web</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        <footer className="mt-16 mb-8 text-center px-4 border-t border-white/10 pt-8 w-full max-w-6xl">
          <p className="text-xs text-[#D4C5B0]/70 font-medium">
            Sistema de Reservas 2026 v1.0 - Todos los derechos reservados
          </p>
        </footer>
      </div>
    </main>
  );
}
