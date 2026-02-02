import { useState, useEffect } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Trash2, Plus, ShoppingCart, Receipt } from 'lucide-react';

interface Props {
  bookingId: number;
  slug: string;
  courtPrice?: number; // 👈 NUEVO: Recibimos el precio de la cancha (Opcional)
}

export default function BookingConsumption({ bookingId, slug, courtPrice = 0 }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Formulario
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  // Cargar datos
  const loadData = async () => {
    try {
      setLoading(true);
      // 1. Productos (blindado)
      try {
        const p = await ClubAdminService.getProducts(slug);
        setProducts(p || []);
      } catch (e) { console.error("Error productos", e); }

      // 2. Consumos (blindado)
      try {
        const i = await ClubAdminService.getBookingItems(bookingId);
        setItems(i || []);
      } catch (e) { console.error("Error items", e); }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [bookingId]);

  const handleAddItem = async () => {
    if (!selectedProductId) return;
    try {
      await ClubAdminService.addItemToBooking(bookingId, Number(selectedProductId), quantity);
      const newItems = await ClubAdminService.getBookingItems(bookingId);
      setItems(newItems);
      setQuantity(1);
      setSelectedProductId('');
    } catch (error: any) { alert(error.message || 'Error al agregar'); }
  };

  const handleRemoveItem = async (itemId: number) => {
    if (!confirm('¿Borrar consumo?')) return;
    try {
      await ClubAdminService.removeItemFromBooking(itemId);
      const newItems = await ClubAdminService.getBookingItems(bookingId);
      setItems(newItems);
    } catch (error) { alert('Error al borrar'); }
  };

  // 💰 CÁLCULOS MATEMÁTICOS
  const consumptionTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const finalTotal = (courtPrice || 0) + consumptionTotal;

  return (
    <div className="space-y-4">
      {/* 1. CAJA DE AGREGAR PRODUCTOS */}
      <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
        <h3 className="text-white font-bold flex items-center gap-2 mb-3 text-sm">
          <ShoppingCart size={16} className="text-emerald-400" /> 
          AGREGAR CONSUMO
        </h3>
        
        <div className="flex gap-2">
          <select 
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none"
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
          >
            <option value="">Seleccionar...</option>
            {products.map(p => (
              <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                {p.name} (${p.price}) {p.stock <= 0 ? '(Sin Stock)' : ''}
              </option>
            ))}
          </select>
          
          <input 
            type="number" min="1" 
            className="w-16 bg-gray-900 border border-gray-600 rounded-lg px-2 text-center text-white text-sm"
            value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
          />

          <button 
            onClick={handleAddItem} disabled={!selectedProductId}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white p-2 rounded-lg transition"
          >
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* 2. LISTA DE ITEMS */}
      {items.length > 0 && (
        <div className="bg-gray-900/30 rounded-lg border border-gray-800 overflow-hidden">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between items-center p-3 border-b border-gray-800 last:border-0 hover:bg-white/5 transition">
              <div className="text-sm">
                <span className="font-bold text-white mr-2">{item.quantity}x</span> 
                <span className="text-gray-300">{item.product.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-white font-mono text-sm">${item.price * item.quantity}</span>
                <button onClick={() => handleRemoveItem(item.id)} className="text-gray-500 hover:text-red-400 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. TICKET FINAL (RESUMEN DE CUENTA) */}
      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-5 mt-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10"><Receipt size={60} /></div>
        
        <h4 className="text-emerald-400 text-xs font-bold uppercase tracking-wider mb-3 border-b border-emerald-500/20 pb-2">Resumen de Cuenta</h4>
        
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>Alquiler Cancha</span>
            <span>${courtPrice || 0}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Consumos</span>
            <span>${consumptionTotal}</span>
          </div>
        </div>

        <div className="flex justify-between items-end mt-4 pt-3 border-t border-dashed border-emerald-500/30">
          <span className="text-white font-bold text-lg">TOTAL A PAGAR</span>
          <span className="text-3xl font-bold text-emerald-400 font-mono tracking-tighter">
            ${finalTotal}
          </span>
        </div>
      </div>
    </div>
  );
}