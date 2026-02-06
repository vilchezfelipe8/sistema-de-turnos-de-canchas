'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Search, Plus, Edit, Trash2, X } from 'lucide-react';

interface ProductsPageProps {
  slug?: string;
  params?: { slug: string };
}

// --- ✨ COMPONENTE PORTAL (VERSIÓN BLACK) ✨ ---
const ModalPortal = ({ children, onClose }: { children: ReactNode, onClose: () => void }) => {
  if (typeof document === 'undefined') return null;
  
  return createPortal(
    // 1. Fondo Oscuro (Backdrop)
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose}></div>
      
      {/* 2. Tarjeta Flotante (AHORA EN NEGRO) */}
      {/* Cambié bg-[#0f172a] por bg-black y el borde a gray-800 */}
      <div className="relative z-10 w-full max-w-md bg-black border border-gray-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="overflow-y-auto p-6 custom-scrollbar">
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

  useEffect(() => {
    if (slug) loadProducts();
  }, [slug]);

  const loadProducts = async () => {
    try {
      const data = await ClubAdminService.getProducts(slug);
      setProducts(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

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

  // Estilos unificados para input (fondo gris oscuro sobre negro queda bien)
  const inputClass = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors placeholder-gray-500';
  const labelClass = 'block text-xs font-bold text-slate-400 mb-1.5 uppercase tracking-wide';

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar producto..."
            className="w-full bg-surface-70 border border-border rounded-lg pl-10 pr-4 py-2 text-text focus:outline-none focus:border-emerald-500/50 transition-colors"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={openNew}
          className="btn btn-primary px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-200 flex items-center gap-2 shrink-0 transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)]"
        >
          <Plus size={18} /> Nuevo producto
        </button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-surface-70/50 backdrop-blur-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted uppercase tracking-wider text-xs bg-surface-70">
              <th className="p-4 font-semibold">Producto</th>
              <th className="p-4 font-semibold">Categoría</th>
              <th className="p-4 font-semibold">Stock</th>
              <th className="p-4 font-semibold">Precio</th>
              <th className="p-4 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted">
                  Cargando...
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted">
                  No hay productos registrados.
                </td>
              </tr>
            ) : (
              filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-surface-70 transition-colors">
                  <td className="p-4 font-medium text-text">{product.name}</td>
                  <td className="p-4 text-muted">{product.category || '-'}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex px-2 py-1 rounded text-xs font-bold ${
                        product.stock < 5 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}
                    >
                      {product.stock} un.
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-emerald-400">${product.price?.toLocaleString?.() ?? product.price}</td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="p-2 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors"
                        title="Editar"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(product.id)}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL CON FONDO NEGRO */}
      {isModalOpen && (
        <ModalPortal onClose={() => setIsModalOpen(false)}>
            
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                {editingProduct ? <Edit size={20} className="text-blue-400"/> : <Plus size={20} className="text-emerald-400"/>}
                {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className={labelClass}>Nombre del Producto</label>
                <input
                  required
                  placeholder="Ej: Gatorade Blue"
                  className={inputClass}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className={labelClass}>Precio ($)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    placeholder="0"
                    className={inputClass}
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Stock Inicial</label>
                  <input
                    required
                    type="number"
                    min="0"
                    placeholder="0"
                    className={inputClass}
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Categoría (Opcional)</label>
                <input
                  className={inputClass}
                  placeholder="Ej: Bebidas, Grips, Alquiler..."
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full btn btn-primary py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-lg shadow-emerald-900/20 transition-all transform active:scale-[0.98]"
                >
                  {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                </button>
              </div>
            </form>
        </ModalPortal>
      )}
    </>
  );
}