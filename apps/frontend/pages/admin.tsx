import { useEffect, useState } from 'react';
import Navbar from '../components/NavBar';
import { getCourts, createCourt, deleteCourt } from '../services/CourtService';

export default function AdminPage() {
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS'); // Valor por defecto

  const loadCourts = async () => {
    const data = await getCourts();
    setCourts(data);
  };

  useEffect(() => { loadCourts(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        await createCourt(newName, newSport);
        alert('✅ Cancha creada');
        setNewName('');
        loadCourts();
    } catch (error: any) {
        alert('Error: ' + error.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Suspender esta cancha?')) return;
    try {
        await deleteCourt(id);
        loadCourts();
    } catch (error: any) {
        alert('Error: ' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Panel de Administración</h1>

        {/* FORMULARIO DE CREAR */}
        <div className="bg-white p-6 rounded shadow mb-8">
            <h2 className="text-xl font-bold mb-4">Agregar Nueva Cancha</h2>
            <form onSubmit={handleCreate} className="flex gap-4 items-end">
                <div>
                    <label className="block text-sm font-bold text-gray-700">Nombre</label>
                    <input 
                        type="text" 
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="border p-2 rounded w-64"
                        placeholder="Ej: Cancha Central"
                    />
                </div>
                <div>
                    <label className="block text-sm font-bold text-gray-700">Deporte</label>
                    <select 
                        value={newSport}
                        onChange={(e) => setNewSport(e.target.value)}
                        className="border p-2 rounded w-40"
                    >
                        <option value="TENNIS">Tenis</option>
                        <option value="PADEL">Padel</option>
                        <option value="FUTBOL">Fútbol</option>
                    </select>
                </div>
                <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded font-bold hover:bg-green-700">
                    + Agregar
                </button>
            </form>
        </div>

        {/* LISTADO DE CANCHAS */}
        <div className="bg-white p-6 rounded shadow">
            <h2 className="text-xl font-bold mb-4">Canchas Activas</h2>
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b">
                        <th className="p-2">ID</th>
                        <th className="p-2">Nombre</th>
                        <th className="p-2">Deporte</th>
                        <th className="p-2">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    {courts.map((c) => (
                        <tr key={c.id} className="border-b hover:bg-gray-50">
                            <td className="p-2">{c.id}</td>
                            <td className="p-2 font-medium">{c.name}</td>
                            <td className="p-2">{c.sport || c.activity?.name || '-'}</td>
                            <td className="p-2">
                                <button 
                                    onClick={() => handleDelete(c.id)}
                                    className="text-red-500 hover:text-red-700 font-bold text-sm"
                                >
                                    Suspender
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

      </div>
    </div>
  );
}