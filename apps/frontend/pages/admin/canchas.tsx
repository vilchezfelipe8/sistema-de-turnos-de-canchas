import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getCourts, createCourt, suspendCourt, reactivateCourt } from '../../services/CourtService';
import AdminLayout from '../../components/AdminLayout';
import AppModal from '../../components/AppModal';

export default function CanchasPage() {
  // --- ESTADOS DE LA PÁGINA ---
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('TENNIS');
  const [authChecked, setAuthChecked] = useState(false);

  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: ReactNode;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
    onConfirm?: () => Promise<void> | void;
    onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => {
    setModalState((prev) => ({
      ...prev,
      show: false,
      onConfirm: undefined,
      onCancel: undefined
    }));
  };

  const wrapAction = (action?: () => Promise<void> | void) => async () => {
    closeModal();
    await action?.();
  };

  const showInfo = (message: ReactNode, title = 'Información') => {
    setModalState({
      show: true,
      title,
      message,
      cancelText: '',
      confirmText: 'OK'
    });
  };

  const showError = (message: ReactNode) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar'
    });
  };

  const showConfirm = (options: {
    title: string;
    message: ReactNode;
    confirmText?: string;
    cancelText?: string;
    isWarning?: boolean;
    onConfirm: () => Promise<void> | void;
    onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
  }) => {
    setModalState({
      show: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? 'Aceptar',
      cancelText: options.cancelText ?? 'Cancelar',
      isWarning: options.isWarning ?? true,
      closeOnBackdrop: options.closeOnBackdrop,
      closeOnEscape: options.closeOnEscape,
      onConfirm: wrapAction(options.onConfirm),
      onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
    });
  };

  // --- GUARDIA DE ACCESO ADMIN ---
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    const user = rawUser ? JSON.parse(rawUser) : null;
    if (!token) {
      window.location.href = '/login';
      return;
    }
    if (!user || user.role !== 'ADMIN') {
      window.location.href = '/';
      return;
    }
    setAuthChecked(true);
  }, []);

  const loadCourts = async () => { const data = await getCourts(); setCourts(data); };

  useEffect(() => { loadCourts(); }, []);

  // --- CREAR CANCHA ---
  const handleCreateCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCourt(newName, newSport);
      showInfo('✅ Cancha creada', 'Listo');
      setNewName('');
      loadCourts();
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  const handleSuspend = async (id: number) => {
    showConfirm({
      title: 'Suspender cancha',
      message: '¿Querés suspender esta cancha?',
      confirmText: 'Suspender',
      onConfirm: async () => {
        try {
          await suspendCourt(id);
          loadCourts();
        } catch (error: any) {
          showError('Error: ' + error.message);
        }
      }
    });
  };

  const handleReactivate = async (id: number) => {
    showConfirm({
      title: 'Reactivar cancha',
      message: '¿Querés reactivar esta cancha?',
      confirmText: 'Reactivar',
      isWarning: false,
      onConfirm: async () => {
        try {
          await reactivateCourt(id);
          loadCourts();
        } catch (error: any) {
          showError('Error: ' + error.message);
        }
      }
    });
  };

  if (!authChecked) {
    return null;
  }

  return (
    <AdminLayout>
      {/* --- FORMULARIO DE CREACIÓN CANCHA --- */}
      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-6">
          <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
            <span>✚</span> NUEVA CANCHA
          </h2>
          <form onSubmit={handleCreateCourt} className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1 w-full">
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre ID</label>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" placeholder="Ej: Cancha Central" />
              </div>
              <div className="w-full sm:w-48">
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Tipo</label>
                  <select value={newSport} onChange={(e) => setNewSport(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none">
                      <option value="TENNIS">🎾 Tenis</option>
                      <option value="PADEL">🏓 Pádel</option>
                      <option value="FUTBOL">⚽ Fútbol</option>
                  </select>
              </div>
              <button
                type="submit"
                className="btn btn-primary w-full sm:w-auto px-6 py-2 bg-white/5 hover:bg-white/10 border-white/40 hover:border-white/70 shadow-[0_0_18px_rgba(255,255,255,0.08)] transition"
              >
                CREAR
              </button>
          </form>
      </div>

      {/* --- LISTADO DE CANCHAS (Tabla) --- */}
      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-8 overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-text">ESTADO DE CANCHAS</h2>
            <span className="px-3 py-1 bg-surface rounded-full text-xs font-mono text-emerald-300 border border-emerald-500/30">
              {courts.length} ACTIVAS
            </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
          <tr className="border-b border-border text-muted text-xs uppercase tracking-wider">
              <th className="p-4">ID</th>
              <th className="p-4">Nombre</th>
              <th className="p-4">Tipo</th>
              <th className="p-4">Estado</th>
              <th className="p-5 text-right">Controles</th>
            </tr>
          </thead>
          <tbody className="text-sm font-medium">
            {courts.map((c) => (
              <tr key={c.id} className="border-b border-border/50 hover:bg-surface-70 transition-colors group">
                <td className="p-4 font-mono text-muted">#{c.id.toString().padStart(3, '0')}</td>
                <td className="p-4 text-text font-bold">{c.name}</td>
                <td className="p-5">
                  <span className="px-2 py-1 rounded text-xs text-muted border border-border">{c.sport || c.surface || '-'}</span>
                </td>
                <td className="p-5">
                  {c.isUnderMaintenance ? (
                    <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-red-500/30 text-red-300 bg-red-500/10">
                      <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
                      MANTENIMIENTO
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                      OPERATIVO
                    </span>
                  )}
                </td>
                <td className="p-5 text-right">
                  {c.isUnderMaintenance ? (
                    <button
                      onClick={() => handleReactivate(c.id)}
                      className="text-xs btn px-3 py-1 bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/70"
                    >
                      REACTIVAR
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSuspend(c.id)}
                      className="text-xs btn px-3 py-1 bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20 hover:border-red-400/70"
                    >
                      SUSPENDER
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
    </AdminLayout>
  );
}