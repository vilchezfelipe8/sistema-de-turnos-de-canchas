import BookingGrid from '../components/BookingGrid';
import Navbar from '../components/NavBar';

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center p-4">
      
      {/* FONDO AMBIENTAL (Luces traseras) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-lime-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-cyan-500/20 rounded-full blur-[128px]" />
      </div>

      {/* Contenido (Z-10 para que esté sobre el fondo) */}
      <div className="relative z-10 w-full flex flex-col items-center">
        <Navbar />
        
        <div className="w-full max-w-5xl mt-12 mb-8 px-4">
          <div className="text-center mb-12">
            
            {/* Título con Gradiente y Efecto */}
            <h1 className="text-5xl md:text-7xl font-black mb-4 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-lime-400 to-emerald-400 drop-shadow-lg">
              LAS TEJAS
            </h1>
            
            <div className="inline-block px-4 py-1 rounded-full border border-lime-500/30 bg-lime-500/10 backdrop-blur-md mb-6">
              <p className="text-xs md:text-sm font-bold text-lime-400 uppercase tracking-[0.2em]">
                Club de Padel & Amigos
              </p>
            </div>

            <p className="text-lg md:text-xl text-slate-400 font-medium max-w-2xl mx-auto">
              La experiencia deportiva del futuro. <span className="text-slate-200">Reserva tu cancha en segundos.</span>
            </p>
          </div>
        </div>
        
        {/* Grid de Reservas (Asegúrate de que este componente no tenga fondo blanco fijo) */}
        <div className="w-full max-w-4xl px-2">
          <BookingGrid />
        </div>
        
        <footer className="mt-16 mb-8 text-center px-4 border-t border-white/5 pt-8 w-full max-w-4xl">
          <p className="text-xs text-slate-500 font-medium">
            Sistema de Reservas <span className="text-lime-500 font-bold">NexGen v1.0</span>
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