import BookingGrid from '../components/BookingGrid';
import Navbar from '../components/NavBar';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 flex flex-col items-center p-3 sm:p-4">
      <Navbar />
      
      <div className="w-full max-w-4xl mt-4 sm:mt-8 mb-4 sm:mb-8 px-2">
        <div className="text-center mb-6 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-gray-900 mb-2 tracking-tight">
            LAS TEJAS
          </h1>
          <p className="text-xs sm:text-sm font-bold text-orange-700 uppercase tracking-widest mb-2 sm:mb-4">
            CLUB DE PADEL Y AMIGOS
          </p>
          <p className="text-sm sm:text-base lg:text-lg text-gray-700 font-medium px-2">
            Reserva tu cancha favorita de forma rápida y sencilla
          </p>
        </div>
      </div>
      
      {/* Aquí insertamos nuestro nuevo componente */}
      <div className="w-full max-w-2xl px-2">
        <BookingGrid />
      </div>
      
      <footer className="mt-8 sm:mt-12 mb-4 sm:mb-6 text-center px-2">
        <p className="text-xs sm:text-sm font-medium text-gray-600">
          Sistema de Reservas <span className="text-orange-600 font-bold">v1.0</span>
        </p>
        <div className="flex justify-center gap-2 mt-2">
          <span className="text-xl sm:text-2xl">🏓</span>
          <span className="text-xl sm:text-2xl">🔥</span>
          <span className="text-xl sm:text-2xl">👥</span>
        </div>
      </footer>
    </main>
  );
}