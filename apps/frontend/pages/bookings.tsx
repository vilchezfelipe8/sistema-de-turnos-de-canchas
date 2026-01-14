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
    <div className="min-h-screen bg-slate-950">
      <Navbar />
      <div className="container mx-auto max-w-4xl p-4 lg:p-8 pt-28 lg:pt-32">
        
        <div className="mb-10 flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-lime-400">
             <span className="text-3xl">📅</span>
          </div>
          <div>
            <h1 className="text-3xl lg:text-4xl font-black text-white tracking-tight">Mis Reservas</h1>
            <p className="text-slate-400">Historial de partidos y próximos encuentros</p>
          </div>
        </div>

        {loading && <div className="space-y-4">{[1,2].map(i => <div key={i} className="h-28 bg-slate-900/50 rounded-2xl animate-pulse border border-slate-800"></div>)}</div>}
        
        {error && <div className="p-4 bg-red-900/20 border border-red-500/50 text-red-200 rounded-xl">{error}</div>}

        {!loading && bookings.length === 0 && !error && (
            <div className="text-center py-20 bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl">
                <div className="text-7xl mb-4 opacity-50">🎾</div>
                <h3 className="text-xl font-bold text-white mb-2">Sin partidos registrados</h3>
                <p className="text-slate-500 mb-6">El court te está esperando.</p>
                <a href="/" className="px-6 py-3 bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold rounded-xl transition-all">Reservar Ahora</a>
            </div>
        )}

        <div className="space-y-4">
          {bookings.map((booking) => {
             const date = new Date(booking.startDateTime);
             const isCancelled = booking.status === 'CANCELLED';
             const isCompleted = booking.status === 'COMPLETED';
             
             const hours = date.getUTCHours().toString().padStart(2, '0');
             const minutes = date.getUTCMinutes().toString().padStart(2, '0');
             const argentinaTimeStr = `${hours}:${minutes}`;
             const argentinaMonthStr = date.toLocaleString('es-AR', { month: 'short', timeZone: 'UTC' }).toUpperCase();
             const argentinaDay = date.getUTCDate();
             
             return (
                <div key={booking.id} className={`group relative bg-slate-900/60 backdrop-blur-md rounded-2xl p-0 overflow-hidden border transition-all hover:border-slate-600 ${isCancelled ? 'border-red-900/50 opacity-60' : isCompleted ? 'border-blue-900/50' : 'border-slate-800'}`}>
                  
                  {/* Indicador lateral neón */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${isCancelled ? 'bg-red-500' : isCompleted ? 'bg-blue-500' : 'bg-lime-500 shadow-[0_0_15px_rgba(132,204,22,0.5)]'}`}></div>

                  <div className="flex flex-col sm:flex-row p-5 sm:pl-8 gap-5 items-center">
                    
                    {/* Fecha estilo "Ticket" */}
                    <div className="flex flex-col items-center justify-center bg-slate-950 rounded-xl p-3 min-w-[80px] border border-slate-800">
                        <span className="text-[10px] font-bold text-slate-500 tracking-widest">{argentinaMonthStr}</span>
                        <span className={`text-3xl font-black ${isCancelled ? 'text-red-500' : 'text-white'}`}>{argentinaDay}</span>
                    </div>

                    {/* Detalles */}
                    <div className="flex-1 text-center sm:text-left">
                        <h3 className="font-bold text-xl text-white mb-1">
                            {booking.court?.name || 'Cancha'}
                            {isCancelled && <span className="ml-3 text-[10px] border border-red-500 text-red-500 px-2 py-0.5 rounded uppercase tracking-wider">Cancelado</span>}
                            {isCompleted && <span className="ml-3 text-[10px] border border-blue-500 text-blue-500 px-2 py-0.5 rounded uppercase tracking-wider">Finalizado</span>}
                        </h3>
                        <p className="text-slate-400 font-medium flex items-center justify-center sm:justify-start gap-2">
                           <span className={isCancelled ? 'text-slate-600' : 'text-lime-400'}>⏰</span> {argentinaTimeStr} hs
                        </p>
                    </div>

                    {/* Botón de Cancelar */}
                    {!isCancelled && !isCompleted && (
                      <button onClick={() => handleCancel(booking.id)}
                        className="w-full sm:w-auto px-4 py-2 text-sm font-bold text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg hover:bg-red-900/50 hover:text-red-200 transition-colors">
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
             );
          })}
        </div>
      </div>
    </div>
  );
}