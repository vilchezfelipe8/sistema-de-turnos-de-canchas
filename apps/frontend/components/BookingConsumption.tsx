import { useState, useEffect } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Trash2, Plus, ShoppingCart, Receipt, Lock } from 'lucide-react'; // 👈 Asegurate de tener Lock
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

  // 1. Cargar Datos
  useEffect(() => {
    loadData();
  }, [bookingId]);

  const loadData = async () => {
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
  };

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

  // 👇 LÓGICA CORE MODIFICADA 👇
  const handleSaveChanges = async (targetBookingStatus: 'PAID' | 'DEBT' | 'PARTIAL', itemPaymentMethod: 'CASH' | 'DEBT' | 'TRANSFER') => {
    try {
      setSaving(true);

      // 1. Actualizamos el estado de la reserva
      // IMPORTANTE: Si era DEUDA y ahora pagamos items en CASH, pasamos a PARTIAL.
      await ClubAdminService.updateBookingPaymentStatus(bookingId, targetBookingStatus);

      // 2. Borrados
      const deletePromises = itemsToDelete.map(id => ClubAdminService.removeItemFromBooking(id));
      // 3. Agregados (Con el método explícito que elegimos en el botón)
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

  // CÁLCULOS VISUALES 🧮
  // Consideramos la cancha "resuelta" si está PAGADA, PARCIAL O DEUDA.
  // Si está en DEUDA, se gestiona desde Clientes, no acá.
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
     
     // Si la cancha se debe (DEBT), y pagamos solo consumos -> PARTIAL
     if (paymentStatus === 'DEBT') {
         nextStatus = 'PARTIAL';
     } 
     // Si ya era parcial (cancha paga, items fiados), sigue PARTIAL (items nuevos pagos)
     else if (paymentStatus === 'PARTIAL') {
         nextStatus = 'PARTIAL';
     }
     
     // Ejecutamos el guardado enviando el método real (CASH o TRANSFER)
     handleSaveChanges(nextStatus, method);
     setShowPaymentModal(false); // Cerramos modal
  };

  return (
    <div className="space-y-4">
      {/* SELECCIÓN DE PRODUCTO (Igual que antes) */}
      <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
        <h3 className="text-white font-bold flex items-center gap-2 mb-3 text-sm uppercase tracking-wide">
          <ShoppingCart size={16} className="text-emerald-400" /> Agregar Consumo
        </h3>
        <div className="flex gap-2">
            <select 
                className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none"
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
                className="w-16 bg-gray-900 border border-gray-600 rounded-lg px-2 text-center text-white text-sm"
                value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
            />
            <button 
                onClick={handleAddToDraft} disabled={!selectedProductId}
                className="bg-gray-700 hover:bg-emerald-600 disabled:opacity-50 text-white p-2 rounded-lg transition"
            >
                <Plus size={20} />
            </button>
        </div>
      </div>

      {/* LISTA DE ITEMS (Igual a la última versión visual) */}
      <div className="bg-gray-900/30 rounded-lg border border-gray-800 overflow-hidden min-h-[100px]">
        {cartItems.length === 0 ? (
           <p className="text-gray-500 text-center py-8 text-sm italic">No hay consumos en esta lista.</p>
        ) : (
          cartItems.map((item) => (
            <div 
              key={item.isNew ? item.tempId : item.id} 
              className={`flex justify-between items-center p-3 border-b border-gray-800 last:border-0 transition ${item.isNew ? 'bg-emerald-500/5' : 'bg-transparent opacity-60'}`}
            >
              <div className="text-sm flex items-center">
                <span className="font-bold text-white mr-2">{item.quantity}x</span> 
                <span className="text-gray-300 mr-2">{item.productName}</span>
                {item.isNew ? (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-500/20">NUEVO</span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded border border-gray-700"><Lock size={10} /> YA CARGADO</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-mono text-sm ${item.isNew ? 'text-white' : 'text-gray-500'}`}>${item.price * item.quantity}</span>
                {item.isNew ? (
                  <button onClick={() => handleRemoveFromDraft(item)} className="text-gray-500 hover:text-red-400 transition p-1 hover:bg-white/5 rounded"><Trash2 size={16} /></button>
                ) : <div className="w-6 flex justify-center text-gray-600"><Lock size={14} /></div>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* TICKET FINAL */}
      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-5 relative overflow-hidden">
        <div className="space-y-1 text-sm mb-3">
          <div className="flex justify-between items-center text-gray-400">
            <span>Alquiler Cancha</span>
            <div className="flex items-center gap-2">
                {/* Si ya está resuelto (Pago, Parcial o Deuda), mostramos etiqueta */}
                {isCourtResolved && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${paymentStatus === 'DEBT' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}>
                        {paymentStatus === 'DEBT' ? 'EN CUENTA' : 'PAGADO'}
                    </span>
                )}
                <span className={isCourtResolved ? "text-gray-600 line-through" : "text-gray-400"}>
                    ${courtPrice || 0}
                </span>
            </div>
          </div>
          {lightsExtra > 0 && (
            <div className="flex justify-between text-[11px] text-emerald-200/80">
              <span>Incluye extra por luces</span>
              <span>+ ${lightsExtra}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-400">
            <span>Consumos (Nuevos)</span>
            <span>${consumptionTotal}</span>
          </div>
        </div>

        <div className="flex justify-between items-end pt-3 border-t border-dashed border-emerald-500/30">
          <span className="text-white font-bold text-lg">TOTAL A COBRAR</span>
          <span className="text-3xl font-bold text-emerald-400 font-mono tracking-tighter">
            ${finalTotal}
          </span>
        </div>
      </div>

      {/* BOTONES DE ACCIÓN (Lógica corregida) */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        
        {/* BOTÓN A: DEJAR EN CUENTA */}
        {/* Siempre manda todo a DEBT/PARTIAL y los items como 'DEBT' */}
        <button 
          onClick={() => {
             // Si ya estaba pagado, pasa a PARTIAL. Si era Deuda, sigue DEBT.
             const nextStatus = (paymentStatus === 'PAID' || paymentStatus === 'PARTIAL') ? 'PARTIAL' : 'DEBT';
             handleSaveChanges(nextStatus, 'DEBT');
          }}
          disabled={saving}
          className="flex flex-col items-center justify-center gap-1 px-4 py-3 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 rounded-xl transition group"
        >
          <div className="flex items-center gap-2 font-bold"><span className="text-lg">📝</span> Dejar en Cuenta</div>
        </button>
        
        {/* BOTÓN B: COBRAR TOTAL (Solo lo nuevo) */}
        {/* Cobra items en CASH. Si la cancha era DEBT, pasa a PARTIAL (Cancha debe, items pagos) */}
        <button 
          onClick={() => setShowPaymentModal(true)} // 👈 AHORA SOLO ABRE EL MODAL
          disabled={saving || cartItems.filter(i => i.isNew).length === 0}
          className="flex flex-col items-center justify-center gap-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2 font-bold"><span className="text-lg">💵</span> Cobrar Total</div>
        </button>
      </div>
      {/* MODAL DE COBRO (Tu diseño adaptado) */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200">
            <div className="bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl max-w-sm w-full relative">
                {/* Botón X para cerrar rápido */}
                <button 
                    onClick={() => setShowPaymentModal(false)}
                    className="absolute top-3 right-3 text-gray-500 hover:text-white transition"
                >✕</button>

                <h3 className="text-xl font-bold text-white mb-2 text-center">Cobrar Consumo</h3>
                <p className="text-gray-400 text-sm mb-6 text-center">
                    Total a cobrar: <span className="text-emerald-400 font-bold font-mono text-lg">${consumptionTotal}</span>
                    <br/>Selecciona el método:
                </p>
                
                {/* Grilla de opciones */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                    <button
                        // 👇 ACÁ USAMOS LA FUNCIÓN CORRECTA DEL CONSUMO
                        onClick={() => handlePaymentConfirm('CASH')}
                        className="flex flex-col items-center justify-center p-4 bg-emerald-900/30 border border-emerald-800 hover:bg-emerald-900/50 rounded-lg text-emerald-400 transition-all hover:scale-[1.02] group"
                    >
                        <span className="text-2xl mb-1 group-hover:scale-110 transition">💵</span>
                        <span className="font-bold text-sm uppercase tracking-wide">Efectivo</span>
                    </button>

                    <button
                        // 👇 ACÁ TAMBIÉN
                        onClick={() => handlePaymentConfirm('TRANSFER')}
                        className="flex flex-col items-center justify-center p-4 bg-blue-900/30 border border-blue-800 hover:bg-blue-900/50 rounded-lg text-blue-400 transition-all hover:scale-[1.02] group"
                    >
                        <span className="text-2xl mb-1 group-hover:scale-110 transition">💳</span>
                        <span className="font-bold text-sm uppercase tracking-wide">Digital / MP</span>
                    </button>
                </div>
                
                <p className="text-xs text-center text-gray-600 mt-2">
                    Esto cerrará la cuenta de los ítems nuevos.
                </p>
            </div>
        </div>
      )}
    </div>
  );
}