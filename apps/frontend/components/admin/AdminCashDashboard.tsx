import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpCircle, ArrowDownCircle, Banknote, CreditCard, Plus } from 'lucide-react';

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

  // Formulario simple para agregar manual (luego lo haremos modal)
  const [newMove, setNewMove] = useState({ description: '', amount: '', type: 'INCOME', method: 'CASH' });

  const fetchCash = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      
      // 1. Recuperamos el token del almacenamiento local
      // (Asegurate de que se llame 'token' o 'authToken' en tu localStorage)
      const token = localStorage.getItem('token'); 

      if (!token) {
        console.error("No hay token, el usuario no está logueado.");
        return;
      }

      console.log("Intentando conectar a:", `${API_URL}/api/cash`);

      const res = await fetch(`${API_URL}/api/cash`, {
         method: 'GET',
         headers: {
           'Content-Type': 'application/json',
           // 2. 👇 ESTA ES LA CLAVE: Enviamos la credencial
           'Authorization': `Bearer ${token}` 
         }
      });

      if (!res.ok) {
        // Si el token expiró, esto te avisará
        if (res.status === 401) throw new Error('Sesión expirada o no autorizado');
        throw new Error(`Error del servidor: ${res.status}`);
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
    
    const token = localStorage.getItem('token'); // <--- Recuperar token
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

    await fetch(`${API_URL}/api/cash`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // <--- Enviar token
      },
      body: JSON.stringify(newMove)
    });
    
    setNewMove({ description: '', amount: '', type: 'INCOME', method: 'CASH' });
    fetchCash(); 
  };

  if (loading) return <div className="text-white p-10">Cargando Billetera...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-4">
      
      {/* HEADER DE BALANCE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* TARJETA PRINCIPAL: TOTAL */}
        <div className="...">
        {/* ... icono ... */}
        <h3 className="...">Balance Total (Hoy)</h3>
        <div className="text-5xl font-mono font-bold text-white mb-4">
            {/* 👇 AGREGÁ EL ? Y EL || 0 */}
            ${(balance?.total || 0).toLocaleString()}
        </div>
        <div className="flex gap-4 text-xs font-bold font-mono">
            <span className="text-emerald-400 ...">
            {/* 👇 AGREGÁ EL ? Y EL || 0 */}
            <ArrowUpCircle size={14}/> IN: ${(balance?.income || 0).toLocaleString()}
            </span>
            <span className="text-red-400 ...">
            {/* 👇 AGREGÁ EL ? Y EL || 0 */}
            <ArrowDownCircle size={14}/> OUT: ${(balance?.expense || 0).toLocaleString()}
            </span>
        </div>
        </div>

        {/* TARJETA: CAJA FÍSICA (Lo que hay en el cajón) */}
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-500/10 rounded-lg text-green-400"><Banknote size={24} /></div>
            <h3 className="text-gray-300 font-bold">Efectivo en Caja</h3>
          </div>
          <p className="text-3xl font-mono text-white font-bold">${(balance?.cash || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-2">Dinero físico disponible</p>
        </div>

        {/* TARJETA: DIGITAL (MercadoPago/Bancos) */}
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400"><CreditCard size={24} /></div>
            <h3 className="text-gray-300 font-bold">Banco / Digital</h3>
          </div>
          <p className="text-3xl font-mono text-white font-bold">${(balance?.digital || 0).toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-2">Transferencias acumuladas</p>
        </div>
      </div>

      {/* SECCIÓN DE MOVIMIENTOS Y AGREGAR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUMNA IZQUIERDA: LISTA DE MOVIMIENTOS */}
        <div className="lg:col-span-2 bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-gray-800 bg-gray-900/50 flex justify-between items-center">
            <h3 className="text-white font-bold">Movimientos del Día</h3>
            <span className="text-xs text-gray-500 bg-gray-900 px-2 py-1 rounded border border-gray-800">
              {new Date().toLocaleDateString()}
            </span>
          </div>
          
          <div className="max-h-[400px] overflow-y-auto">
            {movements.length === 0 ? (
              <div className="p-10 text-center text-gray-600">No hay movimientos hoy.</div>
            ) : (
              <table className="w-full text-left text-sm text-gray-400">
                <thead className="bg-gray-900 text-xs uppercase font-bold text-gray-500 sticky top-0">
                  <tr>
                    <th className="p-4">Hora</th>
                    <th className="p-4">Descripción</th>
                    <th className="p-4">Método</th>
                    <th className="p-4 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-900/50 transition-colors">
                      <td className="p-4 font-mono text-xs text-gray-500">
                        {new Date(m.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </td>
                      <td className="p-4 text-white font-medium">{m.description}</td>
                      <td className="p-4">
                        <span className={`text-[10px] px-2 py-1 rounded border ${
                          m.method === 'CASH' 
                            ? 'bg-green-900/20 border-green-800 text-green-400' 
                            : 'bg-blue-900/20 border-blue-800 text-blue-400'
                        }`}>
                          {m.method === 'CASH' ? 'EFECTIVO' : 'DIGITAL'}
                        </span>
                      </td>
                      <td className={`p-4 text-right font-mono font-bold ${
                        m.type === 'INCOME' ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {m.type === 'INCOME' ? '+' : '-'}${m.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* COLUMNA DERECHA: AGREGAR RÁPIDO */}
        <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 h-fit">
          <h3 className="text-white font-bold mb-4 flex items-center gap-2">
            <Plus size={18} className="text-emerald-500"/> Nuevo Movimiento
          </h3>
          
          <form onSubmit={handleAddMovement} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Concepto</label>
              <input 
                type="text" 
                placeholder="Ej: Retiro de Efectivo, Compra Pelotas..."
                className="w-full bg-gray-950 border border-gray-700 rounded p-3 text-white focus:border-emerald-500 focus:outline-none text-sm"
                value={newMove.description}
                onChange={e => setNewMove({...newMove, description: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Monto</label>
                <input 
                  type="number" 
                  placeholder="0.00"
                  className="w-full bg-gray-950 border border-gray-700 rounded p-3 text-white focus:border-emerald-500 focus:outline-none text-sm font-mono"
                  value={newMove.amount}
                  onChange={e => setNewMove({...newMove, amount: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Tipo</label>
                <select 
                  className="w-full bg-gray-950 border border-gray-700 rounded p-3 text-white focus:border-emerald-500 focus:outline-none text-sm"
                  value={newMove.type}
                  onChange={e => setNewMove({...newMove, type: e.target.value})}
                >
                  <option value="INCOME">Ingreso (+)</option>
                  <option value="EXPENSE">Gasto (-)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Método de Pago</label>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'CASH'})}
                  className={`p-2 rounded text-xs font-bold border ${newMove.method === 'CASH' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
                >
                  💵 Efectivo
                </button>
                <button 
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'TRANSFER'})}
                  className={`p-2 rounded text-xs font-bold border ${newMove.method === 'TRANSFER' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}
                >
                  💳 Digital
                </button>
              </div>
            </div>

            <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow-lg transition-all mt-2">
              Registrar Movimiento
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};

export default AdminCashDashboard;