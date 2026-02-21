import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ClubAdminService } from '../services/ClubAdminService';
import { Phone, DollarSign, Calendar, Users, Trophy, Search, X, CheckCircle, Receipt, Banknote, CreditCard } from 'lucide-react';
import { useRouter } from 'next/router';
import AppModal from './AppModal';
import { getApiUrl } from '../utils/apiUrl';

const formatDate = (dateInput: any) => {
  if (!dateInput) return '-';
  const date = new Date(dateInput);
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

const bookingStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado'
};

const paymentStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagado',
  DEBT: 'Fiado',
  PARTIAL: 'Parcial'
};

interface ClientsPageProps {
  clubSlug?: string;
}

export default function ClientsPage({ clubSlug }: ClientsPageProps = {}) {
  const router = useRouter();
  const slugFromQuery = router.query.slug as string | undefined;
  const slug = clubSlug ?? slugFromQuery;

  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDebtor, setSelectedDebtor] = useState<any>(null);
  const [selectedClientHistory, setSelectedClientHistory] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPayMethodModal, setShowPayMethodModal] = useState(false);
  const [bookingToPayId, setBookingToPayId] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const debtBackdropMouseDownRef = useRef(false);
  const payMethodBackdropMouseDownRef = useRef(false);
  const historyBackdropMouseDownRef = useRef(false);

  // --- LÓGICA DEL APPMODAL ---
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const data = await ClubAdminService.getDebtors(slug);
      setClients(data);
      return data;
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
    return null;
  }, [slug]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredClients = clients.filter(client => {
    const term = searchTerm.toLowerCase();
    return client.name.toLowerCase().includes(term) || (client.phone && client.phone.includes(term)) || (client.dni && client.dni.toLowerCase().includes(term));
  });

  const totalDebt = clients.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalClients = clients.length;
  const topClient = clients.reduce((prev, current) => (prev.totalBookings > current.totalBookings) ? prev : current, {name: '-', totalBookings: 0});

  const handleOpenPayModal = (bookingId: number) => {
    setBookingToPayId(bookingId);
    setShowPayMethodModal(true);
  };

  const processDebtPayment = async (method: 'CASH' | 'TRANSFER') => {
    if (!bookingToPayId) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${getApiUrl()}/api/bookings/pay-debt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ bookingId: bookingToPayId, paymentMethod: method })
      });
      if (!response.ok) throw new Error('Error al procesar');
      setShowPayMethodModal(false);
      setBookingToPayId(null);
      const updatedClients = await loadClients();

      if (selectedDebtor && Array.isArray(updatedClients)) {
        const refreshed = updatedClients.find((client: any) => client.id === selectedDebtor.id);

        if (!refreshed || refreshed.totalDebt <= 0) {
          setSelectedDebtor(null);
          showInfo(`La deuda ha sido saldada por completo.`, 'Éxito');
        } else {
          setSelectedDebtor(refreshed);
          showInfo(`El cobro fue registrado en la caja diaria.`, 'Éxito');
        }
      }
    } catch (error) { 
        // REEMPLAZO DE ALERT
        showError("No se pudo procesar el cobro. Intentá nuevamente."); 
    }
  };
  
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* TARJETAS KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border-4 border-white p-6 rounded-[2rem] shadow-xl flex items-center justify-between">
             <div><h3 className="text-[#347048]/40 text-[10px] font-black uppercase tracking-widest mb-1">Total Clientes</h3><p className="text-4xl font-black text-[#347048] italic tracking-tighter">{totalClients}</p></div>
             <div className="bg-[#347048]/5 p-4 rounded-2xl text-[#347048]"><Users size={28} /></div>
          </div>
          <div className="bg-white border-4 border-white p-6 rounded-[2rem] shadow-xl flex items-center justify-between">
             <div><h3 className="text-[#926699]/60 text-[10px] font-black uppercase tracking-widest mb-1">Más Fiel</h3><p className="text-xl font-black text-[#926699] italic tracking-tight truncate max-w-[150px] uppercase">{topClient.name}</p></div>
             <div className="bg-[#926699]/10 p-4 rounded-2xl text-[#926699]"><Trophy size={28} /></div>
          </div>
          <div className={`border-4 p-6 rounded-[2rem] shadow-xl flex items-center justify-between transition-colors ${totalDebt > 0 ? 'bg-white border-red-100' : 'bg-white border-emerald-100'}`}>
             <div><h3 className={`${totalDebt > 0 ? 'text-red-500' : 'text-emerald-600'} text-[10px] font-black uppercase tracking-widest mb-1`}>{totalDebt > 0 ? 'Fiado / A Cobrar' : 'Cuentas al Día'}</h3><p className={`text-4xl font-black italic tracking-tighter ${totalDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>${totalDebt.toLocaleString()}</p></div>
             <div className={`${totalDebt > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'} p-4 rounded-2xl`}><DollarSign size={28} strokeWidth={2.5} /></div>
          </div>
      </div>

      {/* TABLA + BUSCADOR */}
      <div className="bg-white/40 backdrop-blur-sm border-2 border-white rounded-[2rem] p-6 overflow-hidden shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 px-2">
            <h2 className="text-xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tight">
               <Receipt className="text-[#B9CF32]" /> Directorio de Clientes
            </h2>
            <div className="relative w-full md:w-80 group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-[#B9CF32] text-[#347048]/40"><Search size={18} strokeWidth={2.5} /></div>
                <input type="text" className="block w-full pl-12 pr-4 py-3 border-2 border-transparent focus:border-[#B9CF32] rounded-xl bg-white text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none transition-all shadow-sm" placeholder="Buscar por Nombre, DNI o Tel..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute inset-y-0 right-2 my-auto h-8 w-8 bg-white rounded-full shadow-sm flex items-center justify-center text-[#347048]/40 hover:text-[#347048] hover:scale-110 transition-transform"
                    aria-label="Limpiar búsqueda"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                )}
            </div>
        </div>
        
        {loading ? <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#347048]"></div></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/40">
                  <th className="px-6 py-2">Cliente</th>
                  <th className="px-6 py-2">DNI</th>
                  <th className="px-6 py-2">Contacto</th>
                  <th className="px-6 py-2">Historial</th>
                  <th className="px-6 py-2">Saldo</th>
                  <th className="px-6 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.length > 0 ? (
                    filteredClients.map((client) => (
                    <tr key={client.id} className="bg-white/80 hover:bg-white transition-all shadow-sm group">
                        <td className="px-6 py-4 font-black text-[#347048] first:rounded-l-2xl uppercase tracking-tight italic">{client.name}</td>
                        <td className="px-6 py-4">
                           {client.dni !== '-' ? (
                             <span className="bg-[#347048]/5 border border-[#347048]/10 px-2 py-1 rounded-lg text-[#347048] font-bold text-xs">{client.dni}</span>
                           ) : <span className="opacity-20">-</span>}
                        </td>
                        <td className="px-6 py-4 text-[#347048]/70 font-bold text-xs uppercase">
                            {client.phone ? <span className="flex items-center gap-2"><Phone size={12} className="text-[#B9CF32]"/> {client.phone}</span> : '-'}
                        </td>
                        <td className="px-6 py-4">
                           <span className="text-[10px] font-black bg-[#926699]/10 text-[#926699] px-3 py-1 rounded-full border border-[#926699]/20 uppercase tracking-widest">{client.totalBookings} Reservas</span>
                        </td>
                        <td className="px-6 py-4">
                          {client.totalDebt > 0 ? (
                              <span className="inline-flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1.5 rounded-xl text-[10px] font-black border border-red-100 uppercase tracking-wider italic">DEBE: ${client.totalDebt.toLocaleString()}</span>
                          ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-black uppercase tracking-wider"><CheckCircle size={12}/> Al día</span>
                          )}
                        </td>
                        <td className="px-6 py-4 last:rounded-r-2xl">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => setSelectedClientHistory(client)} className="text-[10px] font-black uppercase tracking-widest bg-white border-2 border-[#347048]/10 hover:border-[#347048] text-[#347048] px-4 py-2 rounded-xl transition shadow-sm">Historial</button>
                            {client.totalDebt > 0 && (
                              <button onClick={() => setSelectedDebtor(client)} className="text-[10px] font-black uppercase tracking-widest bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl transition shadow-lg shadow-red-900/20 flex items-center gap-2"><DollarSign size={14} strokeWidth={3}/> Saldar</button>
                            )}
                          </div>
                        </td>
                    </tr>
                    ))
                ) : (
                    <tr><td colSpan={6} className="p-20 text-center text-[#347048]/30 font-black uppercase tracking-[0.3em] italic">Sin coincidencias</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL DETALLE DE DEUDA */}
      {selectedDebtor && (
        <div
          className="fixed inset-0 bg-[#347048]/90 flex items-center justify-center z-[110] p-4 animate-in fade-in backdrop-blur-sm"
          onMouseDown={(event) => {
            debtBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onTouchStart={(event) => {
            debtBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            const startedOnBackdrop = debtBackdropMouseDownRef.current;
            debtBackdropMouseDownRef.current = false;
            if (startedOnBackdrop && event.target === event.currentTarget) {
              setSelectedDebtor(null);
            }
          }}
        >
            <div className="bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-8 border-b border-[#347048]/10 bg-[#EBE1D8] flex justify-between items-center">
                    <div>
                        <h3 className="text-2xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tighter">Deuda de {selectedDebtor.name}</h3>
                        <p className="text-[#347048]/60 text-xs font-bold mt-1 uppercase tracking-widest italic">Total Pendiente: <span className="text-red-600 font-black text-lg ml-2">${selectedDebtor.totalDebt}</span></p>
                    </div>
                    <button
                      onClick={() => setSelectedDebtor(null)}
                      className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                      title="Cerrar ventana"
                    >
                      <X size={20} strokeWidth={3} />
                    </button>
                </div>

                <div className="p-8 overflow-y-auto custom-scrollbar space-y-4 bg-white/40">
                    {selectedDebtor.bookings
                    .filter((b: any) => ['DEBT', 'PARTIAL', 'PENDING'].includes(b.paymentStatus))
                    .map((booking: any) => {
                        const itemsTotal = (booking.items || []).reduce((sum: any, item: any) => sum + (Number(item.price) * item.quantity), 0);
                        const courtPrice = Number(booking.price) - itemsTotal; 
                        const totalPaid = Number(booking.paid);
                        let isCourtPaid = totalPaid >= courtPrice;
                        let remainingPayment = isCourtPaid ? totalPaid - courtPrice : totalPaid;

                        const itemsWithStatus = (booking.items || []).map((item: any) => {
                            const itemCost = Number(item.price) * item.quantity;
                            let isPaid = false;
                            if (remainingPayment >= itemCost) { remainingPayment -= itemCost; isPaid = true; }
                            return { ...item, isPaid }; 
                        });

                        return (
                        <div key={booking.id} className="bg-white p-5 rounded-[1.5rem] border-2 border-[#347048]/5 flex justify-between items-center shadow-sm">
                            <div className="flex flex-col flex-1">
                                <div className="flex items-center gap-3 mb-3">
                                    <span className="font-black text-[#347048] text-sm bg-[#347048]/5 px-3 py-1 rounded-lg italic">#{booking.id}</span>
                                    <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">{formatDate(booking.date)}</span>
                                </div>
                                <div className={`text-sm font-black uppercase tracking-tight flex justify-between mb-2 pr-10 ${isCourtPaid ? 'text-[#347048]/20 line-through' : 'text-[#347048]'}`}>
                                    <span>Cancha: {booking.courtName || booking.court?.name}</span>
                                    <span className="text-xs opacity-60 font-mono">${courtPrice}</span>
                                </div>
                                <div className="space-y-1.5 pl-3 border-l-4 border-[#347048]/5">
                                    {itemsWithStatus.map((item: any, idx: number) => (
                                      <div key={idx} className={`flex justify-between items-center text-[11px] font-bold uppercase tracking-wide pr-10 ${item.isPaid ? 'text-[#347048]/20 line-through' : 'text-[#347048]/60'}`}>
                                          <span className="flex items-center gap-2"><span className={`px-1.5 py-0.5 rounded-md ${item.isPaid ? 'bg-gray-100 text-gray-400' : 'bg-[#926699] text-white'}`}>{item.quantity}x</span>{item.name || item.product?.name}</span>
                                          <span className="font-mono">${Number(item.price) * item.quantity}</span>
                                      </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-6 pl-8 border-l-2 border-dashed border-[#347048]/10">
                                <div className="text-right">
                                    <div className="text-2xl font-black text-red-600 font-mono italic tracking-tighter">${booking.amount}</div>
                                    <div className="text-[9px] text-[#347048]/40 uppercase font-black tracking-widest">Adeudado</div>
                                </div>
                                <button onClick={() => handleOpenPayModal(booking.id)} className="bg-[#B9CF32] hover:bg-[#aebd2b] text-[#347048] h-12 w-12 flex items-center justify-center rounded-2xl shadow-lg transition-all active:scale-95"><DollarSign size={24} strokeWidth={3} /></button>
                            </div>
                        </div>
                        );
                    })}
                </div>
            </div>
        </div>
      )}

      {/* MODAL MÉTODOS PAGO */}
    {mounted && showPayMethodModal && createPortal(
  <div
    className="fixed inset-0 bg-[#347048]/80 backdrop-blur-[2px] flex items-center justify-center z-[120] p-4 animate-in fade-in duration-200"
    onMouseDown={(event) => {
      payMethodBackdropMouseDownRef.current = event.target === event.currentTarget;
    }}
    onTouchStart={(event) => {
      payMethodBackdropMouseDownRef.current = event.target === event.currentTarget;
    }}
    onClick={(event) => {
      const startedOnBackdrop = payMethodBackdropMouseDownRef.current;
      payMethodBackdropMouseDownRef.current = false;
      if (startedOnBackdrop && event.target === event.currentTarget) {
        setShowPayMethodModal(false);
      }
    }}
  >
      <div className="bg-[#EBE1D8] border-4 border-white p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full relative">
        <button 
          onClick={() => setShowPayMethodModal(false)}
          className="absolute top-6 right-6 bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
          title="Cerrar ventana"
        >
          <X size={20} strokeWidth={3} />
        </button>

        <h3 className="text-2xl font-black text-[#347048] mb-2 text-center uppercase tracking-tight italic">¿Método de cobro?</h3>
                
        {/* Buscamos el monto exacto de la reserva que estamos saldando */}
        {(() => {
          const bookingInfo = selectedDebtor?.bookings.find((b: any) => b.id === bookingToPayId);
          return bookingInfo ? (
            <p className="text-[#347048]/60 text-xs font-bold mb-8 text-center uppercase tracking-widest">
              A SALDAR: <span className="text-[#347048] text-lg font-black">${bookingInfo.amount.toLocaleString()}</span>
            </p>
          ) : (
            <p className="text-[#347048]/60 text-xs font-bold mb-8 text-center uppercase tracking-widest">
              Se registrará en caja diaria
            </p>
          );
        })()}

        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => processDebtPayment('CASH')}
            className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-3xl text-[#347048] transition-all hover:scale-[1.02] shadow-sm group"
          >
            <Banknote size={36} strokeWidth={2} className="mb-2 group-hover:scale-110 transition-transform text-[#347048]" />
            <span className="font-black text-[10px] uppercase tracking-widest">Efectivo</span>
          </button>
          <button
            onClick={() => processDebtPayment('TRANSFER')}
            className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-3xl text-[#347048] transition-all hover:scale-[1.02] shadow-sm group"
          >
            <CreditCard size={36} strokeWidth={2} className="mb-2 group-hover:scale-110 transition-transform text-[#347048]" />
            <span className="font-black text-[10px] uppercase tracking-widest">Digital</span>
          </button>
        </div>
                
        <button 
          onClick={() => setShowPayMethodModal(false)}
          className="w-full text-[#347048]/40 hover:text-[#347048] text-[10px] font-black uppercase tracking-widest hover:underline transition-all"
        >
          Cancelar operación
        </button>
      </div>
    </div>,
    document.body
    )}

      {/* HISTORIAL COMPLETO */}
      {mounted && selectedClientHistory && createPortal(
        <div
          className="fixed inset-0 bg-[#347048]/90 flex items-center justify-center z-[120] p-4 backdrop-blur-[2px] animate-in fade-in"
          onMouseDown={(event) => {
            historyBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onTouchStart={(event) => {
            historyBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            const startedOnBackdrop = historyBackdropMouseDownRef.current;
            historyBackdropMouseDownRef.current = false;
            if (startedOnBackdrop && event.target === event.currentTarget) {
              setSelectedClientHistory(null);
            }
          }}
        >
          <div className="bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-8 border-b border-[#347048]/10 flex items-center justify-between bg-[#EBE1D8]">
              <div>
                <h3 className="text-2xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tighter">Historial: {selectedClientHistory.name}</h3>
                <p className="text-[10px] font-black text-[#347048]/40 mt-1 uppercase tracking-widest">DNI: {selectedClientHistory.dni || '-'} · Tel: {selectedClientHistory.phone || '-'}</p>
              </div>
              <button
                onClick={() => setSelectedClientHistory(null)}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            <div className="p-8 overflow-y-auto space-y-4 custom-scrollbar bg-white/40">
              {selectedClientHistory.history?.length > 0 ? (
                selectedClientHistory.history.slice().sort((a: any, b: any) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime()).map((booking: any) => {
                    const status = booking.status;
                    const pStatus = booking.paymentStatus;
                    const itemsTotal = (booking.items || []).reduce((sum: number, item: any) => sum + Number(item.price) * item.quantity, 0);
                    const courtPrice = Number(booking.price || 0) - itemsTotal;
                    return (
                      <div key={booking.id} className="bg-white p-5 rounded-[1.5rem] border border-[#347048]/5 flex justify-between items-center shadow-sm">
                        <div className="flex flex-col gap-2 flex-1">
                          <div className="flex items-center gap-3"><span className="font-black text-[#347048] text-sm italic">#{booking.id}</span><span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">{formatDate(booking.date)} · {booking.time}</span></div>
                          <div className="text-xs font-black text-[#347048] uppercase tracking-tight">Cancha: {booking.courtName || booking.court?.name} <span className="opacity-40 ml-2 font-mono">${courtPrice.toLocaleString()}</span></div>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${status === 'CANCELLED' ? 'bg-gray-50 text-gray-400 border-gray-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>{bookingStatusLabel[status] ?? status}</span>
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${['DEBT', 'PARTIAL'].includes(pStatus) ? 'bg-red-50 text-red-500 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>{paymentStatusLabel[pStatus] ?? pStatus}</span>
                          </div>
                        </div>
                        <div className="text-right pl-6 border-l border-dashed border-[#347048]/10"><div className="text-xl font-black text-[#347048] italic tracking-tighter">${Number(booking.price).toLocaleString()}</div><div className="text-[9px] font-black text-[#347048]/40 uppercase">{booking.amount > 0 ? `DEBE $${Number(booking.amount).toLocaleString()}` : 'SALDADO'}</div></div>
                      </div>
                    );
                })
              ) : <p className="text-center text-[#347048]/30 font-black py-10 uppercase italic">Sin registros</p>}
            </div>
            
          </div>
        </div>,
        document.body
      )}

      {/* COMPONENTE MODAL GLOBAL PARA ALERTAS */}
      <AppModal 
        show={modalState.show} 
        onClose={closeModal} 
        onCancel={modalState.onCancel} 
        title={modalState.title} 
        message={modalState.message}
        cancelText={modalState.cancelText} 
        confirmText={modalState.confirmText} 
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm} 
        closeOnBackdrop={modalState.closeOnBackdrop} 
        closeOnEscape={modalState.closeOnEscape} 
      />
    </div>
  );
}