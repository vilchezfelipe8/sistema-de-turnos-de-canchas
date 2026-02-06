'use client';

import { useState, useEffect } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { Search, Plus, Edit, Trash2, X } from 'lucide-react';

interface ProductsPageProps {
  slug?: string;
  params?: { slug: string };
}

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

  const inputClass = 'w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50';
  const labelClass = 'block text-xs font-bold text-slate-500 mb-2 uppercase';

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
          <input
            type="text"
            placeholder="Buscar producto..."
            className={`${inputClass} pl-10`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={openNew}
          className="btn btn-primary px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-200 flex items-center gap-2 shrink-0"
        >
          <Plus size={18} /> Nuevo producto
        </button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-surface/50">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted uppercase tracking-wider text-xs">
              <th className="p-4 font-semibold">Producto</th>
              <th className="p-4 font-semibold">Categoría</th>
              <th className="p-4 font-semibold">Stock</th>
              <th className="p-4 font-semibold">Precio</th>
              <th className="p-4 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
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
                <tr key={product.id} className="hover:bg-surface-70/50 transition-colors">
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

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-surface-70 border border-border rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-border">
              <h3 className="text-lg font-bold text-text">
                {editingProduct ? 'Editar producto' : 'Nuevo producto'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-lg text-muted hover:text-text hover:bg-surface transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className={labelClass}>Nombre</label>
                <input
                  required
                  className={inputClass}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Precio ($)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className={inputClass}
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Stock</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className={inputClass}
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Categoría (opcional)</label>
                <input
                  className={inputClass}
                  placeholder="Ej: Bebidas, Grips..."
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>
              <button
                type="submit"
                className="w-full btn btn-primary py-3 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-200 font-semibold"
              >
                {editingProduct ? 'Guardar cambios' : 'Crear producto'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
