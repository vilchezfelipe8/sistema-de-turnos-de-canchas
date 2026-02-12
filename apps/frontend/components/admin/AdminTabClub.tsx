import { useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { ClubService, Club } from '../../services/ClubService';
import AppModal from '../AppModal';

export default function AdminTabClub() {
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [clubForm, setClubForm] = useState({
    slug: '', name: '', address: '', contactInfo: '', phone: '', logoUrl: '',
    instagramUrl: '', facebookUrl: '', websiteUrl: '', description: '',
    lightsEnabled: false,
    lightsExtraAmount: '',
    lightsFromHour: ''
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
          websiteUrl: clubData.websiteUrl || '', description: clubData.description || '',
          lightsEnabled: clubData.lightsEnabled ?? false,
          lightsExtraAmount: clubData.lightsExtraAmount != null ? String(clubData.lightsExtraAmount) : '',
          lightsFromHour: clubData.lightsFromHour || ''
        });
        setLogoPreview(clubData.logoUrl || null);
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
      const payload: any = {
        ...clubForm,
        lightsEnabled: !!clubForm.lightsEnabled,
        lightsExtraAmount: clubForm.lightsExtraAmount === '' ? null : Number(clubForm.lightsExtraAmount),
        lightsFromHour: clubForm.lightsFromHour || null
      };
      const updatedClub = await ClubService.updateClub(club.id, payload);
      setClub(updatedClub);
      showInfo('✅ Información del club actualizada correctamente', 'Éxito');
    } catch (error: any) {
      showError('Error al actualizar el club: ' + error.message);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLogoError('El archivo debe ser una imagen (PNG, JPG, etc).');
      return;
    }
    // Límite razonable de 2MB para el logo
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('El logo no puede pesar más de 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setClubForm((prev) => ({ ...prev, logoUrl: result }));
      setLogoPreview(result);
      setLogoError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setClubForm((prev) => ({ ...prev, logoUrl: '' }));
    setLogoPreview(null);
    setLogoError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Logo del Club</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-surface flex items-center justify-center">
                    {logoPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoPreview} alt="Logo del club" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted">Sin logo</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface border border-border text-text hover:border-emerald-500/60 hover:text-emerald-300 transition"
                      >
                        Subir imagen
                      </button>
                      {logoPreview && (
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface border border-red-500/50 text-red-300 hover:bg-red-500/10 transition"
                        >
                          Quitar logo
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted">
                      Formato recomendado: cuadrado, máximo 2MB. Se guardará como parte de la configuración del club.
                    </p>
                    {logoError && <p className="text-[11px] text-red-400">{logoError}</p>}
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFileChange}
                />
              </div>
              <div className="md:col-span-2 mt-4 border-t border-border pt-4">
                <p className="text-xs font-bold text-slate-500 mb-2 uppercase">Luces y Horarios</p>
                <div className="flex flex-col md:flex-row gap-4 items-center">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clubForm.lightsEnabled}
                      onChange={(e) => setClubForm({ ...clubForm, lightsEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-600 text-emerald-500 focus:ring-emerald-500 focus:ring-2"
                    />
                    <span className="text-sm">Cobrar extra por luces en horarios nocturnos</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Monto extra</label>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-500">$</span>
                        <input
                          type="number"
                          min={0}
                          step={100}
                          disabled={!clubForm.lightsEnabled}
                          value={clubForm.lightsExtraAmount}
                          onChange={(e) => setClubForm({ ...clubForm, lightsExtraAmount: e.target.value })}
                          className="w-28 bg-surface border border-border rounded-lg px-2 py-1 text-text text-sm focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
                          placeholder="5000"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-1">Desde hora</label>
                      <select
                        disabled={!clubForm.lightsEnabled}
                        value={clubForm.lightsFromHour || ''}
                        onChange={(e) => setClubForm({ ...clubForm, lightsFromHour: e.target.value })}
                        className="bg-surface border border-border rounded-lg px-2 py-1 text-text text-sm focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
                      >
                        <option value="">Seleccionar...</option>
                        <option value="18:00">18:00</option>
                        <option value="19:00">19:00</option>
                        <option value="20:00">20:00</option>
                        <option value="21:00">21:00</option>
                        <option value="22:00">22:00</option>
                      </select>
                    </div>
                  </div>
                </div>
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
