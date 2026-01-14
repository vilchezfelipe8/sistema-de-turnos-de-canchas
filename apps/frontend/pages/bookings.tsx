import { useEffect, useState } from 'react';
import Navbar from '../components/NavBar';
import PageShell from '../components/PageShell';
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
    <PageShell title="Mis Reservas" subtitle="Historial de partidos y próximos encuentros">
      {loading && <div className="space-y-4">{[1,2].map(i => <div key={i} className="h-28 bg-surface-70 rounded-2xl animate-pulse border border-border"></div>)}</div>}

      {error && <div className="p-4 bg-surface-70 border border-border text-muted rounded-xl">{error}</div>}

      {(!loading && bookings.length === 0 && !error) && (
        <div className="text-center py-20 bg-surface-70 border border-dashed border-border rounded-3xl">
          <div className="text-7xl mb-4 opacity-50">🎾</div>
          <h3 className="text-xl font-bold text-text mb-2">Sin partidos registrados</h3>
          <p className="text-muted mb-6">El court te está esperando.</p>
          <a href="/" className="px-6 py-3 btn btn-primary">Reservar Ahora</a>
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
            <div key={booking.id} className={`group relative bg-surface-70 backdrop-blur-md rounded-2xl p-0 overflow-hidden border transition-all`} style={{ borderColor: 'var(--border)', opacity: isCancelled ? 0.6 : 1 }}>
              <div className={`absolute left-0 top-0 bottom-0 w-1.5`} style={{ backgroundColor: isCancelled ? 'var(--muted)' : isCompleted ? 'var(--muted-2)' : 'var(--text)', boxShadow: '0 0 8px rgba(255,255,255,0.04)' }}></div>

              <div className="flex flex-col sm:flex-row p-5 sm:pl-8 gap-5 items-center">
                <div className="flex flex-col items-center justify-center bg-surface rounded-xl p-3 min-w-[80px] border border-border">
                  <span className="text-[10px] font-bold text-muted tracking-widest">{argentinaMonthStr}</span>
                  <span className={`text-3xl font-black ${isCancelled ? 'text-muted' : 'text-text'}`}>{argentinaDay}</span>
                </div>

                <div className="flex-1 text-center sm:text-left">
                  <h3 className="font-bold text-xl text-text mb-1">
                    {booking.court?.name || 'Cancha'}
                    {isCancelled && <span className="ml-3 text-[10px] border border-soft text-muted px-2 py-0.5 rounded uppercase tracking-wider">Cancelado</span>}
                    {isCompleted && <span className="ml-3 text-[10px] border border-soft text-muted px-2 py-0.5 rounded uppercase tracking-wider">Finalizado</span>}
                  </h3>
                  <p className="text-muted font-medium flex items-center justify-center sm:justify-start gap-2">
                    <span className={isCancelled ? 'text-muted' : 'text-text'}>⏰</span> {argentinaTimeStr} hs
                  </p>
                </div>

                {!isCancelled && !isCompleted && (
                  <button onClick={() => handleCancel(booking.id)}
                    className="w-full sm:w-auto px-4 py-2 text-sm font-bold btn">
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}