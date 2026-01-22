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
        // Redirigir al admin del club del usuario
        if (user?.clubId) {
          loadUserClub(user.clubId, true);
        } else {
          router.replace('/admin');
        }
        return;
      }
      // Si el usuario tiene un club, redirigir a su página
      if (user?.clubId) {
        loadUserClub(user.clubId);
      }
    } catch {
      // noop
    }
  }, [router]);

  const loadUserClub = async (clubId: number, isAdmin = false) => {
    try {
      const club = await ClubService.getClubById(clubId);
      setUserClub(club);
      // Redirigir a la página del club o admin según corresponda
      if (isAdmin) {
        router.push(`/club/${club.slug}/admin`);
      } else {
        router.push(`/club/${club.slug}`);
      }
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
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center p-4">
      
      {/* FONDO AMBIENTAL (Luces traseras) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }} />
      </div>

      {/* Contenido (Z-10 para que esté sobre el fondo) */}
      <div className="relative z-10 w-full flex flex-col items-center">
        <Navbar />
        
        <div className="w-full max-w-4xl mt-12 mb-8 px-4">
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-black text-emerald-400 tracking-tight mb-2">Sistema de Reservas</h1>
            <p className="text-muted">Selecciona tu club para continuar</p>
          </div>

          {loadingClubs ? (
            <div className="bg-surface-70 border border-border rounded-3xl p-8">
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
            <div className="bg-surface-70 border border-border rounded-3xl p-8 text-center">
              <p className="text-muted">No hay clubes disponibles</p>
            </div>
          )}
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