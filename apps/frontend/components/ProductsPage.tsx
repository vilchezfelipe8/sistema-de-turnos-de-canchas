'use client';
import { useState, useEffect } from 'react';
import { ClubAdminService } from '../services/ClubAdminService'; // Ajustá el import
import { Package, Search, Plus, Edit, Trash2, X } from 'lucide-react';

export default function ProductsPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estado del Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [formData, setFormData] = useState({ name: '', price: '', stock: '', category: '' });

  useEffect(() => {
    loadProducts();
  }, []);

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
      loadProducts(); // Recargar tabla
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
      price: product.price,
      stock: product.stock,
      category: product.category || ''
    });
    setIsModalOpen(true);
  };

  // Filtrado
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 text-white min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Package className="text-green-500" /> Gestión de Stock
          </h1>
          <p className="text-gray-400">Administrá tus productos y precios</p>
        </div>
        <button 
          onClick={() => { setEditingProduct(null); setFormData({name:'', price:'', stock:'', category:''}); setIsModalOpen(true); }}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition"
        >
          <Plus size={20} /> Nuevo Producto
        </button>
      </div>

      {/* Buscador */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-3 text-gray-500" size={20} />
        <input 
          type="text"
          placeholder="Buscar producto..."
          className="w-full bg-gray-800 text-white pl-10 pr-4 py-3 rounded-xl border border-gray-700 focus:border-green-500 focus:outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Tabla */}
      <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-xl">
        <table className="w-full text-left">
          <thead className="bg-gray-900 text-gray-400 uppercase text-sm">
            <tr>
              <th className="p-4">Producto</th>
              <th className="p-4">Categoría</th>
              <th className="p-4">Stock</th>
              <th className="p-4">Precio</th>
              <th className="p-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {loading ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-500">Cargando...</td></tr>
            ) : filteredProducts.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-500">No hay productos registrados.</td></tr>
            ) : (
              filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-gray-700/50 transition">
                  <td className="p-4 font-medium">{product.name}</td>
                  <td className="p-4 text-gray-400">{product.category || '-'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${product.stock < 5 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                      {product.stock} un.
                    </span>
                  </td>
                  <td className="p-4 font-bold text-green-400">${product.price}</td>
                  <td className="p-4 flex justify-end gap-2">
                    <button onClick={() => openEdit(product)} className="p-2 hover:bg-blue-500/20 text-blue-400 rounded"><Edit size={18} /></button>
                    <button onClick={() => handleDelete(product.id)} className="p-2 hover:bg-red-500/20 text-red-400 rounded"><Trash2 size={18} /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 p-6 rounded-2xl w-full max-w-md border border-gray-700 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white">{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white"><X /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Nombre</label>
                <input required className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" 
                  value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Precio ($)</label>
                  <input required type="number" className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" 
                    value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Stock</label>
                  <input required type="number" className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" 
                    value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Categoría (Opcional)</label>
                <input className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-green-500 outline-none" 
                  placeholder="Ej: Bebidas, Grips..."
                  value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} />
              </div>
              <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg mt-4 transition">
                {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}