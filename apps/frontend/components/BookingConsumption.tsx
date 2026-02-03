import { useState, useEffect } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Trash2, Plus, ShoppingCart, Receipt, Save, X } from 'lucide-react';

interface Props {
  bookingId: number;
  slug: string;
  courtPrice?: number;
  onClose: () => void;   // 👇 Para cerrar el modal
  onConfirm: () => void; // 👇 Para recargar la grilla después de guardar
}

// Interfaz auxiliar para diferenciar items guardados de los nuevos
interface CartItem {
  id?: number;       // ID real de la base de datos
  tempId?: string;   // ID temporal para los nuevos
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  isNew: boolean;    // Bandera clave
}

export default function BookingConsumption({ bookingId, slug, courtPrice = 0, onClose, onConfirm }: Props) {
  // Estado local del "Carrito" (mezcla lo que vino de la DB y lo nuevo)
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  
  // Lista de IDs que el usuario decidió borrar (para eliminarlos al guardar)
  const [itemsToDelete, setItemsToDelete] = useState<number[]>([]);
  
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Formulario
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  // 1. CARGAR DATOS INICIALES
  useEffect(() => {
    loadData();
  }, [bookingId]);

  const loadData = async () => {
    try {
      setLoading(true);
      // Cargar productos y consumos actuales en paralelo
      const [productsData, currentItems] = await Promise.all([
        ClubAdminService.getProducts(slug),
        ClubAdminService.getBookingItems(bookingId)
      ]);

      setProducts(productsData || []);

      // Convertimos los datos de la DB a nuestro formato de carrito
      const formattedItems = (currentItems || []).map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.price, // Precio histórico
        isNew: false
      }));
      
      setCartItems(formattedItems);
      setItemsToDelete([]); // Reseteamos borrados
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // 2. AGREGAR AL CARRITO (SOLO EN MEMORIA)
  const handleAddToDraft = () => {
    if (!selectedProductId) return;
    
    const product = products.find(p => p.id === Number(selectedProductId));
    if (!product) return;

    const newItem: CartItem = {
      tempId: `new-${Date.now()}`, // ID temporal único
      productId: product.id,
      productName: product.name,
      quantity: quantity,
      price: product.price,
      isNew: true
    };

    setCartItems([...cartItems, newItem]);
    
    // Resetear form
    setQuantity(1);
    setSelectedProductId('');
  };

  // 3. REMOVER DEL CARRITO (SOLO EN MEMORIA)
  const handleRemoveFromDraft = (item: CartItem) => {
    // Si era un item viejo (tiene ID real), lo marcamos para borrar en la DB
    if (!item.isNew && item.id) {
      setItemsToDelete([...itemsToDelete, item.id]);
    }
    
    // Lo sacamos de la lista visual
    setCartItems(cartItems.filter(i => 
      item.isNew ? i.tempId !== item.tempId : i.id !== item.id
    ));
  };

  // 4. GUARDAR CAMBIOS (ACCIÓN MASIVA) 💾
  const handleSaveChanges = async () => {
    try {
      setSaving(true);

      // A) Borrar los que el usuario quitó
      const deletePromises = itemsToDelete.map(id => 
        ClubAdminService.removeItemFromBooking(id)
      );

      // B) Agregar los nuevos
      const newItems = cartItems.filter(i => i.isNew);
      const addPromises = newItems.map(item => 
        ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity)
      );

      // Esperar a que todo termine
      await Promise.all([...deletePromises, ...addPromises]);

      // Éxito: avisar al padre y cerrar
      onConfirm(); 
      onClose();

    } catch (error: any) {
      alert("Error al guardar cambios: " + (error.message || "Intente nuevamente"));
    } finally {
      setSaving(false);
    }
  };

  // Cálculos
  const consumptionTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const finalTotal = (courtPrice || 0) + consumptionTotal;
  const hasChanges = itemsToDelete.length > 0 || cartItems.some(i => i.isNew);

  return (
    <div className="space-y-4">
      {/* SELECCIÓN DE PRODUCTO */}
      <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
        <h3 className="text-white font-bold flex items-center gap-2 mb-3 text-sm uppercase tracking-wide">
          <ShoppingCart size={16} className="text-emerald-400" /> 
          Agregar Consumo
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

      {/* LISTA DE ITEMS (DRAFT) */}
      <div className="bg-gray-900/30 rounded-lg border border-gray-800 overflow-hidden min-h-[100px]">
        {cartItems.length === 0 ? (
           <p className="text-gray-500 text-center py-8 text-sm italic">No hay consumos en esta lista.</p>
        ) : (
          cartItems.map((item) => (
            <div key={item.isNew ? item.tempId : item.id} className="flex justify-between items-center p-3 border-b border-gray-800 last:border-0 hover:bg-white/5 transition">
              <div className="text-sm">
                <span className="font-bold text-white mr-2">{item.quantity}x</span> 
                <span className="text-gray-300">{item.productName}</span>
                {item.isNew && <span className="ml-2 text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded">NUEVO</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-white font-mono text-sm">${item.price * item.quantity}</span>
                <button onClick={() => handleRemoveFromDraft(item)} className="text-gray-500 hover:text-red-400 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* TICKET FINAL */}
      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10"><Receipt size={60} /></div>
        
        <div className="space-y-1 text-sm mb-3">
          <div className="flex justify-between text-gray-400">
            <span>Alquiler Cancha</span>
            <span>${courtPrice || 0}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Consumos</span>
            <span>${consumptionTotal}</span>
          </div>
        </div>

        <div className="flex justify-between items-end pt-3 border-t border-dashed border-emerald-500/30">
          <span className="text-white font-bold text-lg">TOTAL A PAGAR</span>
          <span className="text-3xl font-bold text-emerald-400 font-mono tracking-tighter">
            ${finalTotal}
          </span>
        </div>
      </div>

      {/* BOTONES DE ACCIÓN (ACEPTAR / CANCELAR) */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button 
          onClick={onClose}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-bold transition"
        >
          <X size={18} /> Cancelar
        </button>
        
        <button 
          onClick={handleSaveChanges}
          disabled={saving}
          className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-white transition
            ${saving ? 'bg-emerald-800 cursor-wait' : 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/50'}
          `}
        >
          {saving ? 'Guardando...' : (
             <> <Save size={18} /> Confirmar Cambios </>
          )}
        </button>
      </div>
    </div>
  );
}