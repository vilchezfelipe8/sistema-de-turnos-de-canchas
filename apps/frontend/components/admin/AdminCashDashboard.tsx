import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpCircle, ArrowDownCircle, Banknote, CreditCard, Plus, Receipt, History } from 'lucide-react';

// Tipos
interface Movement {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  method: 'CASH' | 'TRANSFER';
}

interface Balance {
  total: number;
  cash: number;
  digital: number;
  income: number;
  expense: number;
}

const AdminCashDashboard = () => {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [balance, setBalance] = useState<Balance>({ total: 0, cash: 0, digital: 0, income: 0, expense: 0 });
  const [loading, setLoading] = useState(true);

  // Formulario
  const [newMove, setNewMove] = useState({ description: '', amount: '', type: 'INCOME', method: 'CASH' });

  const fetchCash = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const token = localStorage.getItem('token'); 

      if (!token) return;

      const res = await fetch(`${API_URL}/api/cash`, {
         method: 'GET',
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${token}` 
         }
      });

      if (!res.ok) {
        if (res.status === 401) throw new Error('Sesión expirada');
        throw new Error(`Error: ${res.status}`);
      }

      const data = await res.json();
      if (data && data.balance) setBalance(data.balance);
      if (data && data.movements) setMovements(data.movements);

    } catch (error) {
      console.error("❌ Error cargando la caja:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCash(); }, []);

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMove.amount || !newMove.description) return;
    
    const token = localStorage.getItem('token');
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

    await fetch(`${API_URL}/api/cash`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(newMove)
    });
    
    setNewMove({ description: '', amount: '', type: 'INCOME', method: 'CASH' });
    fetchCash(); 
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-[#EBE1D8]"></div>
        <p className="text-[#EBE1D8] font-black uppercase tracking-widest mt-4">Cargando Billetera...</p>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* TÍTULO DE SECCIÓN */}
      <div className="flex items-center justify-between mb-2">
        <div>
            <h2 className="text-3xl font-black text-[#EBE1D8] flex items-center gap-3 uppercase italic tracking-tighter">
            <span className="bg-[#B9CF32] text-[#347048] p-2 rounded-xl text-2xl shadow-lg shadow-[#B9CF32]/20 italic">💰</span>
            Caja y Movimientos
            </h2>
            <p className="text-[#EBE1D8]/60 text-xs font-bold uppercase tracking-[0.2em] mt-1 ml-14">Resumen diario y control de flujo</p>
        </div>
        <div className="bg-[#347048]/40 border border-[#EBE1D8]/10 px-4 py-2 rounded-2xl backdrop-blur-sm">
            <span className="text-[#EBE1D8] font-black text-sm uppercase italic">{new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}</span>
        </div>
      </div>

      {/* HEADER DE BALANCE (TARJETAS BLANCAS) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* BALANCE TOTAL */}
        <div className="bg-white border-4 border-white p-6 rounded-[2.5rem] shadow-xl flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-[#347048]/5 rounded-2xl text-[#347048]"><Wallet size={24} strokeWidth={2.5} /></div>
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Balance Hoy</span>
          </div>
          <p className="text-4xl font-black text-[#347048] italic tracking-tighter mb-4">
            ${(balance?.total || 0).toLocaleString()}
          </p>
          <div className="flex gap-2 text-[9px] font-black uppercase tracking-wider">
            <span className="text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 flex items-center gap-1">
              <ArrowUpCircle size={12}/> +${(balance?.income || 0).toLocaleString()}
            </span>
            <span className="text-red-500 bg-red-50 px-3 py-1 rounded-full border border-red-100 flex items-center gap-1">
              <ArrowDownCircle size={12}/> -${(balance?.expense || 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* EFECTIVO EN CAJA */}
        <div className="bg-white border-4 border-white p-6 rounded-[2.5rem] shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600"><Banknote size={24} strokeWidth={2.5} /></div>
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Efectivo Físico</span>
          </div>
          <p className="text-4xl font-black text-[#347048] italic tracking-tighter mb-4">
            ${(balance?.cash || 0).toLocaleString()}
          </p>
          <p className="text-[10px] font-bold text-[#347048]/40 uppercase italic tracking-widest">Dinero en caja fuerte</p>
        </div>

        {/* DIGITAL / TRANSFERENCIAS */}
        <div className="bg-white border-4 border-white p-6 rounded-[2.5rem] shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><CreditCard size={24} strokeWidth={2.5} /></div>
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Banco / Digital</span>
          </div>
          <p className="text-4xl font-black text-[#347048] italic tracking-tighter mb-4">
            ${(balance?.digital || 0).toLocaleString()}
          </p>
          <p className="text-[10px] font-bold text-[#347048]/40 uppercase italic tracking-widest">MercadoPago y Bancos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LISTA DE MOVIMIENTOS (ESTILO TABLA BEIGE) */}
        <div className="lg:col-span-2 bg-[#EBE1D8] border-4 border-white/50 rounded-[2.5rem] overflow-hidden shadow-2xl shadow-[#347048]/20 flex flex-col min-h-[500px]">
          <div className="p-6 border-b border-[#347048]/10 flex justify-between items-center bg-[#EBE1D8]">
            <h3 className="text-xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tight">
                <History size={20} className="text-[#926699]" /> Actividad Reciente
            </h3>
            <span className="text-[10px] font-black text-[#347048]/50 bg-white/40 px-4 py-1.5 rounded-full border border-white/60 uppercase tracking-widest">
              Últimas 24hs
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-white/40">
            {movements.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30 italic">
                  <Receipt size={48} className="mb-4" />
                  <p className="text-lg font-black uppercase tracking-widest text-[#347048]">No hay movimientos hoy</p>
              </div>
            ) : (
              <div className="space-y-3">
                {movements.map((m) => (
                  <div key={m.id} className="bg-white p-4 rounded-2xl flex items-center justify-between shadow-sm border border-[#347048]/5 hover:scale-[1.01] transition-transform">
                    <div className="flex items-center gap-4">
                        <div className="text-right pr-4 border-r border-[#347048]/10">
                            <span className="block text-xs font-black text-[#347048]">
                                {new Date(m.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                            <span className="text-[9px] font-bold text-[#347048]/40 uppercase">Hora</span>
                        </div>
                        <div>
                            <span className="block text-sm font-black text-[#347048] uppercase tracking-tight leading-none mb-1">
                                {m.description}
                            </span>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest ${
                                m.method === 'CASH' 
                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                                    : 'bg-blue-50 text-blue-600 border-blue-100'
                            }`}>
                                {m.method === 'CASH' ? '💵 Efectivo' : '💳 Digital'}
                            </span>
                        </div>
                    </div>
                    <div className={`text-xl font-black italic tracking-tighter ${
                        m.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                        {m.type === 'INCOME' ? '+' : '-'}${m.amount.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* FORMULARIO AGREGAR RÁPIDO (TARJETA BEIGE SÓLIDA) */}
        <div className="bg-[#EBE1D8] border-4 border-white p-8 rounded-[2.5rem] shadow-2xl h-fit">
          <h3 className="text-xl font-black text-[#926699] mb-8 flex items-center gap-3 uppercase italic tracking-tight">
            <Plus size={24} strokeWidth={3} className="bg-[#926699] text-[#EBE1D8] rounded-lg p-1" /> Nuevo Registro
          </h3>
          
          <form onSubmit={handleAddMovement} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Concepto / Detalle</label>
              <input 
                type="text" 
                placeholder="Ej: Retiro, Compra Insumos..."
                className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl p-4 text-[#347048] font-bold focus:outline-none shadow-sm placeholder-[#347048]/20 transition-all"
                value={newMove.description}
                onChange={e => setNewMove({...newMove, description: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Monto ($)</label>
                <input 
                  type="number" 
                  placeholder="0"
                  className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl p-4 text-[#347048] font-black focus:outline-none shadow-sm transition-all"
                  value={newMove.amount}
                  onChange={e => setNewMove({...newMove, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Operación</label>
                <select 
                  className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl p-4 text-[#347048] font-bold focus:outline-none shadow-sm appearance-none cursor-pointer"
                  value={newMove.type}
                  onChange={e => setNewMove({...newMove, type: e.target.value})}
                >
                  <option value="INCOME">Ingreso (+)</option>
                  <option value="EXPENSE">Gasto (-)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Medio de Pago</label>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'CASH'})}
                  className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      newMove.method === 'CASH' 
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg' 
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                >
                  💵 Efectivo
                </button>
                <button 
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'TRANSFER'})}
                  className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      newMove.method === 'TRANSFER' 
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg' 
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                >
                  💳 Digital
                </button>
              </div>
            </div>

            <button type="submit" className="w-full py-4 bg-[#B9CF32] hover:bg-[#aebd2b] text-[#347048] font-black rounded-[1.5rem] shadow-xl shadow-[#B9CF32]/20 transition-all hover:-translate-y-1 uppercase tracking-widest text-sm italic mt-2">
              Registrar Movimiento
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};

export default AdminCashDashboard;