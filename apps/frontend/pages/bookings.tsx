import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/NavBar';
import { getMyBookings, cancelBooking } from '../services/BookingService';
import AppModal from '../components/AppModal';
import { useValidateAuth } from '../hooks/useValidateAuth';
import Link from 'next/link';

export default function MyBookingsPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth();
  const [bookings, setBookings] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'PAST' | 'CANCELLED'>('ACTIVE');
  const [selectedBooking, setSelectedBooking] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: string;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
    onConfirm?: () => Promise<void> | void;
  }>({ show: false });
  const tabRefs = useRef<Record<'ACTIVE' | 'PAST' | 'CANCELLED', HTMLButtonElement | null>>({
    ACTIVE: null,
    PAST: null,
    CANCELLED: null
  });
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });

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

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const userId = user.id;

      const data = await getMyBookings(userId);
      setBookings(data.sort((a:any, b:any) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime()));

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authChecked || !user) return;
    loadData();
  }, [authChecked, user, loadData]);

  const { activeBookings, pastBookings, cancelledBookings } = useMemo(() => {
    const now = new Date();
    const active: any[] = [];
    const past: any[] = [];
    const cancelled: any[] = [];

    bookings.forEach((booking) => {
      const isCancelled = booking.status === 'CANCELLED';
      const endDate = booking.endDateTime ? new Date(booking.endDateTime) : new Date(booking.startDateTime);
      const isPastByDate = endDate.getTime() < now.getTime();
      const isPast = booking.status === 'COMPLETED' || isPastByDate;

      if (isCancelled) {
        cancelled.push(booking);
      } else if (isPast) {
        past.push(booking);
      } else {
        active.push(booking);
      }
    });

    return { activeBookings: active, pastBookings: past, cancelledBookings: cancelled };
  }, [bookings]);

  const visibleBookings = useMemo(() => {
    if (activeTab === 'PAST') return pastBookings;
    if (activeTab === 'CANCELLED') return cancelledBookings;
    return activeBookings;
  }, [activeTab, activeBookings, pastBookings, cancelledBookings]);

  useEffect(() => {
    const updateIndicator = () => {
      const activeEl = tabRefs.current[activeTab];
      if (!activeEl) return;
      setTabIndicator({ left: activeEl.offsetLeft, width: activeEl.offsetWidth });
    };
    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeTab]);

  useEffect(() => {
    if (selectedBooking && !bookings.some((booking) => booking.id === selectedBooking.id)) {
      setSelectedBooking(null);
    }
  }, [bookings, selectedBooking]);

  const formatDayLabel = (date: Date) =>
    date.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      timeZone: 'America/Argentina/Buenos_Aires'
    });

  const formatWeekday = (date: Date) =>
    date
      .toLocaleDateString('es-AR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires'
      })
      .replace(/^\w/, (char) => char.toUpperCase());

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

  const getDurationMinutes = (booking: any) => {
    if (booking.endDateTime) {
      const start = new Date(booking.startDateTime).getTime();
      const end = new Date(booking.endDateTime).getTime();
      const diff = Math.max(0, Math.round((end - start) / 60000));
      if (diff) return diff;
    }
    return booking.activity?.defaultDurationMinutes || 60;
  };

  const formatCurrency = (value: number) =>
    value.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 });

  const getConsumptionTotal = (booking: any) => {
    if (!Array.isArray(booking.items)) return 0;
    return booking.items.reduce((total: number, item: any) => {
      const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
      return total + itemTotal;
    }, 0);
  };

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

  if (!authChecked || !user) return null;

  return (
    <div className="min-h-screen relative overflow-x-hidden bg-[#347048] text-[#D4C5B0] selection:bg-[#B9CF32] selection:text-[#347048]">
      <Navbar />
      <div className="container mx-auto max-w-6xl px-4 lg:px-8 pt-28 lg:pt-32 pb-20">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-black text-[#D4C5B0] mb-2">Mis Reservas</h1>
          <p className="text-[#D4C5B0]/80">Historial de partidos y próximos encuentros</p>
        </div>
      {loading && (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 bg-surface-70 rounded-2xl animate-pulse border border-border"></div>
          ))}
        </div>
      )}

      {error && <div className="p-4 bg-surface-70 border border-border text-muted rounded-xl">{error}</div>}

      {!loading && bookings.length === 0 && !error && (
        <div className="text-center py-20 bg-surface-70 border border-dashed border-border rounded-3xl">
          <div className="text-7xl mb-4 opacity-50">🎾</div>
          <h3 className="text-xl font-bold text-text mb-2">Sin partidos registrados</h3>
          <p className="text-muted mb-6">La cancha te está esperando.</p>
          <Link href="/" className="px-6 py-3 btn btn-primary">Reservar Ahora</Link>
        </div>
      )}

      {!loading && bookings.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="bg-white rounded-3xl shadow-lg border border-black/5 overflow-hidden">
            <div className="px-8 pt-8 pb-4 text-center">
              <h2 className="text-3xl font-black text-[#2b3a4a]">Mis Reservas</h2>
              <div className="mx-auto mt-3 h-1 w-20 rounded-full bg-[#926699]" />
              <div className="mt-6 grid grid-cols-3 text-sm font-bold text-[#7c8aa0] relative">
                <span
                  className="absolute bottom-0 h-[2px] bg-[#0bbd49] rounded-full transition-all duration-300"
                  style={{ left: tabIndicator.left, width: tabIndicator.width }}
                />
                {(['ACTIVE', 'PAST', 'CANCELLED'] as const).map((tab) => (
                  <button
                    key={tab}
                    ref={(el) => {
                      tabRefs.current[tab] = el;
                    }}
                    onClick={() => setActiveTab(tab)}
                    className={`pb-3 border-b-2 transition-colors ${
                      activeTab === tab
                        ? 'text-[#0bbd49] border-transparent'
                        : 'border-transparent hover:text-[#2b3a4a]'
                    }`}
                  >
                    {tab === 'ACTIVE' ? 'ACTIVAS' : tab === 'PAST' ? 'PASADAS' : 'CANCELADAS'}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 pb-8">
              {visibleBookings.length === 0 ? (
                <div className="text-center py-16 text-[#2b3a4a]/70">
                  <div className="text-6xl mb-4">📝</div>
                  <p className="text-lg font-semibold">
                    {activeTab === 'CANCELLED'
                      ? 'No tienes reservas canceladas'
                      : activeTab === 'PAST'
                      ? 'No tienes reservas pasadas'
                      : 'No tienes reservas activas'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {visibleBookings.map((booking) => {
                    const date = new Date(booking.startDateTime);
                    const dayLabel = formatDayLabel(date).split(' ');
                    const dayNumber = dayLabel[0];
                    const monthLabel = dayLabel[1]?.toLowerCase();
                    const duration = getDurationMinutes(booking);
                    const spentTotal = Number(booking.price || 0);
                    const consumptionTotal = getConsumptionTotal(booking);

                    return (
                      <button
                        key={booking.id}
                        onClick={() => setSelectedBooking(booking)}
                        className={`w-full text-left rounded-3xl border transition-shadow ${
                          selectedBooking?.id === booking.id
                            ? 'border-[#0bbd49] shadow-lg shadow-[#926699]/30'
                            : 'border-[#d7dde5] hover:shadow-md'
                        }`}
                      >
                        <div className="flex gap-5 p-6 items-center">
                          <div className={`min-w-[84px] rounded-2xl px-4 py-5 text-center font-bold ${
                            activeTab === 'ACTIVE'
                              ? 'bg-[#16a34a] text-white'
                              : activeTab === 'CANCELLED'
                              ? 'bg-[#ef4444] text-white'
                              : 'bg-[#d9dde2] text-[#2b3a4a]'
                          }`}>
                            <div className="text-2xl font-black leading-none">{dayNumber}</div>
                            <div className="text-sm uppercase tracking-wide">{monthLabel}</div>
                          </div>
                          <div className="flex-1">
                            <h3 className="text-lg font-black text-[#2b3a4a]">{booking.court?.club?.name || 'Club'}</h3>
                            <p className="text-[#7c8aa0]">{booking.activity?.name || 'Actividad'}</p>
                            <p className="text-[#7c8aa0]">{formatTime(date)} - {duration} min</p>
                            {activeTab === 'PAST' && (spentTotal > 0 || consumptionTotal > 0) && (
                              <p className="text-sm text-[#2b3a4a]/80 mt-2">
                                {spentTotal > 0 && (
                                  <span className="mr-3">Gastado: <strong>{formatCurrency(spentTotal)}</strong></span>
                                )}
                                {consumptionTotal > 0 && (
                                  <span>Consumido: <strong>{formatCurrency(consumptionTotal)}</strong></span>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="text-2xl text-[#926699]">→</div>
                        </div>

                        {activeTab === 'ACTIVE' && (
                          <div className="flex justify-between items-center px-6 py-4 border-t border-[#e5e7eb] text-sm font-semibold">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCancel(booking.id);
                              }}
                              className="px-4 py-2 rounded-full border border-red-200 bg-red-50 text-[#ef4444] hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
                            >
                              Cancelar reserva
                            </button>
                          </div>
                        )}

                        {(activeTab === 'PAST' || activeTab === 'CANCELLED') && (
                          <div className="flex justify-center items-center px-6 py-4 border-t border-[#e5e7eb] text-sm font-semibold text-[#2b3a4a]">
                            {booking.court?.club?.slug ? (
                              <Link
                                href={`/club/${booking.court.club.slug}`}
                                className="px-4 py-2 rounded-full border border-[#d7dde5] hover:border-[#926699] hover:text-[#926699]"
                                onClick={(event) => event.stopPropagation()}
                              >
                                Repetir
                              </Link>
                            ) : (
                              <span className="text-[#7c8aa0]">Repetir</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-lg border border-black/5 p-8">
            <h2 className="text-2xl font-black text-[#2b3a4a] text-center">Detalle de reserva</h2>
            <div className="mx-auto mt-3 h-1 w-16 rounded-full bg-[#926699]" />

            {!selectedBooking ? (
              <div className="mt-12 text-center text-[#7c8aa0]">
                <div className="mx-auto mb-6 w-full max-w-[340px] rounded-3xl border-2 border-[#d7dde5] p-4">
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-16 rounded-2xl bg-[#d9dde2]" />
                    <div className="flex-1 space-y-3">
                      <div className="h-3 w-3/4 rounded-full bg-[#d9dde2]" />
                      <div className="h-3 w-1/2 rounded-full bg-[#d9dde2]" />
                    </div>
                  </div>
                </div>
                <p className="text-lg font-semibold">Selecciona una reserva para ver el detalle</p>
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-[#e5e7eb] p-4">
                  <p className="font-black text-[#2b3a4a]">{selectedBooking.court?.club?.name || 'Club'}</p>
                  <p className="text-[#7c8aa0]">
                    {[selectedBooking.court?.club?.addressLine, selectedBooking.court?.club?.city, selectedBooking.court?.club?.province]
                      .filter(Boolean)
                      .join(', ') || 'Dirección no disponible'}
                  </p>
                </div>

                <div>
                  <p className="font-black text-[#2b3a4a] mb-2">Información de partido</p>
                  <div className="rounded-2xl border border-[#e5e7eb] p-4 space-y-3">
                    <div className="font-semibold text-[#2b3a4a]">
                      {selectedBooking.court?.name || 'Cancha'} - {selectedBooking.activity?.name || 'Actividad'}
                    </div>
                    <div className="flex justify-between text-[#2b3a4a]/80">
                      <span>Día:</span>
                      <span>{formatWeekday(new Date(selectedBooking.startDateTime))}</span>
                    </div>
                    <div className="flex justify-between text-[#2b3a4a]/80">
                      <span>Hora:</span>
                      <span>{formatTime(new Date(selectedBooking.startDateTime))}hs</span>
                    </div>
                    <div className="flex justify-between text-[#2b3a4a]/80">
                      <span>Duración:</span>
                      <span>{getDurationMinutes(selectedBooking)} min</span>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="font-black text-[#2b3a4a] mb-2">Resumen</p>
                  <div className="rounded-2xl border border-[#e5e7eb] p-4 space-y-2 text-[#2b3a4a]">
                    <div className="flex justify-between">
                      <span>Precio:</span>
                      <span className="font-black">{formatCurrency(selectedBooking.price || 0)}</span>
                    </div>
                    {activeTab === 'PAST' && getConsumptionTotal(selectedBooking) > 0 && (
                      <div className="flex justify-between">
                        <span>Consumido:</span>
                        <span className="font-black">{formatCurrency(getConsumptionTotal(selectedBooking))}</span>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      )}
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
      </div>
    </div>
  );
}