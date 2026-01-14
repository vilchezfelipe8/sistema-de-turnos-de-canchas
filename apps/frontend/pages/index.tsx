import BookingGrid from '../components/BookingGrid';
import Navbar from '../components/NavBar';

export default function Home() {
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
        
        <div className="w-full max-w-5xl mt-12 mb-8 px-4">
          <div className="text-center mb-12">
            
          </div>
        </div>
        
        {/* Grid de Reservas (Asegúrate de que este componente no tenga fondo blanco fijo) */}
        <div className="w-full max-w-4xl px-2">
          <BookingGrid />
        </div>
        
        <footer className="mt-16 mb-8 text-center px-4 border-t border-white/5 pt-8 w-full max-w-4xl">
          <p className="text-xs text-muted font-medium">
            Sistema de Reservas <span className="font-bold">NexGen v1.0</span>
          </p>
          <div className="flex justify-center gap-4 mt-4 opacity-50">
            <span className="text-xl">🏓</span>
            <span className="text-xl">⚡</span>
            <span className="text-xl">🌐</span>
          </div>
        </footer>
      </div>
    </main>
  );
}