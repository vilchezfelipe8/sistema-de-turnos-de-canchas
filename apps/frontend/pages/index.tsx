import { useEffect } from 'react';
import { useRouter } from 'next/router';
import BookingGrid from '../components/BookingGrid';
import Navbar from '../components/NavBar';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!userStr) return;
    try {
      const user = JSON.parse(userStr);
      if (user?.role === 'ADMIN') {
        router.replace('/admin');
      }
    } catch {
      // noop
    }
  }, [router]);

  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center p-4">
      
      {/* FONDO AMBIENTAL (Luces traseras) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }} />
      </div>

      {/* Contenido (Z-10 para que esté sobre el fondo) */}
      <div className="relative z-10 w-full flex flex-col items-center">
        <Navbar />
        
        <div className="w-full max-w-6xl mt-12 mb-8 px-4">

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
            {/* Reservas */}
            <BookingGrid />

            {/* Info del club */}
            <div className="flex flex-col gap-6">
              <div className="bg-surface-70 border border-border rounded-3xl p-5">
                <h3 className="text-lg font-bold text-text mb-4">Información</h3>
                <div className="space-y-3 text-sm text-muted">
                  <p className="text-text font-semibold">Complejo deportivo Las Tejas Pádel</p>
                  <div className="flex items-start gap-2">
                    <span>📍</span>
                    <a href="https://www.google.com/maps/search/?api=1&query=Sarmiento%2060,%20Río%20Tercero,%20Córdoba" target="_blank" rel="noopener noreferrer" className="cursor-pointer hover:underline text-text">
                      Sarmiento 60, Río Tercero, Córdoba
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>📞</span>
                    <a href="tel:+5493571359791" className="cursor-pointer hover:underline text-text">
                      +54 9 357 135 9791
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>🎾</span>
                    <span>Pádel</span>
                  </div>
                </div>
              </div>

              <div className="bg-surface-70 border border-border rounded-3xl p-5">
                <h3 className="text-lg font-bold text-text mb-4">Social</h3>
                <a
                  href="https://www.instagram.com/lastejaspadel/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted hover:text-text hover:underline transition-colors flex items-center gap-2"
                >
                  <span aria-hidden="true" className="inline-flex">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17" cy="7" r="1.2" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                  <span>@lastejaspadel</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-16 mb-8 text-center px-4 border-t border-white/5 pt-8 w-full max-w-6xl">
          <p className="text-xs text-muted font-medium">
            Sistema de Reservas 2026 v1.0 - Todos los derechos reservados
          </p>
        </footer>
      </div>
    </main>
  );
}