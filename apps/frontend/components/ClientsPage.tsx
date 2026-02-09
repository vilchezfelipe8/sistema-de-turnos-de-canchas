import { useState, useEffect } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { User, Phone, DollarSign, Calendar, Users, Trophy, Search, X, CheckCircle } from 'lucide-react';
import { useRouter } from 'next/router';

// 👇 1. DEFINICIÓN DEL MODAL (Esto es lo que te faltaba)
const DebtModal = ({ client, onClose, onSuccess }: any) => {
  const [loading, setLoading] = useState(false);

  // Filtramos solo las reservas que debe
  const unpaidBookings = client.bookings.filter((b: any) => b.paymentStatus === 'DEBT');

  const handlePayAll = async () => {
    if (!confirm(`¿Confirmás que ${client.name} pagó el total de $${client.totalDebt}?`)) return;
    try {
      setLoading(true);
      // Extraemos los IDs de las reservas que debe
      const idsToPay = unpaidBookings.map((b: any) => b.id);
      
      // Llamamos al servicio para marcar como PAGADO
      await ClubAdminService.markAsPaid(idsToPay); 
      
      onSuccess(); // Recargamos la tabla principal
      onClose();   // Cerramos el modal
    } catch (error) {
      alert('Error al procesar el pago');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Cabecera Roja */}
        <div className="bg-red-500/10 p-6 border-b border-red-500/20 flex justify-between items-start">
           <div>
             <h3 className="text-red-400 font-bold text-lg uppercase flex items-center gap-2">
               <DollarSign size={20}/> Saldar Deuda
             </h3>
             <p className="text-white font-bold text-2xl mt-1">${client.totalDebt.toLocaleString()}</p>
             <p className="text-gray-400 text-sm">Cliente: {client.name}</p>
           </div>
           <button onClick={onClose} className="text-gray-400 hover:text-white"><X/></button>
        </div>

        {/* Lista de lo que debe */}
        <div className="p-6 max-h-[300px] overflow-y-auto space-y-3">
           <p className="text-xs text-gray-500 font-bold uppercase mb-2">Detalle de lo que debe:</p>
           {unpaidBookings.map((booking: any) => (
             <div key={booking.id} className="flex justify-between items-center bg-gray-800 p-3 rounded-lg border border-gray-700">
                <div className="text-sm">
                   <div className="text-white font-medium flex items-center gap-2">
                     <Calendar size={12} className="text-gray-500"/> 
                     {new Date(booking.date).toLocaleDateString()}
                   </div>
                   <div className="text-xs text-gray-400 mt-1">
                     Reserva #{booking.id}
                   </div>
                </div>
                <div className="font-mono text-red-400 font-bold">
                   ${booking.total.toLocaleString()}
                </div>
             </div>
           ))}
        </div>

        {/* Botón de Pagar */}
        <div className="p-6 border-t border-gray-800 bg-gray-900">
           <button 
             onClick={handlePayAll}
             disabled={loading}
             className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-900/20 flex justify-center items-center gap-2 transition-all disabled:opacity-50"
           >
             {loading ? 'Procesando...' : (
               <> <CheckCircle size={18} /> MARCAR TODO COMO PAGADO </>
             )}
           </button>
        </div>
      </div>
    </div>
  );
};


// 👇 2. COMPONENTE PRINCIPAL (Con Buscador y Tabla)
interface ClientsPageProps {
  /** Opcional: slug del club (si viene de /club/[slug]/admin). En /admin/clientes se usa el token. */
  clubSlug?: string;
}

