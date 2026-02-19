import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import Navbar from '../components/NavBar';
import { getMyBookings, cancelBooking } from '../services/BookingService';
import AppModal from '../components/AppModal';
import { useValidateAuth } from '../hooks/useValidateAuth';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Ticket, ArrowRight, Search, XCircle, AlertCircle, CheckCircle2 } from 'lucide-react';

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
  
  // Mantenemos las refs para no romper el useEffect original, aunque cambiemos el estilo visual
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
          setSelectedBooking(null);
          loadData();
        } catch (e: any) {
          showError('Error: ' + e.message);
        }
      }
    });
  };

  if (!authChecked || !user) return null;

  // --- RENDERIZADO VISUAL PREMIUM ---
  return (
    <div className="min-h-screen bg-[#347048] relative overflow-hidden text-[#D4C5B0]">
      {/* Fondo Decorativo */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none opacity-20">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] bg-[#B9CF32] rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#926699] rounded-full blur-[120px]"></div>
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <div className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 md:py-12 mt-16">
          
          {/* Header */}
          <div className="flex items-center gap-4 mb-8 animate-in slide-in-from-top-4 duration-500">
            <div className="bg-[#EBE1D8] p-3 rounded-2xl text-[#347048] shadow-lg">
              <Ticket size={32} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-4xl font-black text-[#EBE1D8] uppercase italic tracking-tighter">Mis Reservas</h1>
              <p className="text-[#B9CF32] font-bold text-sm tracking-widest uppercase">Historial y próximos partidos</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-8 h-full">
            
            {/* PANEL IZQUIERDO: LISTA */}
            <div className="bg-[#EBE1D8] rounded-[2.5rem] p-6 md:p-8 shadow-2xl border-4 border-white/50 flex flex-col min-h-[600px] md:min-h-[700px] animate-in slide-in-from-left-4 duration-500 delay-100">
              
              {/* TABS PILDORA */}
              <div className="flex p-1 bg-[#347048]/10 rounded-2xl mb-6 relative">
                {/* Mantenemos refs funcionales pero ocultas visualmente si no se usan para el estilo pildora */}
                {/* El indicador original lo ocultamos porque usamos botones solidos ahora */}
                {(['ACTIVE', 'PAST', 'CANCELLED'] as const).map((tab) => (
                  <button
                    key={tab}
                    ref={(el) => { tabRefs.current[tab] = el; }}
                    onClick={() => { setActiveTab(tab); setSelectedBooking(null); }}
                    className={`flex-1 py-3 text-[10px] md:text-xs font-black uppercase tracking-widest rounded-xl transition-all duration-300 relative z-10 ${
                      activeTab === tab 
                        ? 'bg-[#347048] text-[#B9CF32] shadow-md scale-100' 
                        : 'text-[#347048]/50 hover:bg-[#347048]/5'
                    }`}
                  >
                    {tab === 'ACTIVE' ? 'Activas' : tab === 'PAST' ? 'Pasadas' : 'Canceladas'}
                  </button>
                ))}
              </div>

              {/* CONTENIDO LISTA */}
              <div className={`flex-1 pr-2 space-y-4 ${!loading && !error && visibleBookings.length > 0 ? 'overflow-y-auto custom-scrollbar' : 'overflow-visible'}`}>
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#347048]/40 gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#347048]"></div>
                    <span className="font-bold text-xs">Cargando partidos...</span>
                  </div>
                ) : error ? (
                   <div className="p-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl text-xs font-bold text-center">
                      {error}
                   </div>
                ) : visibleBookings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#347048]/40 gap-4 border-2 border-dashed border-[#347048]/10 rounded-3xl m-4">
                    <Search size={48} strokeWidth={1.5} />
                    <p className="font-black uppercase tracking-widest text-xs">
                        {activeTab === 'CANCELLED' ? 'Sin cancelaciones' : activeTab === 'PAST' ? 'Sin historial' : 'No hay reservas activas'}
                    </p>
                    {activeTab === 'ACTIVE' && (
                        <Link href="/" className="px-6 py-3 bg-[#347048] text-[#B9CF32] rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#2a5c3b] transition-colors">
                            Reservar Ahora
                        </Link>
                    )}
                  </div>
                ) : (
                  visibleBookings.map((booking) => {
                    const date = new Date(booking.startDateTime);
                    const dayLabel = formatDayLabel(date); // "13 feb" o similar
                    const duration = getDurationMinutes(booking);
                    const isSelected = selectedBooking?.id === booking.id;

                    return (
                      <div 
                        key={booking.id}
                        onClick={() => setSelectedBooking(booking)}
                        className={`group cursor-pointer relative p-5 rounded-2xl border-2 transition-all duration-300 hover:shadow-lg ${
                          isSelected
                            ? 'bg-white border-[#B9CF32] shadow-md ring-1 ring-[#B9CF32]/50' 
                            : 'bg-white/60 border-transparent hover:border-[#347048]/20 hover:bg-white'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-4">
                            {/* Fecha Cuadrada */}
                            <div className={`h-14 w-14 rounded-xl flex flex-col items-center justify-center font-black shadow-sm border border-black/5 ${
                                activeTab === 'ACTIVE' ? 'bg-[#347048] text-[#B9CF32]' : 
                                activeTab === 'CANCELLED' ? 'bg-red-50 text-red-500' : 'bg-[#d4c5b0]/20 text-[#347048]/60'
                            }`}>
                              <span className="text-xl leading-none">{date.getDate()}</span>
                              <span className="text-[9px] uppercase">{date.toLocaleString('es-AR', { month: 'short' }).replace('.', '')}</span>
                            </div>
                            
                            {/* Info */}
                            <div>
                              <h3 className="font-black text-[#347048] text-base md:text-lg uppercase italic leading-none mb-1.5">
                                {booking.court?.club?.name || 'Club'}
                              </h3>
                              <p className="text-xs font-bold text-[#347048]/60 uppercase flex items-center gap-2">
                                <span className="bg-[#347048]/5 px-2 py-0.5 rounded text-[10px]">{booking.activity?.name}</span>
                                <span className="flex items-center gap-1"><Clock size={10} /> {formatTime(date)}</span>
                              </p>
                            </div>
                          </div>
                          
                          <ArrowRight size={20} className={`transition-transform duration-300 ${isSelected ? 'text-[#B9CF32] translate-x-1' : 'text-[#347048]/20 group-hover:text-[#347048]/40'}`} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* PANEL DERECHO: DETALLE (STICKY) */}
            <div className="relative animate-in slide-in-from-right-4 duration-500 delay-200">
              {selectedBooking ? (
                <div className="bg-white rounded-[2.5rem] p-8 shadow-2xl border-8 border-[#EBE1D8] h-fit sticky top-24">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#347048] text-[#EBE1D8] px-6 py-2 rounded-full font-black text-xs uppercase tracking-widest shadow-lg flex items-center gap-2">
                    <Ticket size={14} /> Ticket de Reserva
                  </div>

                  <div className="text-center mt-6 mb-8 border-b-2 border-dashed border-[#347048]/10 pb-8">
                    <h2 className="text-2xl md:text-3xl font-black text-[#347048] italic tracking-tighter uppercase mb-2">
                      {selectedBooking.court?.name}
                    </h2>
                    <span className="bg-[#B9CF32]/20 text-[#347048] px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
                      {selectedBooking.activity?.name || 'Deporte'}
                    </span>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="bg-[#347048]/5 p-3 rounded-xl text-[#347048]"><Calendar size={20} /></div>
                      <div>
                        <p className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Fecha</p>
                        <p className="font-bold text-[#347048] text-base capitalize">
                            {formatWeekday(new Date(selectedBooking.startDateTime))}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="bg-[#347048]/5 p-3 rounded-xl text-[#347048]"><Clock size={20} /></div>
                      <div>
                        <p className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Horario</p>
                        <p className="font-bold text-[#347048] text-base">
                          {formatTime(new Date(selectedBooking.startDateTime))} - {getDurationMinutes(selectedBooking)} min
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="bg-[#347048]/5 p-3 rounded-xl text-[#347048]"><MapPin size={20} /></div>
                      <div>
                        <p className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Ubicación</p>
                        <p className="font-bold text-[#347048] text-sm leading-tight">
                            {[
       // 👇 Acá probamos todas las variantes posibles por si acaso
       selectedBooking.court?.club?.addressLine, 
       selectedBooking.court?.club?.address,
       selectedBooking.court?.club?.street, 
       selectedBooking.court?.club?.city
     ]
     .filter(Boolean) // Esto borra los nulos
     .join(', ') || 'Dirección no disponible'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-10 pt-6 border-t-2 border-[#347048]/10 flex flex-col gap-4">
                    <div className="flex justify-between items-end">
                      <span className="font-black text-[#347048]/40 text-xs uppercase tracking-widest mb-1">Total Pagado</span>
                      <span className="font-black text-[#347048] text-3xl tracking-tight">{formatCurrency(selectedBooking.price || 0)}</span>
                    </div>
                    
                    {/* Consumos Extra si es pasado */}
                    {activeTab === 'PAST' && getConsumptionTotal(selectedBooking) > 0 && (
                        <div className="flex justify-between items-end text-[#347048]/60">
                            <span className="font-bold text-xs uppercase tracking-widest">Consumos Extra</span>
                            <span className="font-bold text-lg">{formatCurrency(getConsumptionTotal(selectedBooking))}</span>
                        </div>
                    )}

                    {activeTab === 'ACTIVE' && (
                      <button 
                        onClick={() => handleCancel(selectedBooking.id)}
                        className="w-full mt-2 py-4 rounded-xl border-2 border-red-100 bg-red-50 text-red-500 font-bold text-xs uppercase tracking-widest hover:bg-red-500 hover:text-white hover:border-red-500 transition-all flex justify-center items-center gap-2"
                      >
                        <XCircle size={16} /> Cancelar Reserva
                      </button>
                    )}
                    
                    {(activeTab === 'PAST' || activeTab === 'CANCELLED') && selectedBooking.court?.club?.slug && (
                        <Link 
                            href={`/club/${selectedBooking.court.club.slug}`}
                            className="w-full mt-2 py-4 rounded-xl bg-[#347048] text-[#EBE1D8] font-bold text-xs uppercase tracking-widest hover:bg-[#B9CF32] hover:text-[#347048] transition-all flex justify-center items-center gap-2 text-center"
                        >
                            <CheckCircle2 size={16} /> Volver a Reservar
                        </Link>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center p-8 bg-[#EBE1D8]/10 border-4 border-dashed border-[#EBE1D8]/30 rounded-[2.5rem]">
                  <Ticket size={64} className="text-[#EBE1D8] mb-4 opacity-50" />
                  <p className="text-[#EBE1D8] font-black uppercase tracking-widest text-sm opacity-80">Seleccioná un partido<br/>para ver el ticket</p>
                </div>
              )}
            </div>

          </div>
        </div>
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
    </div>
  );
}