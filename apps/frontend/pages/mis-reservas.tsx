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
    <div className="min-h-screen bg-slate-50 font-sans">
      <Navbar />
      <div className="container mx-auto max-w-4xl p-6">
        <h1 className="text-3xl font-extrabold text-slate-800 mb-6 flex items-center gap-3">
          📅 Mis Reservas
        </h1>

        {loading && (
             <div className="space-y-4">
                 {[1,2].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl animate-pulse"></div>)}
             </div>
        )}
        
        {error && <div className="p-4 bg-red-100 text-red-700 rounded-xl">{error}</div>}

        {!loading && bookings.length === 0 && !error && (
            <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-gray-100">
                <div className="text-6xl mb-4">🎾</div>
                <h3 className="text-xl font-bold text-gray-700">Aún no tienes partidos</h3>
                <p className="text-gray-500 mb-6">¡Reserva tu primer turno hoy!</p>
                <a href="/" className="px-6 py-2 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-700">Ir al inicio</a>
            </div>
        )}

        <div className="space-y-4">
          {bookings.map((booking) => {
             const date = new Date(booking.startDateTime);
             const isCancelled = booking.status === 'CANCELLED';
             
             return (
                <div key={booking.id} className={`group relative bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-all border border-gray-100 overflow-hidden flex flex-col sm:flex-row justify-between items-center ${isCancelled ? 'opacity-75 grayscale-[50%]' : ''}`}>
                  
                  {/* Borde de color lateral según estado */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${isCancelled ? 'bg-red-400' : 'bg-green-500'}`}></div>

                  <div className="flex items-center gap-6 mb-4 sm:mb-0 w-full">
                    {/* Cajita de Fecha */}
                    <div className="flex flex-col items-center justify-center bg-gray-50 rounded-xl p-3 min-w-[80px] border border-gray-100">
                        <span className="text-xs font-bold text-gray-500 uppercase">{date.toLocaleString('es-AR', { month: 'short' })}</span>
                        <span className="text-2xl font-black text-slate-800">{date.getDate()}</span>
                    </div>

                    {/* Info */}
                    <div>
                        <h3 className="font-bold text-lg text-slate-800">
                            {booking.court?.name || 'Cancha'}
                            {isCancelled && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">CANCELADO</span>}
                        </h3>
                        <p className="text-slate-500 font-medium flex items-center gap-1">
                           ⏰ {date.toLocaleTimeString('es-AR', {hour: '2-digit', minute:'2-digit'})} hs
                        </p>
                    </div>
                  </div>
                  
                  {/* Botón Acción */}
                  {!isCancelled && (
                    <button 
                      onClick={() => handleCancel(booking.id)}
                      className="w-full sm:w-auto px-4 py-2 text-sm font-bold text-red-500 bg-red-50 border border-red-100 rounded-lg hover:bg-red-500 hover:text-white transition-colors"
                    >
                      Cancelar
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