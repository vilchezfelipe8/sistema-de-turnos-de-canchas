import { useState, useEffect, useRef } from 'react';
import { Banknote, CreditCard, FileText, X } from 'lucide-react';

export interface CartItem {
  id?: number;
  tempId?: string;
  productId?: number;
  productName: string;
  quantity: number;
  price: number;
}

export type PaymentCalculatorResult = {
  method: 'CASH' | 'TRANSFER' | 'DEBT';
  amount: number;
  paidItemIds: number[];
};

export interface PaymentCalculatorProps {
  courtPrice: number;
  cartItems: CartItem[];           // items that can be added to the ticket
  alreadyPaid: number;            // what has been paid so far (court + items)
  grandTotal: number;             // courtPrice + all items price (unfiltered)
  onClose: () => void;
  onConfirm: (result: PaymentCalculatorResult) => Promise<void>;
}

export default function PaymentCalculator({
  courtPrice,
  cartItems,
  alreadyPaid,
  grandTotal,
  onClose,
  onConfirm
}: PaymentCalculatorProps) {
  const [paymentAmount, setPaymentAmount] = useState<number | string>('');
  const [selectedConcepts, setSelectedConcepts] = useState<Array<{id: string | number; name: string; price: number}>>([]);
  const [assignedItemIds, setAssignedItemIds] = useState<number[]>([]);
  const backdropRef = useRef<boolean>(false);

  // Estados para el CheckList de cobro
  const [selectedProductIds, setSelectedProductIds] = useState<Array<string | number>>([]);
  const [courtPortion, setCourtPortion] = useState<number>(0); 

  // Efecto mágico: Si tilda o destilda algo, sumamos el total automáticamente al input
  useEffect(() => {
    // 1. Sumamos los productos obligando a que sean números
    const productsTotal = cartItems
      .filter(item => selectedProductIds.includes(item.tempId || item.id))
      .reduce((sum, item) => sum + Number(item.price || 0), 0);

    // 2. Aseguramos que la cancha sea un número
    const safeCourtPortion = Number(courtPortion || 0);

    // 3. Suma matemática real
    const newTotal = safeCourtPortion + productsTotal;
    
    if (newTotal > 0) {
      // Forzamos a string para que el input type="number" no haga cosas raras con los ceros a la izquierda
      setPaymentAmount(newTotal.toString());
    } else {
      setPaymentAmount('');
    }
  }, [selectedProductIds, courtPortion, cartItems]);

  // Funciones de limpieza y selección rápida
  const handleSelectAll = () => {
    const pendingCourt = Math.max(0, (courtPrice || 0) - alreadyPaid);
    setCourtPortion(pendingCourt);
    setSelectedProductIds(cartItems.map(item => item.tempId || item.id));
  };

  const handleClearSelection = () => {
    setCourtPortion(0);
    setSelectedProductIds([]);
    setPaymentAmount('');
  };

  // whenever the modal opens we want the amount to default to pending
  useEffect(() => {
    setPaymentAmount(Math.max(0, grandTotal - alreadyPaid));
    setSelectedConcepts([]);
    setAssignedItemIds([]);
    // reset court portion & selections as well
    setCourtPortion(0);
    setSelectedProductIds([]);
  }, [grandTotal, alreadyPaid]);

  const finalTotal = Math.max(0, grandTotal - alreadyPaid);

  // compute selectedTotal for disabling buttons and validations
  const productsSum = cartItems
      .filter(item => selectedProductIds.includes(item.tempId || item.id))
      .reduce((sum, item) => sum + Number(item.price || 0), 0);
  const selectedTotal = (Number(courtPortion) || 0) + productsSum;

  const handleClearConcepts = () => {
    setSelectedConcepts([]);
    setPaymentAmount('');
  };

  const handleAddConcept = (id: string | number, name: string, price: number) => {
    if (selectedConcepts.some(c => c.id === id)) return;
    if (typeof id === 'number') {
      setAssignedItemIds(prev => [...prev, id]);
    }
    setSelectedConcepts(prev => [...prev, { id, name, price }]);
    setPaymentAmount(prev => {
      const current = Number(prev) || 0;
      const addedValue = Number(price) || 0;
      if (current === finalTotal || current === 0) {
        return addedValue;
      }
      return current + addedValue;
    });
  };

  const handleRemoveConcept = (id: string | number) => {
    setSelectedConcepts(prev => prev.filter(c => c.id !== id));
    if (typeof id === 'number') {
      setAssignedItemIds(prev => prev.filter(x => x !== id));
    }
  };

 const handlePaymentConfirm = async (method: 'CASH' | 'TRANSFER' | 'DEBT') => {
    const amountEntered = Number(paymentAmount);
    if (!amountEntered || amountEntered <= 0) return;

    // selectedTotal is already calculated outside, reuse it for validation

    let numericItemIds = Array.from(
      new Set(
        selectedProductIds
          .map(id => (typeof id === 'number' ? id : null))
          .filter((v): v is number => v !== null)
      )
    );

    if (selectedTotal > 0 && amountEntered < selectedTotal) {
      alert('El monto ingresado es menor al total de los ítems seleccionados. Los ítems NO se marcarán como pagados.');
      numericItemIds = [];
    }

    await onConfirm({ method, amount: amountEntered, paidItemIds: numericItemIds });
  };

  return (
    <div
      className="fixed inset-0 bg-[#347048]/80 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => { backdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const started = backdropRef.current;
        backdropRef.current = false;
        if (started && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-[#EBE1D8] border-4 border-white p-6 sm:p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-6 right-6 bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100 z-10"
          title="Cerrar ventana"
        >
          <X size={20} strokeWidth={3} />
        </button>

        <div className="text-center mb-6 mt-2">
          <h3 className="text-2xl font-black mb-1 uppercase tracking-tight italic text-[#347048]">Ingresar Pago</h3>
          <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-widest">
            Saldo Pendiente: <span className="text-[#347048] font-black text-sm">${finalTotal.toLocaleString()}</span>
          </p>
        </div>

        {/* 📋 EL NUEVO LISTADO DE CONSUMOS PENDIENTES */}
        <div className="bg-white border-2 border-[#B9CF32]/30 rounded-2xl p-4 mb-6 shadow-sm">
          <div className="flex justify-between items-center mb-4 border-b border-[#347048]/10 pb-2">
            <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#347048] flex items-center gap-2">
              <span className="text-base">📋</span> Qué vas a cobrar
            </p>
            <div className="flex gap-2">
              <button onClick={handleSelectAll} className="text-[9px] font-black uppercase tracking-widest text-[#B9CF32] hover:text-[#9abc28] transition-colors bg-[#B9CF32]/10 px-2 py-1 rounded-md">
                Todo
              </button>
              <button onClick={handleClearSelection} className="text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-red-500 transition-colors bg-red-50 px-2 py-1 rounded-md">
                Nada
              </button>
            </div>
          </div>

          <div className="space-y-4 max-h-56 overflow-y-auto pr-1">
            
            {/* 1. SECCIÓN CANCHA */}
            {((courtPrice || 0) - alreadyPaid > 0) && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2">
                  🎾 Alquiler de Cancha
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className={`flex justify-center items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${courtPortion === (courtPrice || 0) / 4 ? 'bg-[#B9CF32]/20 border-[#B9CF32] text-[#347048]' : 'bg-white border-slate-200 text-slate-500 hover:border-[#B9CF32]/50'}`}>
                    <input type="radio" name="court" className="hidden" checked={courtPortion === (courtPrice || 0) / 4} onChange={() => setCourtPortion((courtPrice || 0) / 4)} />
                    <span className="text-xs font-bold">1/4 (${((courtPrice || 0) / 4).toLocaleString()})</span>
                  </label>

                  <label className={`flex justify-center items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${courtPortion === (courtPrice || 0) / 2 ? 'bg-[#B9CF32]/20 border-[#B9CF32] text-[#347048]' : 'bg-white border-slate-200 text-slate-500 hover:border-[#B9CF32]/50'}`}>
                    <input type="radio" name="court" className="hidden" checked={courtPortion === (courtPrice || 0) / 2} onChange={() => setCourtPortion((courtPrice || 0) / 2)} />
                    <span className="text-xs font-bold">1/2 (${((courtPrice || 0) / 2).toLocaleString()})</span>
                  </label>

                  <label className={`flex justify-center items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all col-span-2 ${courtPortion === ((courtPrice || 0) - alreadyPaid) ? 'bg-[#B9CF32]/20 border-[#B9CF32] text-[#347048]' : 'bg-white border-slate-200 text-slate-500 hover:border-[#B9CF32]/50'}`}>
                    <input type="radio" name="court" className="hidden" checked={courtPortion === ((courtPrice || 0) - alreadyPaid)} onChange={() => setCourtPortion(Math.max(0, (courtPrice || 0) - alreadyPaid))} />
                    <span className="text-xs font-bold">Saldo (${Math.max(0, (courtPrice || 0) - alreadyPaid).toLocaleString()})</span>
                  </label>
                </div>
              </div>
            )}

            {/* 2. SECCIÓN PRODUCTOS */}
            {cartItems.filter(item => !assignedItemIds?.includes(item.id!)).length > 0 && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2">
                  🛒 Consumos Extras
                </div>
                <div className="space-y-2">
                  {cartItems
                    .filter(item => !assignedItemIds?.includes(item.id!)) // Mantenemos tu filtro de asignados
                    .map(item => {
                    const itemId = item.tempId || item.id;
                    const isSelected = selectedProductIds.includes(itemId);
                    return (
                      <label key={itemId} className={`flex justify-between items-center p-2 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-[#926699]/10 border-[#926699]/30 text-[#926699]' : 'bg-white border-slate-200 text-slate-500 hover:border-[#926699]/30'}`}>
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox" 
                            className="w-4 h-4 rounded text-[#926699] focus:ring-[#926699] border-gray-300"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedProductIds([...selectedProductIds, itemId]);
                              else setSelectedProductIds(selectedProductIds.filter(id => id !== itemId));
                            }}
                          />
                          <span className="text-sm font-bold">{item.productName}</span>
                        </div>
                        <span className="text-sm font-black">${item.price.toLocaleString()}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* input dinero (Se autocompleta con el useEffect) */}
        <div className="mb-6">
          <label className="text-[10px] font-black uppercase tracking-widest text-[#926699] ml-2 block mb-2">
            ¿Cuánta plata ingresa AHORA?
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-[#347048]/40">$</span>
            <input
              type="number"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl py-4 pl-10 pr-4 text-3xl font-black text-[#347048] outline-none transition-all shadow-sm italic"
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={() => {
                  setPaymentAmount(finalTotal);
                  handleSelectAll(); // Tilda todo al pedir completar
              }}
              className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest hover:text-[#926699] transition-colors"
            >
              Completar total (${finalTotal.toLocaleString()})
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <button
              onClick={() => handlePaymentConfirm('CASH')}
              disabled={!paymentAmount || Number(paymentAmount) <= 0 || (selectedTotal > 0 && Number(paymentAmount) < selectedTotal)}
              className="flex flex-col items-center justify-center p-5 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-3xl text-[#347048] transition-all hover:scale-[1.02] shadow-sm group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Banknote size={32} strokeWidth={2} className="mb-2 group-hover:scale-110 transition-transform text-[#347048]" />
              <span className="font-black text-[10px] uppercase tracking-widest">Efectivo</span>
            </button>

            <button
              onClick={() => handlePaymentConfirm('TRANSFER')}
              disabled={!paymentAmount || Number(paymentAmount) <= 0 || (selectedTotal > 0 && Number(paymentAmount) < selectedTotal)}
              className="flex flex-col items-center justify-center p-5 bg-white border-2 border-transparent hover:border-[#B9CF32] rounded-3xl text-[#347048] transition-all hover:scale-[1.02] shadow-sm group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CreditCard size={32} strokeWidth={2} className="mb-2 group-hover:scale-110 transition-transform text-[#347048]" />
              <span className="font-black text-[10px] uppercase tracking-widest">Digital</span>
            </button>
          </div>

          {/* NUEVO BOTÓN: FIAR A CUENTA */}
          <button
            onClick={() => handlePaymentConfirm('DEBT')}
            disabled={!paymentAmount || Number(paymentAmount) <= 0 || (selectedTotal > 0 && Number(paymentAmount) < selectedTotal)}
            className="w-full flex items-center justify-center gap-3 p-4 bg-[#926699]/10 border-2 border-[#926699]/30 hover:border-[#926699] rounded-2xl text-[#926699] transition-all hover:scale-[1.02] active:scale-95 shadow-sm group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText size={24} strokeWidth={2.5} className="group-hover:scale-110 transition-transform" />
            <span className="font-black text-[11px] uppercase tracking-widest">Anotar a Cuenta (Fiar)</span>
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full text-[#347048]/40 hover:text-[#347048] text-[10px] font-black uppercase tracking-widest hover:underline transition-all"
        >
          Cancelar operación
        </button>
      </div>
    </div>
  );
}
