import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ClubService, Club } from '../../services/ClubService';
import AppModal from '../AppModal';

export default function AdminTabClub() {
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [clubForm, setClubForm] = useState({
    slug: '', name: '', address: '', contactInfo: '', phone: '', logoUrl: '',
    instagramUrl: '', facebookUrl: '', websiteUrl: '', description: ''
  });
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });

  const loadClub = async () => {
    try {
      setLoadingClub(true);
      const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      let clubId: number | null = null;
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          if (user?.clubId) clubId = user.clubId;
        } catch { /* noop */ }
      }
      if (!clubId) {
        const clubs = await ClubService.getAllClubs();
        if (clubs.length > 0) clubId = clubs[0].id;
      }
      if (clubId) {
        const clubData = await ClubService.getClubById(clubId);
        setClub(clubData);
        setClubForm({
          slug: clubData.slug || '', name: clubData.name || '', address: clubData.address || '',
          contactInfo: clubData.contactInfo || '', phone: clubData.phone || '', logoUrl: clubData.logoUrl || '',
          instagramUrl: clubData.instagramUrl || '', facebookUrl: clubData.facebookUrl || '',
          websiteUrl: clubData.websiteUrl || '', description: clubData.description || ''
        });
      }
    } catch (error: any) {
      showError('Error al cargar información del club: ' + error.message);
    } finally {
      setLoadingClub(false);
    }
  };

  useEffect(() => { loadClub(); }, []);

  const handleUpdateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!club) { showError('No se pudo identificar el club'); return; }
    try {
      const updatedClub = await ClubService.updateClub(club.id, clubForm);
      setClub(updatedClub);
      showInfo('✅ Información del club actualizada correctamente', 'Éxito');
    } catch (error: any) {
      showError('Error al actualizar el club: ' + error.message);
    }
  };

  return (
    <>
      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-6">
        <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><span>⚙️</span> CONFIGURACIÓN DEL CLUB</h2>
        {loadingClub ? (
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-surface-50 rounded w-full"></div>
            <div className="h-10 bg-surface-50 rounded w-full"></div>
            <div className="h-10 bg-surface-50 rounded w-full"></div>
          </div>
        ) : club ? (
          <form onSubmit={handleUpdateClub} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Slug (URL)</label>
                <input type="text" value={clubForm.slug} onChange={(e) => setClubForm({ ...clubForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" placeholder="las-tejas" required />
                <p className="text-xs text-muted mt-1">Usado en la URL: /club/{clubForm.slug || 'slug'}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre del Club</label>
                <input type="text" value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Dirección</label>
                <input type="text" value={clubForm.address} onChange={(e) => setClubForm({ ...clubForm, address: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Email de Contacto</label>
                <input type="email" value={clubForm.contactInfo} onChange={(e) => setClubForm({ ...clubForm, contactInfo: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" required />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Teléfono</label>
                <input type="text" value={clubForm.phone} onChange={(e) => setClubForm({ ...clubForm, phone: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" placeholder="+54 9 357 135 9791" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">URL del Logo</label>
                <input type="url" value={clubForm.logoUrl} onChange={(e) => setClubForm({ ...clubForm, logoUrl: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" placeholder="https://ejemplo.com/logo.png" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Instagram</label>
                <input type="url" value={clubForm.instagramUrl} onChange={(e) => setClubForm({ ...clubForm, instagramUrl: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" placeholder="https://instagram.com/club" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Facebook</label>
                <input type="url" value={clubForm.facebookUrl} onChange={(e) => setClubForm({ ...clubForm, facebookUrl: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" placeholder="https://facebook.com/club" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Sitio Web</label>
                <input type="url" value={clubForm.websiteUrl} onChange={(e) => setClubForm({ ...clubForm, websiteUrl: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" placeholder="https://club.com" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Descripción</label>
              <textarea value={clubForm.description} onChange={(e) => setClubForm({ ...clubForm, description: e.target.value })} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50" rows={3} placeholder="Descripción del club..." />
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary px-6 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 hover:border-emerald-400/70 text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.15)] transition">GUARDAR CAMBIOS</button>
            </div>
          </form>
        ) : (
          <p className="text-muted text-sm">No se pudo cargar la información del club</p>
        )}
      </div>
      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message}
        cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm}
        closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}
