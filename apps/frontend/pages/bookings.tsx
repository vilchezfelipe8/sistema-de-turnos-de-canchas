import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/NavBar';
import PageShell from '../components/PageShell';
import { getMyBookings, cancelBooking } from '../services/BookingService';
import { ClubService } from '../services/ClubService';
import AppModal from '../components/AppModal';

export default function MyBookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: string;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
    onConfirm?: () => Promise<void> | void;
  }>({ show: false });

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined }));
  };

  const showError = (message: string) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar'
    });
  };

  const showConfirm = (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isWarning?: boolean;
    onConfirm: () => Promise<void> | void;
  }) => {
    setModalState({
      show: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? 'Aceptar',
      cancelText: options.cancelText ?? 'Cancelar',
      isWarning: options.isWarning ?? true,
      onConfirm: async () => {
        closeModal();
        await options.onConfirm();
      }
    });
  };

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!token || !userStr) {
      router.replace('/login');
      return;
    }
    try {
      const user = JSON.parse(userStr);
      if (user?.role === 'ADMIN' && user?.clubId) {
        // Redirigir al admin del club del usuario
        const club = await ClubService.getClubById(user.clubId);
        router.replace(`/club/${club.slug}/admin`);
        return;
      }
    } catch {
      // noop
    }
    setAuthChecked(true);
  }, [router]);

  const loadData = async () => {
    try {
      const userStr = localStorage.getItem('user');
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

  useEffect(() => {
    if (!authChecked) return;
    loadData();
  }, [authChecked]);

  const handleCancel = async (id: number) => {
    showConfirm({
      title: 'Cancelar turno',
      message: '¿Seguro que querés cancelar esta reserva?',
      confirmText: 'Cancelar reserva',
      onConfirm: async () => {
        try {
          await cancelBooking(id);
          loadData();
        } catch (e: any) {
          showError('❌ ' + e.message);
        }
      }
    });
  };

  if (!authChecked) {
    return null;
  }

  return (
    <PageShell title="Mis Reservas" subtitle="Historial de partidos y próximos encuentros">
      {loading && <div className="space-y-4">{[1,2].map(i => <div key={i} className="h-28 bg-surface-70 rounded-2xl animate-pulse border border-border"></div>)}</div>}

      {error && <div className="p-4 bg-surface-70 border border-border text-muted rounded-xl">{error}</div>}

      {(!loading && bookings.length === 0 && !error) && (
        <div className="text-center py-20 bg-surface-70 border border-dashed border-border rounded-3xl">
          <div className="text-7xl mb-4 opacity-50">🎾</div>
          <h3 className="text-xl font-bold text-text mb-2">Sin partidos registrados</h3>
          <p className="text-muted mb-6">La cancha te está esperando.</p>
          <a href="/" className="px-6 py-3 btn btn-primary">Reservar Ahora</a>
        </div>
      )}

      <div className="space-y-4">
        {bookings.map((booking) => {
          const date = new Date(booking.startDateTime);
          const isCancelled = booking.status === 'CANCELLED';
          const isCompleted = booking.status === 'COMPLETED';
          const statusColor = isCancelled ? '#ef4444' : '#22c55e';

          const argentinaTimeStr = date.toLocaleTimeString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          const argentinaMonthStr = date
            .toLocaleString('es-AR', { month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
            .toUpperCase();
          const argentinaDay = Number(
            date.toLocaleString('es-AR', { day: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
          );

          return (
            <div
              key={booking.id}
              className="group relative bg-surface-70 backdrop-blur-md rounded-2xl p-0 overflow-hidden border border-border transition-all"
              style={{ borderColor: 'var(--border)', opacity: isCancelled ? 0.6 : 1 }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-1.5"
                style={{ backgroundColor: statusColor, boxShadow: `0 0 10px ${statusColor}33` }}
              ></div>

              <div className="flex flex-col sm:flex-row p-5 sm:pl-8 gap-5 items-center">
                <div className="flex flex-col items-center justify-center bg-surface rounded-xl p-3 min-w-[80px] border border-border">
                  <span className="text-[10px] font-bold text-muted tracking-widest">{argentinaMonthStr}</span>
                  <span className={`text-3xl font-black ${isCancelled ? 'text-muted' : 'text-text'}`}>{argentinaDay}</span>
                </div>

                <div className="flex-1 text-center sm:text-left">
                  <h3 className="font-bold text-xl text-text mb-1">
                    {booking.court?.name || 'Cancha'}
                    {isCancelled && (
                      <span className="ml-3 text-[10px] border border-red-500/40 text-red-400 bg-red-500/10 px-2 py-0.5 rounded uppercase tracking-wider">
                        Cancelado
                      </span>
                    )}
                    {isCompleted && (
                      <span className="ml-3 text-[10px] border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded uppercase tracking-wider">
                        Finalizado
                      </span>
                    )}
                  </h3>
                  <p className="text-muted font-medium flex items-center justify-center sm:justify-start gap-2">
                    <span className={isCancelled ? 'text-muted' : 'text-text'}>⏰</span> {argentinaTimeStr} hs
                  </p>
                </div>

                {!isCancelled && !isCompleted && (
                  <button
                    onClick={() => handleCancel(booking.id)}
                    className="w-full sm:w-auto px-4 py-2 text-sm font-bold btn btn-danger"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <AppModal
        show={modalState.show}
        onClose={closeModal}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm}
      />
    </PageShell>
  );
}