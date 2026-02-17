'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Search, Plus, Edit, Trash2, X, Package, Tag, DollarSign, Box } from 'lucide-react';

interface ProductsPageProps {
  slug?: string;
  params?: { slug: string };
}

// --- ✨ COMPONENTE PORTAL (VERSIÓN BEIGE WIMBLEDON) ✨ ---
const ModalPortal = ({ children, onClose }: { children: ReactNode, onClose: () => void }) => {
  if (typeof document === 'undefined') return null;
  const backdropMouseDownRef = useRef(false);
  
  return createPortal(
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#347048]/80 backdrop-blur-[2px] p-4 animate-in fade-in duration-200"
    onMouseDown={(event) => {
      backdropMouseDownRef.current = event.target === event.currentTarget;
    }}
    onTouchStart={(event) => {
      backdropMouseDownRef.current = event.target === event.currentTarget;
    }}
    onClick={(event) => {
      const startedOnBackdrop = backdropMouseDownRef.current;
      backdropMouseDownRef.current = false;
      if (startedOnBackdrop && event.target === event.currentTarget) {
        onClose();
      }
    }}
  >
      {/* Tarjeta Flotante Beige con bordes blancos */}
      <div
        className="relative z-10 w-full max-w-md bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 overflow-hidden text-[#347048]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overflow-y-auto p-8 custom-scrollbar">
            {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default function ProductsPage({ slug: slugProp, params }: ProductsPageProps) {
  const slug = slugProp ?? params?.slug ?? '';
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [formData, setFormData] = useState({ name: '', price: '', stock: '', category: '' });

  const loadProducts = useCallback(async () => {
    try {
      const data = await ClubAdminService.getProducts(slug);
      setProducts(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (slug) loadProducts();
  }, [slug, loadProducts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name,
        price: Number(formData.price),
        stock: Number(formData.stock),
        category: formData.category
      };
      if (editingProduct) {
        await ClubAdminService.updateProduct(slug, editingProduct.id, payload);
      } else {
        await ClubAdminService.createProduct(slug, payload);
      }
      setIsModalOpen(false);
      setFormData({ name: '', price: '', stock: '', category: '' });
      setEditingProduct(null);
      loadProducts();
    } catch (error) {
      alert('Error al guardar');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Seguro que querés borrar este producto?')) return;
    try {
      await ClubAdminService.deleteProduct(slug, id);
      loadProducts();
    } catch (error) {
      alert('Error al borrar');
    }
  };

  const openEdit = (product: any) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      price: String(product.price),
      stock: String(product.stock),
      category: product.category || ''
    });
    setIsModalOpen(true);
  };

  const openNew = () => {
    setEditingProduct(null);
    setFormData({ name: '', price: '', stock: '', category: '' });
    setIsModalOpen(true);
  };

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Estilos Wimbledon para los inputs del Modal
  const inputClass ="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all";
  const labelClass = 'block text-[10px] font-black text-[#347048]/60 mb-1.5 uppercase tracking-widest ml-1';

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-center mb-8">
        {/* BUSCADOR */}
        <div className="relative flex-1 w-full sm:max-w-md group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40 group-focus-within:text-[#B9CF32] transition-colors" size={18} strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Buscar por nombre de producto..."
            className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl pl-12 pr-4 py-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* BOTÓN NUEVO */}
        <button
          type="button"
          onClick={openNew}
          className="w-full sm:w-auto px-6 py-3 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-[#347048]/20 uppercase tracking-widest text-xs italic"
        >
          <Plus size={18} strokeWidth={3} /> Nuevo producto
        </button>
      </div>

      {/* TABLA DE PRODUCTOS */}
      <div className="bg-white/40 border-2 border-white rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-2 px-4">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/40">
                  <th className="px-6 py-4">Producto</th>
                  <th className="px-6 py-4">Categoría</th>
                  <th className="px-6 py-4">Stock Actual</th>
                  <th className="px-6 py-4">Precio Venta</th>
                  <th className="px-6 py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-sm font-bold">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-20 text-center text-[#347048]/40">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-4 border-[#347048] mx-auto mb-4"></div>
                      CARGANDO INVENTARIO...
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-20 text-center text-[#347048]/30 italic uppercase tracking-widest font-black">
                      No hay productos registrados
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((product) => (
                    <tr key={product.id} className="bg-white/80 hover:bg-white transition-all shadow-sm group">
                      <td className="px-6 py-5 first:rounded-l-2xl font-black text-[#347048] uppercase tracking-tight italic">
                        {product.name}
                      </td>
                      <td className="px-6 py-5">
                        <span className="text-[10px] font-black bg-[#926699]/10 text-[#926699] px-3 py-1 rounded-full border border-[#926699]/20 uppercase tracking-widest">
                            {product.category || 'General'}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span
                          className={`inline-flex px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border ${
                            product.stock < 5 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          }`}
                        >
                          {product.stock} unidades
                        </span>
                      </td>
                      <td className="px-6 py-5 text-lg font-black text-[#347048] italic tracking-tighter">
                        ${product.price?.toLocaleString?.() ?? product.price}
                      </td>
                      <td className="px-6 py-5 last:rounded-r-2xl text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => openEdit(product)}
                            className="p-2 rounded-xl bg-white border border-[#347048]/10 text-[#347048] hover:bg-[#347048] hover:text-[#EBE1D8] transition-all shadow-sm"
                            title="Editar"
                          >
                            <Edit size={16} strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(product.id)}
                            className="p-2 rounded-xl bg-red-50 border border-red-100 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm"
                            title="Eliminar"
                          >
                            <Trash2 size={16} strokeWidth={2.5} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
        </div>
      </div>

      {/* --- MODAL DE PRODUCTO --- */}
      {isModalOpen && (
        <ModalPortal onClose={() => setIsModalOpen(false)}>
            
            <div className="flex justify-between items-start mb-8 border-b border-[#347048]/10 pb-6">
              <div>
                <h3 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tighter">
                    <div className="bg-[#926699] p-2 rounded-xl text-[#EBE1D8] shadow-lg shadow-[#926699]/20">
                        {editingProduct ? <Edit size={24} strokeWidth={2.5}/> : <Plus size={24} strokeWidth={3}/>}
                    </div>
                    {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                </h3>
                <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-widest mt-2 ml-1">Información del inventario</p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* NOMBRE */}
              <div className="space-y-1.5">
                <label className={labelClass}>Nombre del Producto</label>
                <div className="relative group">
                    <input
                        required
                        placeholder="Ej: Gatorade Blue"
                        className={`${inputClass} pl-12`}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40 group-focus-within:text-[#B9CF32] transition-colors">
                        <Tag size={18} strokeWidth={2.5} />
                    </div>
                </div>
              </div>
              
              {/* PRECIO Y STOCK */}
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className={labelClass}>Precio ($)</label>
                  <div className="relative group">
                      <input
                        required
                        type="number"
                        min="0"
                        placeholder="0"
                        className={`${inputClass} pl-12`}
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40 group-focus-within:text-[#B9CF32] transition-colors">
                          <DollarSign size={18} strokeWidth={2.5} />
                      </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Stock Inicial</label>
                  <div className="relative group">
                      <input
                        required
                        type="number"
                        min="0"
                        placeholder="0"
                        className={`${inputClass} pl-12`}
                        value={formData.stock}
                        onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40 group-focus-within:text-[#B9CF32] transition-colors">
                          <Box size={18} strokeWidth={2.5} />
                      </div>
                  </div>
                </div>
              </div>

              {/* CATEGORÍA */}
              <div className="space-y-1.5">
                <label className={labelClass}>Categoría (Opcional)</label>
                <div className="relative group">
                    <input
                        className={`${inputClass} pl-12`}
                        placeholder="Ej: Bebidas, Grips, Alquiler..."
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/40 group-focus-within:text-[#B9CF32] transition-colors">
                        <Package size={18} strokeWidth={2.5} />
                    </div>
                </div>
              </div>

              {/* BOTÓN DE GUARDADO */}
              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-2xl shadow-xl shadow-[#347048]/20 transition-all uppercase tracking-[0.2em] text-sm italic"
                >
                  {editingProduct ? 'Guardar Cambios' : 'Confirmar Ingreso'}
                </button>
              </div>
            </form>
        </ModalPortal>
      )}
    </>
  );
}