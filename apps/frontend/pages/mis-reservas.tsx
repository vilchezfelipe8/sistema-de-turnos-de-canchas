import { useEffect, useState } from 'react';
import Navbar from '../components/NavBar';
import { getMyBookings, cancelBooking } from '../services/BookingService';

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = async () => {
    try {
      const userStr = localStorage.getItem('user');
      const token = localStorage.getItem('token');
      if (!token) { window.location.href = '/login'; return; }
      if (!userStr) throw new Error("Datos de usuario no encontrados.");
      
      const user = JSON.parse(userStr);
      const userId = user.id || user.userId;

      const data = await getMyBookings(userId);
      // Ordenamos por fecha (más reciente primero)
      setBookings(data.sort((a:any, b:any) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime()));

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCancel = async (id: number) => {
    if (!confirm('¿Seguro que quieres cancelar?')) return;
    try {
      await cancelBooking(id);
      loadData();
    } catch (e: any) {
      alert("❌ " + e.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 font-sans">
      <Navbar />
      <div className="container mx-auto max-w-4xl p-3 sm:p-4 lg:p-6">
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-gray-900 mb-2 flex items-center gap-2 sm:gap-3">
            <span className="text-3xl sm:text-4xl lg:text-5xl">📅</span>
            <span>Mis Reservas e Historial</span>
          </h1>
          <p className="text-sm sm:text-base text-gray-600 font-medium ml-0 sm:ml-12 lg:ml-16">Gestiona tus reservas activas y revisa tu historial</p>
        </div>

        {loading && (
             <div className="space-y-4">
                 {[1,2].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse"></div>)}
             </div>
        )}
        
        {error && <div className="p-4 bg-red-100 text-red-700 rounded-xl">{error}</div>}

        {!loading && bookings.length === 0 && !error && (
            <div className="text-center py-20 bg-white/80 backdrop-blur-lg rounded-2xl shadow-xl border-2 border-white/50">
                <div className="text-7xl mb-6 animate-bounce">🎾</div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  Aún no tienes partidos
                </h3>
                <p className="text-gray-600 mb-8 font-medium">¡Reserva tu primer turno hoy!</p>
                <a 
                  href="/" 
                  className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-full font-bold hover:from-orange-700 hover:to-amber-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  <span>🏠</span>
                  <span>Ir al inicio</span>
                </a>
            </div>
        )}

        <div className="space-y-4">
          {bookings.map((booking) => {
             // El backend guarda las fechas en UTC pero interpretando las horas como "hora de Argentina"
             // Por ejemplo, si guardamos 22:00, se guarda como 22:00 UTC (no como 01:00 UTC)
             // Por lo tanto, para mostrar, debemos interpretar la hora UTC directamente como hora de Argentina
             const date = new Date(booking.startDateTime);
             const isCancelled = booking.status === 'CANCELLED';
             const isCompleted = booking.status === 'COMPLETED';
             
             // Las fechas están guardadas en UTC pero representan hora de Argentina directamente
             // Por lo tanto, mostramos la hora UTC directamente (sin conversión de zona horaria)
             const hours = date.getUTCHours().toString().padStart(2, '0');
             const minutes = date.getUTCMinutes().toString().padStart(2, '0');
             const argentinaTimeStr = `${hours}:${minutes}`;
             
             const argentinaMonthStr = date.toLocaleString('es-AR', { month: 'short', timeZone: 'UTC' });
             const argentinaDay = date.getUTCDate();
             
             return (
                <div key={booking.id} className={`group relative bg-white/90 backdrop-blur-lg rounded-2xl p-4 sm:p-6 shadow-lg hover:shadow-xl transition-all border-2 ${isCancelled ? 'border-red-200 opacity-75' : isCompleted ? 'border-blue-200 opacity-90' : 'border-green-200'} overflow-hidden flex flex-col sm:flex-row justify-between items-center gap-4 ${isCancelled ? 'grayscale-[30%]' : ''}`}>
                  
                  {/* Borde de color lateral según estado */}
                  <div className={`absolute left-0 top-0 bottom-0 w-2 ${isCancelled ? 'bg-gradient-to-b from-red-400 to-red-600' : isCompleted ? 'bg-gradient-to-b from-blue-400 to-blue-600' : 'bg-gradient-to-b from-green-400 to-emerald-600'}`}></div>

                  <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 w-full sm:flex-1">
                    {/* Cajita de Fecha */}
                    <div className="flex flex-col items-center justify-center bg-gradient-to-br from-orange-100 to-amber-100 rounded-xl p-3 sm:p-4 min-w-[70px] sm:min-w-[80px] lg:min-w-[90px] border-2 border-orange-200 shadow-sm">
                        <span className="text-[10px] sm:text-xs font-bold text-orange-700 uppercase">{argentinaMonthStr}</span>
                        <span className="text-2xl sm:text-3xl font-black text-orange-700">{argentinaDay}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-base sm:text-lg text-slate-800 truncate">
                            {booking.court?.name || 'Cancha'}
                            {isCancelled && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">CANCELADO</span>}
                            {isCompleted && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">COMPLETADO</span>}
                        </h3>
                        <p className="text-sm sm:text-base text-slate-500 font-medium flex items-center gap-1">
                           ⏰ {argentinaTimeStr} hs
                        </p>
                    </div>
                  </div>
                  
                  {/* Botón Acción */}
                  {!isCancelled && !isCompleted && (
                    <button 
                      onClick={() => handleCancel(booking.id)}
                      className="w-full sm:w-auto px-4 sm:px-5 py-2 sm:py-2.5 text-sm font-bold text-white bg-gradient-to-r from-red-500 to-red-600 border-2 border-red-400 rounded-xl hover:from-red-600 hover:to-red-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-2 justify-center"
                    >
                      <span>🗑️</span>
                      <span>Cancelar</span>
                    </button>
                  )}
                </div>
             );
          })}
        </div>
      </div>
    </div>
  );
}