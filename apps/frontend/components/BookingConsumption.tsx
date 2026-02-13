import { useState, useEffect, useCallback } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Trash2, Plus, ShoppingCart, Receipt, Lock } from 'lucide-react';
import { BookingTicket } from './BookingTicket';

interface Props {
  bookingId: number;
  slug: string;
  courtPrice?: number;
  paymentStatus: string;
  onClose: () => void;
  onConfirm: () => void;
}

interface CartItem {
  id?: number;
  tempId?: string;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  isNew: boolean;
}

export default function BookingConsumption({ bookingId, slug, courtPrice = 0, paymentStatus, onClose, onConfirm }: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [itemsToDelete, setItemsToDelete] = useState<number[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Formulario
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [productsData, currentItems] = await Promise.all([
        ClubAdminService.getProducts(slug),
        ClubAdminService.getBookingItems(bookingId)
      ]);

      setProducts(productsData || []);

      const formattedItems = (currentItems || []).map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.price,
        isNew: false
      }));
      
      setCartItems(formattedItems);
      setItemsToDelete([]); 
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [bookingId, slug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddToDraft = () => {
    if (!selectedProductId) return;
    const product = products.find(p => p.id === Number(selectedProductId));
    if (!product) return;

    const newItem: CartItem = {
      tempId: `new-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      quantity: quantity,
      price: product.price,
      isNew: true
    };

    setCartItems([...cartItems, newItem]);
    setQuantity(1);
    setSelectedProductId('');
  };

  const handleRemoveFromDraft = (item: CartItem) => {
    if (!item.isNew && item.id) {
      setItemsToDelete([...itemsToDelete, item.id]);
    }
    setCartItems(cartItems.filter(i => item.isNew ? i.tempId !== item.tempId : i.id !== item.id));
  };

  const handleSaveChanges = async (targetBookingStatus: 'PAID' | 'DEBT' | 'PARTIAL', itemPaymentMethod: 'CASH' | 'DEBT' | 'TRANSFER') => {
    try {
      setSaving(true);
      await ClubAdminService.updateBookingPaymentStatus(bookingId, targetBookingStatus);
      const deletePromises = itemsToDelete.map(id => ClubAdminService.removeItemFromBooking(id));
      const newItems = cartItems.filter(i => i.isNew);
      const addPromises = newItems.map(item => 
        ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, itemPaymentMethod)
      );
      await Promise.all([...deletePromises, ...addPromises]);
      onConfirm(); 
      onClose();
    } catch (error: any) {
      alert("Error: " + (error.message || "Intente nuevamente"));
    } finally {
      setSaving(false);
    }
  };

  const isCourtResolved = paymentStatus === 'PAID' || paymentStatus === 'PARTIAL' || paymentStatus === 'DEBT';
  const courtPriceToPay = isCourtResolved ? 0 : (courtPrice || 0);
  const BASE_COURT_PRICE = 28000;
  const lightsExtra = Math.max((courtPrice || 0) - BASE_COURT_PRICE, 0);

  const consumptionTotal = cartItems
    .filter(item => item.isNew)
    .reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const finalTotal = courtPriceToPay + consumptionTotal;

  const handlePaymentConfirm = (method: 'CASH' | 'TRANSFER') => {
      let nextStatus: 'PAID' | 'PARTIAL' | 'DEBT' = 'PAID';
      if (paymentStatus === 'DEBT') {
          nextStatus = 'PARTIAL';
      } 
      else if (paymentStatus === 'PARTIAL') {
          nextStatus = 'PARTIAL';
      }
      handleSaveChanges(nextStatus, method);
      setShowPaymentModal(false);
  };

  return (
    <div className="space-y-6 text-[#347048]">
      {/* SECCIÓN: AGREGAR CONSUMO (Diseño Beige Wimbledon) */}
      <div className="bg-[#347048]/5 p-5 rounded-2xl border border-[#347048]/10">
        <h3 className="text-[#926699] font-black flex items-center gap-2 mb-4 text-xs uppercase tracking-[0.1em]">
          <ShoppingCart size={16} strokeWidth={3} /> Agregar Consumo / Extra
        </h3>
        <div className="flex gap-3">
            <select 
                className="flex-1 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 py-3 text-[#347048] font-bold text-sm shadow-sm outline-none transition-all appearance-none cursor-pointer"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
            >
                <option value="">Seleccionar producto...</option>
                {products.map(p => (
                <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                    {p.name} (${p.price}) {p.stock <= 0 ? '(Sin Stock)' : ''}
                </option>
                ))}
            </select>
      <input 
                type="number" min="1" 
                className="w-20 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-2 text-center text-[#347048] font-black shadow-sm outline-none"
                value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
            />
            <button 
                onClick={handleAddToDraft} disabled={!selectedProductId}
                className="bg-[#926699] hover:bg-[#7a5580] disabled:opacity-30 text-[#EBE1D8] p-3 rounded-xl transition-all shadow-md active:scale-95"
            >
                <Plus size={24} strokeWidth={3} />
            </button>
        </div>
      </div>

      {/* LISTA DE ITEMS (Diseño Limpio y Contrastado) */}
      <div className="bg-white/40 rounded-2xl border-2 border-dashed border-[#347048]/10 overflow-hidden min-h-[120px]">
        {cartItems.length === 0 ? (
           <div className="flex flex-col items-center justify-center py-10 opacity-40 italic">
              <Receipt size={32} className="mb-2" />
              <p className="text-sm font-bold uppercase tracking-widest">Sin consumos cargados</p>
           </div>
        ) : (
          <div className="divide-y divide-[#347048]/5">
            {cartItems.map((item) => (
              <div 
                key={item.isNew ? item.tempId : item.id} 
                className={`flex justify-between items-center p-4 transition-colors ${item.isNew ? 'bg-white/60' : 'bg-transparent opacity-60'}`}
              >
                <div className="text-sm flex items-center">
                  <span className="font-black text-[#347048] bg-[#347048]/10 w-8 h-8 flex items-center justify-center rounded-lg mr-3 italic">{item.quantity}x</span> 
                  <div className="flex flex-col">
                    <span className="text-[#347048] font-black uppercase tracking-tight leading-none mb-1">{item.productName}</span>
                    {item.isNew ? (
                      <span className="text-[9px] text-[#B9CF32] font-black tracking-widest uppercase">✨ Pendiente de cobro</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[9px] text-[#347048]/40 font-black uppercase tracking-widest"><Lock size={8} /> Ya cargado en cuenta</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`font-black text-sm ${item.isNew ? 'text-[#347048]' : 'text-[#347048]/50'}`}>${(item.price * item.quantity).toLocaleString()}</span>
                  {item.isNew ? (
                    <button onClick={() => handleRemoveFromDraft(item)} className="text-red-400 hover:text-red-600 transition p-2 hover:bg-red-50 rounded-xl"><Trash2 size={18} strokeWidth={2.5} /></button>
                  ) : <div className="w-9 flex justify-center text-[#347048]/20"><Lock size={16} /></div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TICKET FINAL (Ultra Legible Estilo Wimbledon) */}
      <div className="bg-white border-4 border-[#B9CF32]/30 rounded-[2rem] p-6 shadow-sm relative overflow-hidden">
        <div className="space-y-2 mb-5">
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest opacity-60">
            <span>Alquiler Cancha</span>
            <div className="flex items-center gap-3">
                {isCourtResolved && (
                    <span className={`px-2 py-0.5 rounded-md font-black border ${paymentStatus === 'DEBT' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                        {paymentStatus === 'DEBT' ? 'EN CUENTA' : 'PAGADO'}
                    </span>
                )}
                <span className={isCourtResolved ? "line-through opacity-50" : ""}>
                    ${(courtPrice || 0).toLocaleString()}
                </span>
            </div>
          </div>
          
          {lightsExtra > 0 && (
            <div className="flex justify-between text-[10px] font-black text-[#926699] uppercase tracking-widest">
              <span>+ Extra por luces</span>
              <span>${lightsExtra.toLocaleString()}</span>
            </div>
          )}
          
          <div className="flex justify-between text-[10px] font-black text-[#347048] uppercase tracking-widest">
            <span>Consumos (Nuevos)</span>
            <span>${consumptionTotal.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex justify-between items-end pt-4 border-t-2 border-dashed border-[#347048]/10">
          <span className="text-[#347048]/50 font-black text-[10px] uppercase tracking-[0.2em] mb-1">Total a Cobrar</span>
          <span className="text-5xl font-black text-[#347048] tracking-tighter leading-none italic">
            ${finalTotal.toLocaleString()}
          </span>
        </div>
      </div>

      {/* BOTONES DE ACCIÓN (Contraste Profesional) */}
      <div className="grid grid-cols-2 gap-4 pt-2">
        <button 
          onClick={() => {
              const nextStatus = (paymentStatus === 'PAID' || paymentStatus === 'PARTIAL') ? 'PARTIAL' : 'DEBT';
              handleSaveChanges(nextStatus, 'DEBT');
          }}
          disabled={saving}
          className="flex flex-col items-center justify-center gap-1 py-4 bg-[#EBE1D8] border-2 border-[#347048]/20 text-[#347048] font-black uppercase text-[10px] tracking-widest rounded-2xl transition-all hover:bg-white shadow-sm disabled:opacity-30"
        >
          <div className="flex items-center gap-2"><span className="text-lg">📝</span> Dejar en Cuenta</div>
        </button>
        
        <button 
          onClick={() => setShowPaymentModal(true)} 
          disabled={saving || cartItems.filter(i => i.isNew).length === 0}
          className="flex flex-col items-center justify-center gap-1 py-4 bg-[#B9CF32] text-[#347048] font-black uppercase text-[10px] tracking-widest rounded-2xl shadow-xl shadow-[#B9CF32]/20 transition-all hover:-translate-y-1 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2"><span className="text-lg">💵</span> Cobrar Total</div>
        </button>
      </div>

      {/* MODAL DE COBRO (Paleta Beige Wimbledon) */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-[#347048]/80 backdrop-blur-md flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
            <div className="bg-[#EBE1D8] border-4 border-white p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full relative">
                <button 
                    onClick={() => setShowPaymentModal(false)}
                    className="absolute top-6 right-6 text-[#347048]/40 hover:text-[#347048] transition font-black"
                >✕</button>

                <h3 className="text-2xl font-black text-[#347048] mb-2 text-center uppercase tracking-tight italic">Cobrar Consumo</h3>
                <p className="text-[#347048]/60 text-xs font-bold mb-8 text-center uppercase tracking-widest">
                    Total: <span className="text-[#347048] text-lg font-black">${consumptionTotal.toLocaleString()}</span>
                </p>
                
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <button
                        onClick={() => handlePaymentConfirm('CASH')}
                        className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-3xl text-[#347048] transition-all hover:scale-[1.02] shadow-sm group"
                    >
                        <span className="text-3xl mb-2 group-hover:scale-110 transition">💵</span>
                        <span className="font-black text-[10px] uppercase tracking-widest">Efectivo</span>
                    </button>

                    <button
                        onClick={() => handlePaymentConfirm('TRANSFER')}
                        className="flex flex-col items-center justify-center p-6 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-3xl text-[#347048] transition-all hover:scale-[1.02] shadow-sm group"
                    >
                        <span className="text-3xl mb-2 group-hover:scale-110 transition">💳</span>
                        <span className="font-black text-[10px] uppercase tracking-widest">Digital</span>
                    </button>
                </div>
                
                <button 
                    onClick={() => setShowPaymentModal(false)}
                    className="w-full text-[#347048]/40 hover:text-[#347048] text-[10px] font-black uppercase tracking-widest hover:underline transition-all"
                >
                    Cancelar operación
                </button>
            </div>
        </div>
      )}
    </div>
  );
}