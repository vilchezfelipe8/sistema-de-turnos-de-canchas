import { useEffect, useState, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { ClubService, Club } from '../../services/ClubService';
import AppModal from '../AppModal';
import { Settings, Globe, Instagram, Facebook, MapPin, Phone, Mail, Lightbulb, Image as ImageIcon, Trash2, Save } from 'lucide-react';

export default function AdminTabClub() {
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [clubForm, setClubForm] = useState({
    slug: '', name: '', addressLine: '', city: '', province: '', country: '', contactInfo: '', phone: '', logoUrl: '', clubImageUrl: '',
    instagramUrl: '', facebookUrl: '', websiteUrl: '', description: '',
    lightsEnabled: false,
    lightsExtraAmount: '',
    lightsFromHour: ''
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [clubImagePreview, setClubImagePreview] = useState<string | null>(null);
  const [clubImageError, setClubImageError] = useState<string | null>(null);
  const clubImageInputRef = useRef<HTMLInputElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });

  const loadClub = useCallback(async () => {
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
          slug: clubData.slug || '', name: clubData.name || '',
          addressLine: clubData.addressLine || '', city: clubData.city || '', province: clubData.province || '', country: clubData.country || '',
          contactInfo: clubData.contactInfo || '', phone: clubData.phone || '', logoUrl: clubData.logoUrl || '', clubImageUrl: clubData.clubImageUrl || '',
          instagramUrl: clubData.instagramUrl || '', facebookUrl: clubData.facebookUrl || '',
          websiteUrl: clubData.websiteUrl || '', description: clubData.description || '',
          lightsEnabled: clubData.lightsEnabled ?? false,
          lightsExtraAmount: clubData.lightsExtraAmount != null ? String(clubData.lightsExtraAmount) : '',
          lightsFromHour: clubData.lightsFromHour || ''
        });
  setLogoPreview(clubData.logoUrl || null);
  setClubImagePreview(clubData.clubImageUrl || null);
      }
    } catch (error: any) {
      showError('Error al cargar información del club: ' + error.message);
    } finally {
      setLoadingClub(false);
    }
  }, []);

  useEffect(() => { loadClub(); }, [loadClub]);

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
      showInfo('Información del club actualizada correctamente', 'Éxito');
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

  const handleClubImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setClubImageError('El archivo debe ser una imagen (PNG, JPG, etc).');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setClubImageError('La imagen no puede pesar más de 4MB.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setClubForm((prev) => ({ ...prev, clubImageUrl: result }));
      setClubImagePreview(result);
      setClubImageError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setClubForm((prev) => ({ ...prev, logoUrl: '' }));
    setLogoPreview(null);
    setLogoError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveClubImage = () => {
    setClubForm((prev) => ({ ...prev, clubImageUrl: '' }));
    setClubImagePreview(null);
    setClubImageError(null);
    if (clubImageInputRef.current) clubImageInputRef.current.value = '';
  };

  const inputClass = "w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-4 text-[#347048] font-bold placeholder-[#347048]/20 focus:outline-none shadow-sm transition-all";
  const labelClass = "block text-[10px] font-black text-[#347048]/60 mb-1.5 uppercase tracking-widest ml-1";

  const formatPhoneInput = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    let rest = digits;
    if (rest.startsWith('54')) rest = rest.slice(2);
    if (rest.startsWith('9')) rest = rest.slice(1);
    const area = rest.slice(0, 3);
    const mid = rest.slice(3, 6);
    const end = rest.slice(6, 10);
    const parts = [area, mid, end].filter(Boolean);
    return `+54 9${parts.length ? ' ' : ''}${parts.join(' ')}`.trim();
  };

  return (
    <>
      <div className="bg-[#EBE1D8] border-4 border-white rounded-[2rem] p-8 mb-8 shadow-2xl shadow-[#347048]/30 relative overflow-hidden transition-all">
        {/* ENCABEZADO */}
        <div className="mb-8 pb-6 border-b border-[#347048]/10">
          <h2 className="text-2xl font-black text-[#926699] flex items-center gap-3 uppercase italic tracking-tight">
            <div className="bg-[#926699] text-[#EBE1D8] p-2 rounded-xl text-xl shadow-lg shadow-[#926699]/20">
              <Settings size={24} strokeWidth={3} />
            </div>
            Configuración del Club
          </h2>
          <p className="text-[#347048] text-sm font-bold opacity-70 mt-2 ml-1">Personaliza la identidad y reglas de tu establecimiento.</p>
        </div>

        {loadingClub ? (
          <div className="space-y-6 py-10">
            <div className="h-12 bg-white/50 animate-pulse rounded-2xl w-full"></div>
            <div className="h-12 bg-white/50 animate-pulse rounded-2xl w-full"></div>
            <div className="h-12 bg-white/50 animate-pulse rounded-2xl w-full"></div>
          </div>
        ) : club ? (
          <form onSubmit={handleUpdateClub} className="space-y-8 relative z-10">
            {/* GRID DE DATOS BÁSICOS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Slug (Identificador URL)</label>
                <input type="text" value={clubForm.slug} onChange={(e) => setClubForm({ ...clubForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  className={inputClass} placeholder="ej: las-tejas-padel" required />
                <p className="text-[10px] font-bold text-[#347048]/40 mt-1.5 ml-1">Tu link será: <span className="text-[#347048]">tucancha.com/club/{clubForm.slug || '...'}</span></p>
              </div>
              <div>
                <label className={labelClass}>Nombre Comercial</label>
                <input type="text" value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })} className={inputClass} required />
              </div>
              
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className={labelClass}>Dirección</label>
                  <input type="text" value={clubForm.addressLine} onChange={(e) => setClubForm({ ...clubForm, addressLine: e.target.value })} className={inputClass} placeholder="Calle y número" required />
                </div>
                <div>
                  <label className={labelClass}>Ciudad</label>
                  <input type="text" value={clubForm.city} onChange={(e) => setClubForm({ ...clubForm, city: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>Provincia / Estado</label>
                  <input type="text" value={clubForm.province} onChange={(e) => setClubForm({ ...clubForm, province: e.target.value })} className={inputClass} required />
                </div>
              </div>

              <div>
                <label className={labelClass}>Email Administrativo</label>
                <div className="relative">
                  <input type="email" value={clubForm.contactInfo} onChange={(e) => setClubForm({ ...clubForm, contactInfo: e.target.value })} className={`${inputClass} pl-11`} required />
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30" size={16} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Teléfono Público</label>
                <div className="relative">
                  <input
                    type="text"
                    value={clubForm.phone}
                    maxLength={18}
                    onChange={(e) => setClubForm({ ...clubForm, phone: formatPhoneInput(e.target.value) })}
                    className={`${inputClass} pl-11`}
                    placeholder="+54 9 351..."
                  />
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30" size={16} />
                </div>
              </div>
            </div>

            {/* SECCIÓN DE LOGO */}
            <div className="bg-white/40 p-6 rounded-[1.5rem] border-2 border-white shadow-sm">
              <label className={labelClass}>Identidad Visual (Logo)</label>
              <div className="flex flex-col sm:flex-row items-center gap-6 mt-2">
                <div className="w-24 h-24 rounded-2xl overflow-hidden border-4 border-white bg-white shadow-md flex items-center justify-center relative group">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1" />
                  ) : (
                    <ImageIcon size={32} className="text-[#347048]/20" />
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex gap-3">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="px-5 py-2.5 rounded-xl text-xs font-black bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] transition-all uppercase tracking-widest shadow-lg shadow-[#347048]/20">
                      Subir Imagen
                    </button>
                    {logoPreview && (
                      <button type="button" onClick={handleRemoveLogo} className="px-5 py-2.5 rounded-xl text-xs font-black bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest">
                        Eliminar
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-[#347048]/40 uppercase tracking-wider italic">Recomendado: 512x512px, máx 2MB (PNG/JPG).</p>
                  {logoError && <p className="text-xs text-red-500 font-bold italic">⚠️ {logoError}</p>}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
              </div>
            </div>

            {/* SECCIÓN DE IMAGEN DEL CLUB */}
            <div className="bg-white/40 p-6 rounded-[1.5rem] border-2 border-white shadow-sm">
              <label className={labelClass}>Imagen del Club (Portada)</label>
              <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6 mt-2">
                <div className="w-full lg:w-64 h-36 rounded-2xl overflow-hidden border-4 border-white bg-white shadow-md flex items-center justify-center relative group">
                  {clubImagePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={clubImagePreview} alt="Imagen del club" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center text-[#347048]/30">
                      <ImageIcon size={32} />
                      <span className="text-[10px] font-bold uppercase mt-2">Sin imagen</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex gap-3 flex-wrap">
                    <button type="button" onClick={() => clubImageInputRef.current?.click()} className="px-5 py-2.5 rounded-xl text-xs font-black bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] transition-all uppercase tracking-widest shadow-lg shadow-[#347048]/20">
                      Subir Imagen
                    </button>
                    {clubImagePreview && (
                      <button type="button" onClick={handleRemoveClubImage} className="px-5 py-2.5 rounded-xl text-xs font-black bg-red-50 text-red-600 border border-red-100 hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest">
                        Eliminar
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-[#347048]/40 uppercase tracking-wider italic">Recomendado: 1600x900px, máx 4MB (PNG/JPG).</p>
                  {clubImageError && <p className="text-xs text-red-500 font-bold italic">⚠️ {clubImageError}</p>}
                </div>
                <input ref={clubImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleClubImageFileChange} />
              </div>
            </div>

            {/* LUCES Y HORARIOS (LIMA ACCENT) */}
            <div className="bg-[#B9CF32]/10 p-6 rounded-[1.5rem] border-2 border-[#B9CF32]/20">
              <div className="flex items-center gap-2 mb-4 text-[#347048]">
                <Lightbulb size={18} strokeWidth={3} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Configuración de Iluminación</h3>
              </div>
              <div className="flex flex-col md:flex-row gap-8 items-start md:items-center">
                <label className="flex items-center gap-3 text-[#347048] font-black cursor-pointer group">
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${clubForm.lightsEnabled ? 'bg-[#B9CF32] border-[#B9CF32]' : 'border-[#347048]/20 bg-white'}`}>
                    {clubForm.lightsEnabled && <Save size={16} className="text-[#347048]" strokeWidth={4} />}
                  </div>
                  <input type="checkbox" checked={clubForm.lightsEnabled} onChange={(e) => setClubForm({ ...clubForm, lightsEnabled: e.target.checked })} className="hidden" />
                  <span className="text-sm uppercase tracking-wide italic">Activar recargo nocturno</span>
                </label>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Monto Extra ($)</label>
                    <input type="number" min={0} step={100} disabled={!clubForm.lightsEnabled} value={clubForm.lightsExtraAmount}
                      onChange={(e) => setClubForm({ ...clubForm, lightsExtraAmount: e.target.value })}
                      className="w-32 h-10 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm disabled:opacity-30 transition-all" placeholder="5000" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-[#347048]/40 mb-1 uppercase tracking-widest">Desde la hora</label>
                    <select disabled={!clubForm.lightsEnabled} value={clubForm.lightsFromHour || ''} onChange={(e) => setClubForm({ ...clubForm, lightsFromHour: e.target.value })}
                      className="h-10 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-black text-sm disabled:opacity-30 transition-all cursor-pointer">
                      <option value="">Seleccionar...</option>
                      {["18:00", "19:00", "20:00", "21:00", "22:00"].map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* REDES SOCIALES */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1.5">
                <label className={labelClass}>Instagram URL</label>
                <div className="relative group">
                  <input type="url" value={clubForm.instagramUrl} onChange={(e) => setClubForm({ ...clubForm, instagramUrl: e.target.value })} className={`${inputClass} pl-11`} placeholder="https://instagram.com/..." />
                  <Instagram className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30 group-focus-within:text-[#926699]" size={16} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Facebook URL</label>
                <div className="relative group">
                  <input type="url" value={clubForm.facebookUrl} onChange={(e) => setClubForm({ ...clubForm, facebookUrl: e.target.value })} className={`${inputClass} pl-11`} placeholder="https://facebook.com/..." />
                  <Facebook className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30 group-focus-within:text-[#347048]" size={16} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Sitio Web Propio</label>
                <div className="relative group">
                  <input type="url" value={clubForm.websiteUrl} onChange={(e) => setClubForm({ ...clubForm, websiteUrl: e.target.value })} className={`${inputClass} pl-11`} placeholder="https://mi-club.com" />
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-[#347048]/30 group-focus-within:text-[#B9CF32]" size={16} />
                </div>
              </div>
            </div>

            {/* DESCRIPCIÓN */}
            <div className="space-y-2">
              <label className={labelClass}>Descripción del Club / Información Adicional</label>
              <textarea
                value={clubForm.description}
                onChange={(e) => setClubForm({ ...clubForm, description: e.target.value.slice(0, 100) })}
                maxLength={50}
                className="w-full bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-[1.5rem] p-5 text-[#347048] font-bold placeholder-[#347048]/20 focus:outline-none shadow-sm transition-all resize-none"
                rows={4}
                placeholder="Escribe aquí las reglas del club, servicios (duchas, buffet, etc) o historia..."
              />
            </div>

            {/* BOTÓN FINAL */}
            <div className="flex justify-end pt-6 border-t border-[#347048]/10">
              <button type="submit" className="w-full md:w-auto px-10 py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-2xl shadow-xl shadow-[#347048]/20 transition-all uppercase tracking-[0.2em] text-sm italic flex items-center justify-center gap-3">
                <Save size={20} strokeWidth={3} />
                Guardar Configuración
              </button>
            </div>
          </form>
        ) : (
          <div className="py-20 text-center text-[#347048]/40 font-black uppercase italic tracking-widest">No se pudo cargar la información</div>
        )}
      </div>

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message}
        cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm}
        closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}