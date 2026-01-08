import { useEffect, useState } from 'react';
import Navbar from '../components/NavBar';
import { getCourts, createCourt, suspendCourt, reactivateCourt } from '../services/CourtService';
import { getAdminSchedule } from '../services/BookingService';

export default function AdminPage() {
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS'); // Valor por defecto

  // Estados para la grilla de turnos
  const [scheduleDate, setScheduleDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD
  });
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadCourts = async () => {
    const data = await getCourts();
    setCourts(data);
  };

  const loadSchedule = async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      setScheduleBookings(data);
      setLastUpdate(new Date());
    } catch (error: any) {
      alert('Error al cargar el schedule: ' + error.message);
    } finally {
      setLoadingSchedule(false);
    }
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

  const handleSuspend = async (id: number) => {
    if (!confirm('¿Suspender esta cancha? Se pondrá en mantenimiento.')) return;
    try {
        await suspendCourt(id);
        alert('✅ Cancha suspendida');
        loadCourts();
    } catch (error: any) {
        alert('Error: ' + error.message);
    }
  };

  const handleReactivate = async (id: number) => {
    if (!confirm('¿Reactivar esta cancha? Saldrá del mantenimiento.')) return;
    try {
        await reactivateCourt(id);
        alert('✅ Cancha reactivada');
        loadCourts();
    } catch (error: any) {
        alert('Error: ' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50">
      <Navbar />
      <div className="container mx-auto p-3 sm:p-4 lg:p-6 max-w-6xl">
        {/* Header */}
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-gray-900 mb-2">
            Panel de Administración
          </h1>
          <p className="text-sm sm:text-base text-gray-600 font-medium">Gestiona las canchas del club</p>
        </div>

        {/* FORMULARIO DE CREAR */}
        <div className="bg-white/80 backdrop-blur-lg p-4 sm:p-6 lg:p-8 rounded-2xl shadow-xl border border-white/50 mb-4 sm:mb-6 lg:mb-8">
            <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
              <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg">
                <span className="text-xl sm:text-2xl">➕</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Agregar Nueva Cancha</h2>
            </div>
            <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-end">
                <div className="flex-1 w-full sm:min-w-[200px]">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Nombre</label>
                    <input 
                        type="text" 
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all font-medium text-sm sm:text-base"
                        placeholder="Ej: Cancha Central"
                    />
                </div>
                <div className="w-full sm:min-w-[180px]">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Deporte</label>
                    <select 
                        value={newSport}
                        onChange={(e) => setNewSport(e.target.value)}
                        className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all font-medium bg-white text-sm sm:text-base"
                    >
                        <option value="TENNIS">🎾 Tenis</option>
                        <option value="PADEL">🏓 Padel</option>
                        <option value="FUTBOL">⚽ Fútbol</option>
                    </select>
                </div>
                <button 
                  type="submit" 
                  className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl font-bold hover:from-orange-700 hover:to-amber-700 transition-all transform hover:scale-105 shadow-lg shadow-orange-500/30 flex items-center justify-center gap-2 text-sm sm:text-base"
                >
                  <span>➕</span>
                  <span>Agregar</span>
                </button>
            </form>
        </div>

        {/* LISTADO DE CANCHAS */}
        <div className="bg-white/80 backdrop-blur-lg p-8 rounded-2xl shadow-xl border border-white/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-lg">
                <span className="text-2xl">🏟️</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-800">Canchas Activas</h2>
              <span className="ml-auto px-4 py-1 bg-orange-100 text-orange-700 rounded-full font-bold text-sm">
                {courts.length} canchas
              </span>
            </div>
            
            {courts.length === 0 ? (
              <div className="text-center py-8 sm:py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 px-4">
                <span className="text-4xl sm:text-5xl mb-4 block">🏟️</span>
                <p className="text-gray-500 font-medium text-sm sm:text-base">No hay canchas registradas</p>
                <p className="text-gray-400 text-xs sm:text-sm mt-1">Agrega una nueva cancha usando el formulario de arriba</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <div className="min-w-full inline-block align-middle">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                        <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">ID</th>
                        <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Nombre</th>
                        <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Deporte</th>
                        <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courts.map((c, index) => (
                        <tr 
                          key={c.id} 
                          className="border-b border-gray-100 hover:bg-gradient-to-r hover:from-orange-50 hover:to-amber-50 transition-colors"
                        >
                          <td className="p-2 sm:p-4 font-mono font-bold text-gray-500 text-xs sm:text-sm">#{c.id}</td>
                          <td className="p-2 sm:p-4 font-bold text-gray-800 text-sm sm:text-base lg:text-lg">
                            {c.name}
                            {c.isUnderMaintenance && (
                              <span className="ml-2 inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full font-bold text-xs">
                                🔧 Mantenimiento
                              </span>
                            )}
                          </td>
                          <td className="p-2 sm:p-4">
                            <span className="inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 bg-orange-100 text-orange-700 rounded-full font-bold text-xs sm:text-sm">
                              {c.sport === 'TENNIS' && '🎾'}
                              {c.sport === 'PADEL' && '🏓'}
                              {c.sport === 'FUTBOL' && '⚽'}
                              {c.sport || c.activity?.name || '-'}
                            </span>
                          </td>
                          <td className="p-2 sm:p-4">
                            {c.isUnderMaintenance ? (
                              <button 
                                onClick={() => handleReactivate(c.id)}
                                className="px-2 sm:px-4 py-1.5 sm:py-2 bg-green-50 text-green-600 border-2 border-green-200 rounded-lg font-bold text-xs sm:text-sm hover:bg-green-600 hover:text-white hover:border-green-600 transition-all transform hover:scale-105 whitespace-nowrap"
                              >
                                ✅ <span className="hidden sm:inline">Reactivar</span>
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleSuspend(c.id)}
                                className="px-2 sm:px-4 py-1.5 sm:py-2 bg-red-50 text-red-600 border-2 border-red-200 rounded-lg font-bold text-xs sm:text-sm hover:bg-red-600 hover:text-white hover:border-red-600 transition-all transform hover:scale-105 whitespace-nowrap"
                              >
                                🔧 <span className="hidden sm:inline">Suspender</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </div>

        {/* GRILLA COMPLETA DE TURNOS */}
        <div className="bg-white/80 backdrop-blur-lg p-4 sm:p-6 lg:p-8 rounded-2xl shadow-xl border border-white/50 mb-4 sm:mb-6 lg:mb-8">
          <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
            <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg">
              <span className="text-xl sm:text-2xl">📅</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Grilla Completa de Turnos</h2>
          </div>

          {/* Selector de fecha */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-end mb-6">
            <div className="flex-1 w-full sm:min-w-[200px]">
              <label className="block text-sm font-bold text-gray-700 mb-2">Seleccionar Fecha</label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-full px-3 sm:px-4 py-2 sm:py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all font-medium text-sm sm:text-base"
              />
            </div>
            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={loadSchedule}
                disabled={loadingSchedule}
                className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-bold hover:from-blue-700 hover:to-purple-700 transition-all transform hover:scale-105 shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 text-sm sm:text-base disabled:opacity-50"
              >
                {loadingSchedule ? 'Cargando...' : '🔍 Ver Turnos'}
              </button>
              {scheduleBookings.length > 0 && (
                <button
                  onClick={loadSchedule}
                  disabled={loadingSchedule}
                  className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-bold hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 shadow-lg shadow-green-500/30 flex items-center justify-center gap-2 text-sm sm:text-base disabled:opacity-50"
                >
                  {loadingSchedule ? 'Actualizando...' : '🔄 Actualizar'}
                </button>
              )}
            </div>
          </div>

          {/* Indicador de última actualización */}
          {lastUpdate && scheduleBookings.length > 0 && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700 font-medium">
                📊 Última actualización: {lastUpdate.toLocaleString('es-ES')}
                <span className="ml-2 text-xs text-blue-500">
                  (Los datos pueden estar desactualizados si se hicieron reservas recientemente)
                </span>
              </p>
            </div>
          )}

          {/* Grilla de turnos */}
          {scheduleBookings.length > 0 ? (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="min-w-full inline-block align-middle">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                      <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Hora</th>
                      <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Cancha</th>
                      <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Estado</th>
                      <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Usuario</th>
                      <th className="p-2 sm:p-4 text-left font-bold text-gray-700 text-xs sm:text-sm">Teléfono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleBookings.map((slot, index) => (
                      <tr
                        key={`${slot.courtId}-${slot.slotTime}`}
                        className="border-b border-gray-100 hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 transition-colors"
                      >
                        <td className="p-2 sm:p-4 font-mono font-bold text-gray-500 text-xs sm:text-sm">
                          {slot.slotTime}
                        </td>
                        <td className="p-2 sm:p-4 font-bold text-gray-800 text-sm sm:text-base">
                          {slot.courtName}
                        </td>
                        <td className="p-2 sm:p-4">
                          <span className={`inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded-full font-bold text-xs sm:text-sm ${
                            slot.isAvailable
                              ? 'bg-green-100 text-green-700'
                              : slot.booking?.status === 'CONFIRMED'
                              ? 'bg-red-100 text-red-700'
                              : slot.booking?.status === 'CANCELLED'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}>
                            {slot.isAvailable ? '✅ Disponible' :
                             slot.booking?.status === 'CONFIRMED' ? '❌ Ocupado' :
                             slot.booking?.status === 'CANCELLED' ? '⚠️ Cancelado' :
                             '⏳ Pendiente'}
                          </span>
                        </td>
                        <td className="p-2 sm:p-4 text-gray-700 text-sm sm:text-base">
                          {slot.booking?.user ? `${slot.booking.user.firstName} ${slot.booking.user.lastName}` : '-'}
                        </td>
                        <td className="p-2 sm:p-4">
                          <span className="inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 bg-green-100 text-green-700 rounded-full font-bold text-xs sm:text-sm">
                            📞 {slot.booking?.user?.phoneNumber || '-'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 sm:py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 px-4">
              <span className="text-4xl sm:text-5xl mb-4 block">📅</span>
              <p className="text-gray-500 font-medium text-sm sm:text-base">
                {loadingSchedule ? 'Cargando turnos...' : 'Selecciona una fecha y presiona "Ver Turnos" para ver la grilla completa'}
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}