export default function ClientsPage({ clubSlug }: ClientsPageProps = {}) {
  const router = useRouter();
  const slugFromQuery = router.query.slug as string | undefined;
  const slug = clubSlug ?? slugFromQuery;

  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDebtor, setSelectedDebtor] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPayMethodModal, setShowPayMethodModal] = useState(false);
  const [bookingToPayId, setBookingToPayId] = useState<number | null>(null);

  useEffect(() => {
    loadClients();
  }, [slug]);

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await ClubAdminService.getDebtors(slug);
      setClients(data);
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  // Lógica de filtrado
  const filteredClients = clients.filter(client => {
    const term = searchTerm.toLowerCase();
    
    const nameMatch = client.name.toLowerCase().includes(term);
    const phoneMatch = client.phone && client.phone.includes(term);
    const dniMatch = client.dni && client.dni.toLowerCase().includes(term); 
    
    return nameMatch || phoneMatch || dniMatch;
  });

  const totalDebt = clients.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalClients = clients.length;
  const topClient = clients.reduce((prev, current) => (prev.totalBookings > current.totalBookings) ? prev : current, {name: '-', totalBookings: 0});

  // 1. Abre el modal chiquito
const handleOpenPayModal = (bookingId: number) => {
    setBookingToPayId(bookingId);
    setShowPayMethodModal(true);
};

