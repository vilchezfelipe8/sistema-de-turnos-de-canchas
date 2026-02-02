import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

// Definimos la estructura del Cliente
interface Client {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
  totalBookings?: number;
}

export default function ClientsPage() {
  const router = useRouter();
  const { slug } = router.query;
  
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  // Función para obtener los clientes del Backend
  const fetchClients = async () => {
    if (!slug) return;
    setLoading(true);
    setError('');
    
    try {
      const token = localStorage.getItem('token');
      // Usamos la variable de entorno o localhost por defecto
      const apiUrl = 'http://localhost:4000';
      
      // Ajusta la ruta '/clients' según tu Backend (ej: /api/clients)
      // Le pasamos el slug del club para filtrar
      const response = await fetch(`${apiUrl}/clients?clubSlug=${slug}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // Si falla, no rompemos todo, solo mostramos error en consola/ui
        throw new Error('Error al conectar con el servidor');
      }
      
      const data = await response.json();
      setClients(data);

    } catch (err: any) {
      console.error("Error fetching clients:", err);
      setError('No se pudieron cargar los clientes.');
    } finally {
      setLoading(false);
    }
  };

  // Cargar clientes automáticamente al entrar
  useEffect(() => {
    if (slug) fetchClients();
  }, [slug]);

  // Lógica del Buscador (Filtra por nombre, apellido o teléfono)
  const filteredClients = clients.filter(c => 
    c.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phoneNumber && c.phoneNumber.includes(searchTerm))
  );

  return (
    <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-4 animate-fade-in">
      
      {/* --- ENCABEZADO Y BUSCADOR --- */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <h2 className="text-lg font-bold text-text flex items-center gap-2">
          <span>👥</span> GESTIÓN DE CLIENTES
          <span className="text-xs bg-surface border border-border px-2 py-1 rounded-full text-emerald-400 font-mono">
            {clients.length}
          </span>
        </h2>
        
        <div className="w-full md:w-auto flex gap-2">
           <div className="relative w-full md:w-64">
             <input 
               type="text" 
               placeholder="Buscar nombre o teléfono..." 
               className="bg-surface border border-border rounded-lg pl-4 pr-10 py-2 text-text text-sm focus:outline-none focus:border-emerald-500 w-full"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
             />
             <span className="absolute right-3 top-2 text-muted text-xs">🔍</span>
           </div>
           
           <button 
             onClick={fetchClients} 
             className="btn btn-secondary px-3 py-2 text-sm border border-border hover:bg-surface rounded-lg transition-colors" 
             title="Recargar lista"
           >
             🔄
           </button>
        </div>
      </div>

      {/* --- MENSAJE DE ERROR --- */}
      {error && (
        <div className="p-4 mb-6 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl text-sm flex items-center gap-2">
          <span>⚠️</span> {error}
        </div>
      )}
      
      {/* --- TABLA DE CLIENTES --- */}
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface/60 text-muted text-xs uppercase tracking-wider border-b border-border/60">
              <th className="p-4">Nombre</th>
              <th className="p-4">Teléfono</th>
              <th className="p-4 text-center">Reservas</th>
              <th className="p-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {loading ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted">
                  <span className="animate-pulse">Cargando clientes...</span>
                </td>
              </tr>
            ) : filteredClients.length > 0 ? (
              filteredClients.map((client) => (
                <tr key={client.id} className="border-b border-border/50 hover:bg-surface-70/70 transition-colors group">
                  <td className="p-4">
                    <div className="font-bold text-text text-base capitalize">{client.firstName} {client.lastName}</div>
                    <div className="text-xs text-muted font-mono mt-0.5">ID: #{client.id}</div>
                  </td>
                  <td className="p-4">
                    {client.phoneNumber ? (
                      <div className="text-emerald-400/80 text-sm font-mono flex items-center gap-1">
                        <span>📞</span> {client.phoneNumber}
                      </div>
                    ) : (
                      <span className="text-muted text-xs">- Sin teléfono -</span>
                    )}
                  </td>
                  <td className="p-4 text-center">
                    <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold border ${client.totalBookings && client.totalBookings > 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-surface text-muted border-border'}`}>
                      {client.totalBookings || 0}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <button className="text-xs btn px-3 py-1.5 bg-surface border border-border text-slate-300 hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/30 transition-all rounded-lg">
                      VER HISTORIAL
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-12 text-center border-dashed border-border">
                  <p className="text-muted text-lg mb-2">🤷‍♂️</p>
                  <p className="text-slate-400 text-sm">
                    {searchTerm ? 'No hay coincidencias.' : 'Aún no hay clientes registrados.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}