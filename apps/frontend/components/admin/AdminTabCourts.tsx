import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getCourts, createCourt, suspendCourt, reactivateCourt } from '../../services/CourtService';
import AppModal from '../AppModal';
import { Plus, LayoutGrid, Activity, Power, Ban } from 'lucide-react';

export default function AdminTabCourts() {
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS');
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const wrapAction = (action?: () => Promise<void> | void) => async () => { closeModal(); await action?.(); };
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  
  const showConfirm = (options: {
    title: string; message: ReactNode; confirmText?: string; cancelText?: string; isWarning?: boolean;
    onConfirm: () => Promise<void> | void; onCancel?: () => Promise<void> | void; closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }) => setModalState({
    show: true, title: options.title, message: options.message,
    confirmText: options.confirmText ?? 'Aceptar', cancelText: options.cancelText ?? 'Cancelar', isWarning: options.isWarning ?? true,
    closeOnBackdrop: options.closeOnBackdrop, closeOnEscape: options.closeOnEscape,
    onConfirm: wrapAction(options.onConfirm), onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
  });

  const loadCourts = async () => { const data = await getCourts(); setCourts(data); };
  useEffect(() => { loadCourts(); }, []);

  const handleCreateCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCourt(newName, newSport);
      showInfo('Cancha creada con éxito', 'Listo');
      setNewName('');
      loadCourts();
    } catch (error: any) { showError('Error: ' + error.message); }
  };

  const handleSuspend = async (id: number) => {
    showConfirm({
      title: 'Suspender cancha', message: '¿Seguro que deseas poner esta cancha en mantenimiento?', confirmText: 'Suspender',
      onConfirm: async () => { try { await suspendCourt(id); loadCourts(); } catch (error: any) { showError('Error: ' + error.message); } }
    });
  };

  const handleReactivate = async (id: number) => {
    showConfirm({
      title: 'Reactivar cancha', message: '¿Deseas habilitar nuevamente esta cancha para reservas?', confirmText: 'Reactivar', isWarning: false,
      onConfirm: async () => { try { await reactivateCourt(id); loadCourts(); } catch (error: any) { showError('Error: ' + error.message); } }
    });
  };

  return (
    <>
      {/* --- FORMULARIO DE ALTA (TARJETA BEIGE) --- */}
      <div className="bg-[#EBE1D8] border-4 border-white rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
        <h2 className="text-2xl font-black text-[#926699] mb-6 flex items-center gap-3 uppercase italic tracking-tight">
          <div className="bg-[#926699] text-[#EBE1D8] p-2 rounded-xl text-xl shadow-lg shadow-[#926699]/20">
            <Plus size={24} strokeWidth={3} />
          </div>
          Nueva Cancha
        </h2>
        
        <form onSubmit={handleCreateCourt} className="flex flex-col md:flex-row gap-6 items-end relative z-10">
          <div className="flex-1 w-full">
            <label className="block text-[10px] font-black text-[#347048]/60 mb-2 uppercase tracking-widest ml-1">Nombre / Identificador</label>
            <input 
              type="text" 
              value={newName} 
              onChange={(e) => setNewName(e.target.value)}
              className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/20 focus:outline-none shadow-sm transition-all" 
              placeholder="Ej: Cancha Central o Pista 1" 
              required
            />
          </div>
          
          <div className="w-full md:w-64">
            <label className="block text-[10px] font-black text-[#347048]/60 mb-2 uppercase tracking-widest ml-1">Deporte / Tipo</label>
            <select 
              value={newSport} 
              onChange={(e) => setNewSport(e.target.value)} 
              className="w-full h-12 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-black focus:outline-none shadow-sm appearance-none cursor-pointer"
            >
              <option value="TENNIS">🎾 Tenis</option>
              <option value="PADEL">🏓 Pádel</option>
              <option value="FUTBOL">⚽ Fútbol</option>
            </select>
          </div>

          <button 
            type="submit" 
            className="w-full md:w-auto h-12 px-10 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-xl transition-all shadow-xl shadow-[#347048]/20 uppercase tracking-widest text-xs italic"
          >
            Crear Cancha
          </button>
        </form>
      </div>

      {/* --- LISTADO Y ESTADOS (DISEÑO PREMIUM) --- */}
      <div className="bg-[#EBE1D8] border-4 border-white rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-8">
          <h2 className="text-2xl font-black text-[#347048] uppercase italic tracking-tighter flex items-center gap-3">
             <div className="w-2 h-8 bg-[#B9CF32] rounded-full"></div>
             Estado de Canchas
          </h2>
          <div className="bg-white/40 border border-white px-4 py-1.5 rounded-full shadow-sm">
             <span className="text-[10px] font-black text-[#347048] uppercase tracking-widest">{courts.length} Registradas</span>
          </div>
        </div>

        <div className="overflow-x-auto -mx-8 sm:mx-0">
          <table className="w-full text-left border-separate border-spacing-y-2">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/40">
                <th className="px-6 py-2">ID</th>
                <th className="px-6 py-2">Nombre Cancha</th>
                <th className="px-6 py-2">Disciplina</th>
                <th className="px-6 py-2 text-center">Estado Operativo</th>
                <th className="px-6 py-2 text-right">Controles</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {courts.map((c) => (
                <tr key={c.id} className="bg-white/60 hover:bg-white transition-all shadow-sm group">
                  <td className="px-6 py-5 first:rounded-l-2xl font-black text-[#347048]/40 italic">#{c.id.toString().padStart(3, '0')}</td>
                  <td className="px-6 py-5 font-black text-[#347048] uppercase tracking-tight">{c.name}</td>
                  <td className="px-6 py-5">
                    <span className="text-[10px] font-black bg-[#926699]/10 text-[#926699] px-3 py-1 rounded-full border border-[#926699]/20 uppercase tracking-widest">
                        {c.sport || c.surface || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-center">
                    {c.isUnderMaintenance ? (
                      <span className="inline-flex items-center gap-2 text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider border bg-red-50 text-red-600 border-red-200">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></div>
                        Mantenimiento
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-wider border bg-emerald-50 text-emerald-700 border-emerald-200">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                        Operativo
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5 last:rounded-r-2xl text-right">
                    {c.isUnderMaintenance ? (
                      <button 
                        onClick={() => handleReactivate(c.id)} 
                        className="text-[10px] font-black uppercase tracking-widest bg-[#B9CF32] text-[#347048] px-4 py-2 rounded-xl shadow-md hover:scale-105 transition-all flex items-center gap-2 ml-auto"
                      >
                        <Power size={14} strokeWidth={3} /> Reactivar
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleSuspend(c.id)} 
                        className="text-[10px] font-black uppercase tracking-widest bg-white border-2 border-red-100 text-red-500 px-4 py-2 rounded-xl hover:bg-red-500 hover:text-white transition-all flex items-center gap-2 ml-auto"
                      >
                        <Ban size={14} strokeWidth={3} /> Suspender
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AppModal 
        show={modalState.show} 
        onClose={closeModal} 
        onCancel={modalState.onCancel} 
        title={modalState.title} 
        message={modalState.message}
        cancelText={modalState.cancelText} 
        confirmText={modalState.confirmText} 
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm} 
        closeOnBackdrop={modalState.closeOnBackdrop} 
        closeOnEscape={modalState.closeOnEscape} 
      />
    </>
  );
}