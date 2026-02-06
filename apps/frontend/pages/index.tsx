import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/NavBar';
import { ClubService, Club } from '../services/ClubService';

export default function Home() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [userClub, setUserClub] = useState<Club | null>(null);

  useEffect(() => {
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!userStr) return;
    try {
      const user = JSON.parse(userStr);
      if (user?.role === 'ADMIN') {
        return;
      }
      if (user?.clubId) {
        loadUserClub(user.clubId);
      }
    } catch {
      // noop
    }
  }, [router]);

  const loadUserClub = async (clubId: number) => {
    try {
      const club = await ClubService.getClubById(clubId);
      setUserClub(club);
      router.push(`/club/${club.slug}`);
    } catch (error) {
      console.error('Error al cargar el club del usuario:', error);
    }
  };

  useEffect(() => {
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

  return (
    <main
      className="min-h-screen text-text relative overflow-hidden"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      {/* Fondo ambiental (luces) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div
          className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]"
          style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]"
          style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
        />
      </div>

      <div className="relative z-10">
        <Navbar />

        <div className="container mx-auto max-w-6xl p-4 lg:p-8 pt-28 lg:pt-32">
          <div className="mx-auto w-full max-w-4xl bg-surface-70 rounded-3xl p-8 border border-border shadow-soft">
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-black text-emerald-400 tracking-tight mb-2">
                Sistema de Reservas
              </h1>
              <p className="text-muted">Selecciona tu club para continuar</p>
            </div>

            {loadingClubs ? (
              <div className="border border-border rounded-3xl p-8">
                <div className="animate-pulse space-y-4">
                  <div className="h-6 bg-surface-50 rounded w-3/4 mx-auto"></div>
                  <div className="h-20 bg-surface-50 rounded w-full"></div>
                  <div className="h-20 bg-surface-50 rounded w-full"></div>
                </div>
              </div>
            ) : clubs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {clubs.map((club) => (
                  <button
                    key={club.id}
                    onClick={() => router.push(`/club/${club.slug}`)}
                    className="bg-surface-70 border border-border rounded-3xl p-6 hover:bg-surface-60 transition-all text-left group"
                  >
                    <h3 className="text-xl font-bold text-text mb-2 group-hover:text-emerald-400 transition-colors">
                      {club.name}
                    </h3>
                    {club.description && (
                      <p className="text-sm text-muted mb-3 line-clamp-2">{club.description}</p>
                    )}
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>📍</span>
                      <span className="truncate">{club.address}</span>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-emerald-400 text-sm font-semibold">
                      <span>Ver club</span>
                      <span>→</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="border border-border rounded-3xl p-8 text-center">
                <p className="text-muted">No hay clubes disponibles</p>
              </div>
            )}
          </div>

          <footer className="mt-8 text-center border-t border-white/5 pt-6">
            <p className="text-xs text-muted font-medium">
              Sistema de Reservas 2026 v1.0 - Todos los derechos reservados
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}