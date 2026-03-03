import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Trash2, Plus, ShoppingCart, Receipt, Lock, ChevronDown, Check, X, Banknote, CreditCard, FileText, Star } from 'lucide-react';
import PaymentCalculator from './PaymentCalculator';
// import { BookingTicket } from './BookingTicket'; // Si no lo usás, podés borrar esta línea

interface Props {
  bookingId: string | number;
  slug: string;
  courtPrice?: number;
  baseCourtPrice?: number | null;
  bookingStatus?: string;
  paymentStatus: string;
  onClose: () => void;
  onConfirm: () => void;
  autoOpenPayment?: boolean;
}

interface CartItem {
  id?: number;
  tempId?: string;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  isNew: boolean;
  isPaid?: boolean; 
}

export type BookingConsumptionHandle = {
  persistDraft: () => Promise<void>;
};

// --- COMPONENTE DROPDOWN CUSTOM (ESTILO WIMBLEDON LANDING) ---
const CustomSelect = ({ value, options, onChange, placeholder }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((o: any) => o.value === value);

  return (
    <div className="relative flex-1 z-[60]" ref={wrapperRef}>
      <div 
        className={`w-full h-full min-h-[48px] bg-white border-2 transition-all rounded-xl px-4 flex items-center justify-between shadow-sm cursor-pointer ${
          isOpen ? 'border-[#B9CF32] ring-2 ring-[#B9CF32]/20' : 'border-transparent hover:border-[#B9CF32]/50'
        }`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`font-bold text-sm ${!selectedOption ? 'text-[#347048]/40' : 'text-[#347048]'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={18} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-[#B9CF32]' : 'text-[#347048]/40'}`} strokeWidth={3} />
      </div>

      {isOpen && (
        <div className="absolute z-[70] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-48 overflow-y-auto custom-scrollbar overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <ul className="flex flex-col py-2">
            {options.length === 0 ? (
                <li className="px-4 py-3 text-[#347048]/40 text-xs font-bold text-center">Cargando productos...</li>
            ) : (
                options.map((option: any) => (
                <li 
                    key={option.value}
                    onClick={() => {
                    if (!option.disabled) {
                        onChange(option.value);
                        setIsOpen(false);
                    }
                    }}
                    className={`px-4 py-3 flex items-center justify-between transition-colors ${
                    option.disabled 
                        ? 'opacity-40 cursor-not-allowed bg-gray-50' 
                        : 'cursor-pointer hover:bg-[#B9CF32]/20'
                    } ${value === option.value ? 'bg-[#347048]/5 text-[#347048]' : 'text-[#347048]'}`}
                >
                    <span className="font-black text-xs">{option.label}</span>
                    {option.disabled && <span className="text-[9px] font-black text-red-500 uppercase tracking-widest border border-red-500/20 bg-red-50 px-2 py-0.5 rounded-md">Sin Stock</span>}
                    {!option.disabled && value === option.value && <Check size={14} className="text-[#347048]" strokeWidth={4} />}
                </li>
                ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};


const BookingConsumption = forwardRef<BookingConsumptionHandle, Props>(function BookingConsumption(
  { bookingId, slug, courtPrice = 0, baseCourtPrice, bookingStatus, paymentStatus, onClose, onConfirm },
  ref
) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [itemsToDelete, setItemsToDelete] = useState<number[]>([]);
  // estados normales de consumo
  const [assignedItemIds, setAssignedItemIds] = useState<number[]>([]); // ids ya usados en alguna división
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const skipDraftPersistRef = useRef(false);
  const [alreadyPaid, setAlreadyPaid] = useState(0);
  const [paidProductsTotal, setPaidProductsTotal] = useState(0);
  // removed payment-specific states; PaymentCalculator handles them now
  const [paidCartItems, setPaidCartItems] = useState<any[]>([]);

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

      // 1. Obtenemos cuánto se pagó en total
      const token = localStorage.getItem('token');
      const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/api$/, '');
      const paidRes = await fetch(`${baseUrl}/api/bookings/${bookingId}/paid-amount`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      
      let totalPaid = 0;
      if (paidRes.ok) {
        const data = await paidRes.json();
        totalPaid = data.paidAmount || 0;
        setAlreadyPaid(totalPaid);
      }

     // Calculamos cuánta plata se fue en productos que YA están pagados (Para la matemática)
      const paidProducts = (currentItems || []).filter((item: any) => item.isPaid);
      const totalPagadoEnProductos = paidProducts.reduce(
        (sum: number, item: any) => sum + (Number(item.price) * Number(item.quantity || 1)), 
        0
      );
      setPaidProductsTotal(totalPagadoEnProductos);

      // Metemos TODOS los productos al carrito, pero les pasamos el estado "isPaid"
      const formattedItems = (currentItems || []).map((item: any) => ({
          id: item.id,
          productId: item.productId,
          productName: item.product.name,
          quantity: item.quantity,
          price: item.price,
          isPaid: item.isPaid, // 👈 Clave para tacharlos en el HTML
          isNew: false
      }));
      
      setCartItems(formattedItems);
      // (Si tenías el setPaidCartItems de mi mensaje anterior, borralo)
      // --- FIN DE LA MAGIA DEL HISTORIAL ---

      setCartItems(formattedItems);
      setItemsToDelete([]); 
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [bookingId, slug, courtPrice]); // Agregá courtPrice a las dependencias

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
    skipDraftPersistRef.current = true;
    
    // 1. Actualizamos la plata en la BD (si pagó, si es parcial, o si es deuda)
    await ClubAdminService.updateBookingPaymentStatus(bookingId, targetBookingStatus);

    // 👉 2. LA MAGIA DEFINITIVA: Confirmamos el turno SIEMPRE que pase por el mostrador
    try {
        const token = localStorage.getItem('token');
        const url = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/bookings/confirm` : '/api/bookings/confirm';
        
        const confirmResponse = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}) 
            },
            body: JSON.stringify({ 
                bookingId: bookingId, 
                paymentMethod: itemPaymentMethod // puede ser 'DEBT' sin problemas
            })
        });

        if (!confirmResponse.ok) {
            console.warn("Nota: La confirmación devolvió error, posiblemente el turno ya estaba confirmado.");
        }
    } catch (confirmError) {
        console.error("Error de red intentando confirmar el turno:", confirmError);
    }

    // 3. Guardamos los consumos nuevos (si se llevaron algo del kiosco)
    const deletePromises = itemsToDelete.map(id => ClubAdminService.removeItemFromBooking(id));
    const newItems = cartItems.filter(i => i.isNew);
    const addPromises = newItems.map(item => 
      ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, itemPaymentMethod)
    );
    await Promise.all([...deletePromises, ...addPromises]);
    
    // 4. Cerramos y actualizamos la grilla
    onConfirm(); 
    onClose();
  } catch (error: any) {
    alert("Error general: " + (error.message || "Intente nuevamente"));
  } finally {
    setSaving(false);
  }
};
  const persistDraft = useCallback(async () => {
    if (skipDraftPersistRef.current || saving) return;
    const newItems = cartItems.filter(item => item.isNew);
    if (newItems.length === 0) return;
    try {
      setSaving(true);
      await Promise.all(
        newItems.map(item =>
          ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, 'DEBT')
        )
      );
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  }, [bookingId, cartItems, saving]);

  useImperativeHandle(ref, () => ({ persistDraft }));

  const isCancelled = bookingStatus === 'CANCELLED';

// 1. Separamos la plata ingresada: ¿Cuánto fue realmente para la cancha?
  // (Total ingresado MENOS lo que costaron los productos que ya están pagados)
  // calculamos cuánto de lo ya abonado corresponde efectivamente a la cancha
  // (restamos el valor de los productos que ya marcamos como pagados)
  const courtPaid = Math.max(0, alreadyPaid - paidProductsTotal);
  
  // 2. deuda restante de la cancha
  const courtTotal = courtPrice || 0;
  const pendingCourt = Math.max(0, courtTotal - courtPaid);

  // 3. deuda de consumos (cartItems ya contiene sólo los no pagados)
  // 3. Calculamos la deuda de los productos (solo los que NO están pagados)
  const pendingProducts = cartItems
    .filter(item => !item.isPaid) // 👈 ESTO ES NUEVO
    .reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // 4. Total final que se le muestra al usuario
  const finalTotal = pendingCourt + pendingProducts;
  const hasPendingCharges = finalTotal > 0;

  // 5. Reutilizamos un grandTotal sencillo para posibles referencias
  const grandTotal = courtTotal + pendingProducts;

  // 5. Variables visuales para el Ticket
  const isCourtResolved = paymentStatus === 'PAID' || paymentStatus === 'PARTIAL' || paymentStatus === 'DEBT';
  const consumptionTotal = cartItems.filter(item => item.isNew).reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const basePrice = Number(baseCourtPrice ?? 0);
  const lightsExtra = basePrice > 0 ? Math.max((courtPrice || 0) - basePrice, 0) : 0;
// this helper is used by the new calculator component
const performPayment = async (method: 'CASH' | 'TRANSFER' | 'DEBT', amountEntered: number, paidItemIds: number[]) => {
      if (!amountEntered || amountEntered <= 0) return;

      try {
          setSaving(true);
          
          // guardar consumos nuevos antes
          const deletePromises = itemsToDelete.map(id => ClubAdminService.removeItemFromBooking(id));
          const newItems = cartItems.filter(i => i.isNew);
          const addPromises = newItems.map(item => 
            ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, method)
          );
          await Promise.all([...deletePromises, ...addPromises]);

          // procesar pago en backend
          const token = localStorage.getItem('token');
          const baseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/api$/, '');
          const url = `${baseUrl}/api/bookings/partial-payment`;

          const response = await fetch(url, {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json', 
                  ...(token ? { 'Authorization': `Bearer ${token}` } : {}) 
              },
              body: JSON.stringify({ 
                  bookingId: bookingId, 
                  paymentMethod: method, // 👈 Acá ahora viaja 'DEBT' sin que TypeScript se queje
                  amount: amountEntered,
                  totalBookingCost: grandTotal,
                  paidItemIds: paidItemIds
              })
          });

          if (!response.ok) throw new Error("Fallo en la respuesta del servidor");

          setShowPaymentModal(false);
          onConfirm();
          onClose();

      } catch (error) {
          console.error(error);
          alert("Error al procesar el pago a cuenta. Intente de nuevo.");
      } finally {
          setSaving(false);
      }
  };
  // Convertimos los productos cargados en opciones para el CustomSelect
  const productOptions = products.map(p => ({
      value: p.id.toString(),
      label: `${p.name} ($${p.price.toLocaleString()})`,
      disabled: p.stock <= 0
  }));


  return (
    <div className="space-y-6 text-[#347048]">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h2 className="text-2xl font-black text-[#926699] uppercase italic tracking-tighter">
             Gestión de Reserva
          </h2>
          <p className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest mt-1">
             Consumos, extras y cobro
          </p>
        </div>
        <button 
          onClick={onClose}
          className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
          title="Cerrar ventana"
        >
          <X size={20} strokeWidth={3} />
        </button>
      </div>

      {/* SECCIÓN: AGREGAR CONSUMO */}
      <div className="bg-[#347048]/5 p-5 rounded-2xl border border-[#347048]/10 relative z-50">
        <h3 className="text-[#926699] font-black flex items-center gap-2 mb-4 text-xs uppercase tracking-[0.1em]">
          <ShoppingCart size={16} strokeWidth={3} /> Agregar Consumo / Extra
        </h3>
        <div className="flex gap-3 relative">
            
            {/* 👇 ACÁ VA EL NUEVO DROPDOWN 👇 */}
            <CustomSelect 
                value={selectedProductId}
                onChange={(val: string) => setSelectedProductId(val)}
                placeholder="Seleccionar producto..."
                options={productOptions}
            />

            <input 
                type="number" min="1" 
                className="w-20 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-2 text-center text-[#347048] font-black shadow-sm outline-none"
                value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
            />
            <button 
                onClick={handleAddToDraft} disabled={!selectedProductId}
                className="bg-[#926699] hover:bg-[#7a5580] disabled:opacity-30 text-[#EBE1D8] p-3 rounded-xl transition-all shadow-md active:scale-95 z-0"
            >
                <Plus size={24} strokeWidth={3} />
            </button>
        </div>
      </div>

      {/* LISTA DE ITEMS */}
      <div className="bg-white/40 rounded-2xl border-2 border-dashed border-[#347048]/10 overflow-hidden min-h-[120px] relative z-0">
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
                className={`flex justify-between items-center p-4 transition-colors ${
                  item.isNew ? 'bg-white/60' : 
                  item.isPaid ? 'bg-transparent opacity-40 grayscale-[50%]' : 
                  'bg-transparent' // 👈 ACÁ ESTÁ EL CAMBIO: Le sacamos el opacity-60 para que la Coca Cola brille
                }`}
              >
                <div className="text-sm flex items-center">
                  <span className="font-black text-[#347048] bg-[#347048]/10 w-8 h-8 flex items-center justify-center rounded-lg mr-3 italic">
                    {item.quantity}x
                  </span> 
                  <div className="flex flex-col">
                    <span className={`font-black uppercase tracking-tight leading-none mb-1 ${
                      item.isPaid ? 'text-[#347048]/50 line-through' : 'text-[#347048]'
                    }`}>
                      {item.productName}
                    </span>
                    
                    {item.isNew ? (
                      <span className="text-[9px] text-[#B9CF32] font-black tracking-widest uppercase flex items-center gap-1">
                        <Star size={10} strokeWidth={2.5} /> Pendiente de cobro
                      </span>
                    ) : item.isPaid ? (
                      <span className="flex items-center gap-1 text-[9px] text-[#347048]/60 font-black uppercase tracking-widest">
                        <Check size={10} strokeWidth={3} /> Ya abonado
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[9px] text-[#347048]/50 font-black uppercase tracking-widest">
                        <Lock size={8} /> Ya cargado en cuenta
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  {/* 👇 ACÁ TAMBIÉN: Le sacamos la transparencia al precio de la Coca Cola */}
                  <span className={`font-black text-sm ${
                    item.isNew ? 'text-[#347048]' : 
                    item.isPaid ? 'text-[#347048]/50 line-through' : 
                    'text-[#347048]' // 👈 Precio bien oscuro y visible
                  }`}>
                    ${(item.price * item.quantity).toLocaleString()}
                  </span>
                  
                  {item.isNew ? (
                    <button onClick={() => handleRemoveFromDraft(item)} className="text-red-400 hover:text-red-600 transition p-2 hover:bg-red-50 rounded-xl">
                      <Trash2 size={18} strokeWidth={2.5} />
                    </button>
                  ) : item.isPaid ? (
                    <div className="w-9 flex justify-center text-[#347048]/40"><Check size={16} strokeWidth={3} /></div>
                  ) : (
                    <div className="w-9 flex justify-center text-[#347048]/30"><Lock size={16} /></div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      

      {/* TICKET FINAL */}
      <div className="bg-white border-4 border-[#B9CF32]/30 rounded-[2rem] p-6 shadow-sm relative overflow-hidden z-0">
        <div className="space-y-2 mb-5">
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest opacity-60">
            <span>Alquiler Cancha</span>
            <div className="flex items-center gap-3">
                {isCourtResolved && (
                  <span className={`px-2 py-0.5 rounded-md font-black border text-[9px] uppercase tracking-widest ${
                    paymentStatus === 'DEBT' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 
                    paymentStatus === 'PARTIAL' ? 'bg-orange-100 text-orange-700 border-orange-200' : 
                    'bg-emerald-100 text-emerald-700 border-emerald-200'
                  }`}>
                    {paymentStatus === 'DEBT' ? 'EN CUENTA' : 
                    paymentStatus === 'PARTIAL' ? 'PAGO PARCIAL' : 
                    'PAGADO'}
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

      {/* BOTONES DE ACCIÓN */}
      <div className="grid grid-cols-2 gap-4 pt-2 relative z-0">
        <button 
          onClick={() => {
            handleSaveChanges('DEBT', 'DEBT');
          }}
          // AHORA SÍ: Lo bloqueamos si ya no hay deuda para evitar cobros fantasma
          disabled={saving || isCancelled || !hasPendingCharges}
          className="flex flex-col items-center justify-center gap-1 py-4 bg-[#EBE1D8] border-2 border-[#347048]/20 text-[#347048] font-black uppercase text-[10px] tracking-widest rounded-2xl transition-all hover:bg-white shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2"><FileText size={18} strokeWidth={2.5} /> Dejar en Cuenta</div>
        </button>
        
        <button 
          onClick={() => setShowPaymentModal(true)} 
          disabled={saving || !hasPendingCharges || isCancelled}
          className="flex flex-col items-center justify-center gap-1 py-4 bg-[#B9CF32] text-[#347048] font-black uppercase text-[10px] tracking-widest rounded-2xl shadow-xl shadow-[#B9CF32]/20 transition-all hover:-translate-y-1 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2"><Banknote size={18} strokeWidth={2.5} /> Cobrar Total</div>
        </button>
      </div>

      {/* MODAL DE COBRO (LA CALCULADORA) */}
      {showPaymentModal && (
        <PaymentCalculator
          courtPrice={courtPrice || 0}
          cartItems={cartItems.filter(item => !item.isPaid)}
          alreadyPaid={courtPaid} // 👈 Le pasamos SOLO lo de la cancha, usando la variable nueva
          grandTotal={finalTotal} // 👈 Le pasamos el saldo deudor correcto
          onClose={() => setShowPaymentModal(false)}
          onConfirm={({ method, amount, paidItemIds }) => performPayment(method, amount, paidItemIds)}
        />
      )}
    </div>
  );
});

export default BookingConsumption;