// 2. Procesa el pago (Llama al backend)
const processDebtPayment = async (method: 'CASH' | 'TRANSFER') => {
    if (!bookingToPayId) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/bookings/pay-debt`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                bookingId: bookingToPayId, 
                paymentMethod: method 
            })
        });

        if (!response.ok) throw new Error('Error al procesar el cobro');

        // ✅ ÉXITO
        // 1. Cerramos el modal chiquito de pago
        setShowPayMethodModal(false);
        setBookingToPayId(null);

        // 2. 👇 IMPORTANTE: Recargamos la tabla de fondo
        // (Asegurate de usar el nombre real de tu función de carga)
        await loadClients(); 

        // 3. Actualizamos el modal grande (el detalle del cliente)
        // para que desaparezca la línea cobrada sin tener que cerrar y abrir
        if (selectedDebtor) {
            // Filtramos la reserva que acabamos de pagar
            const updatedBookings = selectedDebtor.bookings.filter((b: any) => b.id !== bookingToPayId);
            
            // Recalculamos el total adeudado restando lo que pagó
            const paidAmount = selectedDebtor.bookings.find((b: any) => b.id === bookingToPayId)?.total || 0;
            const newTotalDebt = selectedDebtor.totalDebt - paidAmount;

            // Si ya no debe nada, cerramos el modal grande también. Si debe, actualizamos los datos.
            if (newTotalDebt <= 0) {
                setSelectedDebtor(null); // 👋 Chau modal, ya no es deudor
                alert(`✅ ¡Deuda saldada por completo!`);
            } else {
                setSelectedDebtor({
                    ...selectedDebtor,
                    bookings: updatedBookings,
                    totalDebt: newTotalDebt
                });
                alert(`✅ Cobro registrado. Restan $${newTotalDebt}`);
            }
        }

    } catch (error) {
        console.error(error);
        alert("❌ Error al cobrar la deuda");
    }
};
  
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* TARJETAS KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-2xl flex items-center justify-between">
             <div><h3 className="text-blue-400 text-xs font-bold uppercase mb-1">Total Clientes</h3><p className="text-3xl font-mono text-white font-bold">{totalClients}</p></div>
             <div className="bg-blue-500/20 p-3 rounded-full text-blue-400"><Users size={24} /></div>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/20 p-5 rounded-2xl flex items-center justify-between">
             <div><h3 className="text-purple-400 text-xs font-bold uppercase mb-1">Más Fiel</h3><p className="text-lg text-white font-bold truncate max-w-[150px]">{topClient.name}</p></div>
             <div className="bg-purple-500/20 p-3 rounded-full text-purple-400"><Trophy size={24} /></div>
          </div>
          <div className={`border p-5 rounded-2xl flex items-center justify-between ${totalDebt > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
             <div><h3 className={`${totalDebt > 0 ? 'text-red-400' : 'text-emerald-400'} text-xs font-bold uppercase mb-1`}>{totalDebt > 0 ? 'Fiado / A Cobrar' : 'Cuentas al Día'}</h3><p className={`text-3xl font-mono font-bold ${totalDebt > 0 ? 'text-white' : 'text-emerald-400'}`}>${totalDebt.toLocaleString()}</p></div>
             <div className={`${totalDebt > 0 ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'} p-3 rounded-full`}><DollarSign size={24} /></div>
          </div>
      </div>

      {/* TABLA + BUSCADOR */}
      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-bold text-text flex items-center gap-2">📋 Directorio de Clientes</h2>
            <div className="relative w-full md:w-72">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div>
                <input type="text" className="block w-full pl-10 pr-3 py-2 border border-gray-700 rounded-lg bg-gray-900 text-gray-300 placeholder-gray-500 focus:outline-none focus:border-emerald-500 sm:text-sm" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                {searchTerm && (<button onClick={() => setSearchTerm('')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-white"><X size={14} /></button>)}
            </div>
        </div>
        
        {loading ? <p className="text-center py-10 text-gray-500">Cargando...</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-xs uppercase text-muted border-b border-border bg-gray-900/30">
                  <th className="p-4 rounded-tl-lg">Cliente</th>
                  <th className="p-4">DNI</th> {/* 👈 NUEVA COLUMNA */}
                  <th className="p-4">Contacto</th>
                  <th className="p-4">Historial</th>
                  <th className="p-4">Estado de Cuenta</th>
                  <th className="p-4 text-right rounded-tr-lg">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.length > 0 ? (
                    filteredClients.map((client) => (
                    <tr key={client.id} className="border-b border-border/50 hover:bg-surface-80 transition group">
                        
                        {/* NOMBRE */}
                        <td className="p-4 font-bold text-white flex items-center gap-3">
                           <div className="bg-gray-700 p-2 rounded-full"><User size={16} /></div>
                           {client.name}
                        </td>
                        <td className="p-4 text-muted text-xs font-mono">
                           {client.dni !== '-' ? (
                             <span className="bg-gray-800 border border-gray-700 px-2 py-1 rounded text-gray-300">
                               {client.dni}
                             </span>
                           ) : <span className="opacity-50">-</span>}
                        </td>
                        <td className="p-4 text-muted text-xs font-mono">
                            {client.phone ? <span className="flex items-center gap-1"><Phone size={12}/> {client.phone}</span> : '-'}
                        </td>
                        <td className="p-4"><span className="bg-gray-800 px-2 py-1 rounded text-xs text-gray-300">{client.totalBookings} reservas</span></td>
                        <td className="p-4">
                        {client.totalDebt > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 px-3 py-1 rounded-full text-xs font-bold border border-red-500/20">
                                DEBE: ${client.totalDebt.toLocaleString()}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-bold">✓ AL DÍA</span>
                        )}
                        </td>
                        <td className="p-4 text-right">
                        {client.totalDebt > 0 ? (
                            <button onClick={() => setSelectedDebtor(client)} className="text-xs bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg transition shadow-lg shadow-red-900/20 flex items-center gap-2 ml-auto font-bold">
                            <DollarSign size={14}/> SALDAR DEUDA
                            </button>
                        ) : (
                            <button onClick={() => alert('Historial de ' + client.name)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 px-3 py-2 rounded-lg transition ml-auto">Ver Historial</button>
                        )}
                        </td>
                    </tr>
                    ))
                ) : (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-500 italic">No se encontraron clientes que coincidan con "{searchTerm}".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RENDERIZAMOS EL MODAL SI HAY UN DEUDOR SELECCIONADO */}
      {selectedDebtor && (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 animate-in fade-in">
        <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* CABECERA */}
            <div className="p-6 border-b border-gray-800 bg-gray-950 flex justify-between items-center">
                <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        🔴 Deuda de {selectedDebtor.name}
                    </h3>
                    <p className="text-gray-400 text-sm mt-1">
                        Total adeudado: <span className="text-red-400 font-mono font-bold">${selectedDebtor.totalDebt}</span>
                    </p>
                </div>
                <button onClick={() => setSelectedDebtor(null)} className="text-gray-500 hover:text-white transition">
                    ✕
                </button>
            </div>

            {/* LISTA DE RESERVAS IMPAGAS */}
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-3">
                {selectedDebtor.bookings
                    .filter((b: any) => b.paymentStatus === 'DEBT' || b.paymentStatus === 'PENDING') // Filtramos solo lo que debe
                    .map((booking: any) => (
                        <div key={booking.id} className="bg-gray-800/50 border border-gray-700 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-center gap-4">
                            
                            {/* Info de la Reserva */}
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-emerald-400 font-bold text-sm">#{booking.id}</span>
                                    <span className="text-gray-300 font-medium">| {new Date(booking.date).toLocaleDateString()} - {new Date(booking.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
                                <div className="text-sm text-gray-400">
                                    Cancha: {booking.courtName || 'Cancha'}
                                </div>
                                {/* Si tiene productos extra */}
                                {booking.items && booking.items.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {booking.items.map((item: any, i: number) => (
                                            <span key={i} className="text-[10px] bg-gray-700 px-2 py-0.5 rounded text-gray-300">
                                                {item.quantity}x {item.product?.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Monto y Botón de Cobrar */}
                            <div className="flex items-center gap-4">
                                <div className="text-right">
                                    <div className="text-lg font-bold text-white font-mono">${booking.total}</div>
                                    <div className="text-[10px] text-red-400 uppercase tracking-wider font-bold">Impago</div>
                                </div>
                                
                                <button
                                    onClick={() => handleOpenPayModal(booking.id)} // <--- ESTO ABRE EL MODAL DE CASH/TRANSFER
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-lg shadow-emerald-900/20 transition-all active:scale-95 flex items-center gap-2"
                                >
                                    💵 Cobrar
                                </button>
                            </div>
                        </div>
                ))}
                
                {selectedDebtor.bookings.filter((b: any) => b.paymentStatus === 'DEBT').length === 0 && (
                    <p className="text-center text-gray-500 py-4">No hay reservas pendientes (Error visual: actualice la página)</p>
                )}

                {showPayMethodModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] animate-in fade-in">
                    <div className="bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl w-80 relative">
                        
                        <button 
                            onClick={() => setShowPayMethodModal(false)}
                            className="absolute top-2 right-2 text-gray-500 hover:text-white"
                        >✕</button>

                        <h3 className="text-lg font-bold text-white mb-4 text-center">Cobrar Deuda</h3>
                        
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => processDebtPayment('CASH')}
                                className="p-3 bg-emerald-900/40 border border-emerald-700 hover:bg-emerald-800 rounded-lg text-emerald-400 flex flex-col items-center transition-all hover:scale-105"
                            >
                                <span className="text-2xl mb-1">💵</span>
                                <span className="text-xs font-bold uppercase">Efectivo</span>
                            </button>

                            <button
                                onClick={() => processDebtPayment('TRANSFER')}
                                className="p-3 bg-blue-900/40 border border-blue-700 hover:bg-blue-800 rounded-lg text-blue-400 flex flex-col items-center transition-all hover:scale-105"
                            >
                                <span className="text-2xl mb-1">💳</span>
                                <span className="text-xs font-bold uppercase">Transfer</span>
                            </button>
                        </div>
                        
                        <p className="text-center text-xs text-gray-500 mt-4">
                            Esto sumará el dinero a la caja de hoy.
                        </p>
                    </div>
                </div>
            )}
            </div>

            <div className="p-4 border-t border-gray-800 bg-gray-950 text-right">
                <button onClick={() => setSelectedDebtor(null)} className="text-gray-400 hover:text-white text-sm underline">
                    Cerrar
                </button>
            </div>
        </div>
    </div>

    
)}
    </div>
  );
}