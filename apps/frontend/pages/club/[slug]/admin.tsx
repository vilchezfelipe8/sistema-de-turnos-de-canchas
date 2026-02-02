import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import PageShell from '../../../components/PageShell';
import AppModal from '../../../components/AppModal';
import DatePicker from 'react-datepicker';
import { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale/es';
import 'react-datepicker/dist/react-datepicker.css';
import { ClubAdminService } from '../../../services/ClubAdminService';
import ClientsPage from '../../../components/ClientsPage';
import {
  cancelBooking,
  createBooking,
  createFixedBooking,
  cancelFixedBooking
} from '../../../services/BookingService';
import { ClubService, Club } from '../../../services/ClubService';
import ProductsPage from '../../../components/ProductsPage'; 
import BookingConsumption from '../../../components/BookingConsumption';

// Registrar locale en español
registerLocale('es', es);

// --- CONSTANTES ---
const CLUB_TIME_SLOTS = [
  "08:00", "09:30", "11:00", "12:30",
  "14:00", "15:30", "17:30", "19:00",
  "20:30", "22:00"
];

const getNextDateForDay = (startDate: Date, targetDayIndex: number, timeStr: string) => {
  const resultDate = new Date(startDate);
  const currentDay = resultDate.getDay();
  let daysUntilTarget = targetDayIndex - currentDay;
  if (daysUntilTarget < 0) {
    daysUntilTarget += 7;
  }
  resultDate.setDate(resultDate.getDate() + daysUntilTarget);
  const [hours, minutes] = timeStr.split(':').map(Number);
  resultDate.setHours(hours, minutes, 0, 0);
  const now = new Date();
  let skippedPast = false;
  if (daysUntilTarget === 0 && resultDate.getTime() <= now.getTime()) {
    resultDate.setDate(resultDate.getDate() + 7);
    skippedPast = true;
  }
  return { date: resultDate, skippedPast };
};

const formatLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isPastTimeForDate = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const slotDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return slotDate.getTime() < Date.now();
};

export default function ClubAdminPage() {
  const router = useRouter();
  const { slug } = router.query;
  const [courts, setCourts] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newSport, setNewSport] = useState('Sintético');
  const [scheduleDate, setScheduleDate] = useState(() => formatLocalDate(new Date()));
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [selectedBookingForDetails, setSelectedBookingForDetails] = useState<any>(null);

  const [clubForm, setClubForm] = useState({
    slug: '', name: '', address: '', contactInfo: '', phone: '',
    logoUrl: '', instagramUrl: '', facebookUrl: '', websiteUrl: '', description: ''
  });

  const [activeTab, setActiveTab] = useState<'courts' | 'bookings' | 'club' | 'clients' | 'products'>('courts') ;

  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string;
    confirmText?: string; isWarning?: boolean; onConfirm?: () => Promise<void> | void;
    onCancel?: () => Promise<void> | void; closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const [manualBooking, setManualBooking] = useState({
    guestFirstName: '',
    guestLastName: '',
    guestPhone: '',
    courtId: '',
    time: '19:00',
    isFixed: false,
    dayOfWeek: '1',
    startDateBase: formatLocalDate(new Date())
  });

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  };

  const wrapAction = (action?: () => Promise<void> | void) => async () => {
    closeModal();
    await action?.();
  };

  const showInfo = (message: ReactNode, title = 'Información') => {
    setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  };

  const showError = (message: ReactNode) => {
    setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  };

  const showConfirm = (options: {
    title: string; message: ReactNode; confirmText?: string; cancelText?: string;
    isWarning?: boolean; onConfirm: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }) => {
    setModalState({
      show: true, title: options.title, message: options.message,
      confirmText: options.confirmText ?? 'Aceptar', cancelText: options.cancelText ?? 'Cancelar',
      isWarning: options.isWarning ?? true, closeOnBackdrop: options.closeOnBackdrop,
      closeOnEscape: options.closeOnEscape, onConfirm: wrapAction(options.onConfirm),
      onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
    });
  };

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const rawUser = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    const user = rawUser ? JSON.parse(rawUser) : null;

    if (!token) { router.replace('/login'); return; }
    if (!user || user.role !== 'ADMIN') { router.replace('/'); return; }
    setAuthChecked(true);
  }, [router]);

  useEffect(() => {
    const loadClub = async () => {
      if (!slug || typeof slug !== 'string') { setLoadingClub(false); return; }
      try {
        setLoadingClub(true);
        const clubData = await ClubAdminService.getClubInfo(slug);
        setClub(clubData);
        setClubForm({
          slug: clubData.slug || '', name: clubData.name || '', address: clubData.address || '',
          contactInfo: clubData.contactInfo || '', phone: clubData.phone || '',
          logoUrl: clubData.logoUrl || '', instagramUrl: clubData.instagramUrl || '',
          facebookUrl: clubData.facebookUrl || '', websiteUrl: clubData.websiteUrl || '', description: clubData.description || ''
        });
      } catch (error: any) {
        showError('Error al cargar información del club: ' + error.message);
        if (error.message.includes('acceso') || error.message.includes('403')) { router.replace('/'); }
      } finally { setLoadingClub(false); }
    };

    if (authChecked && slug) { loadClub(); }
  }, [authChecked, slug, router]);

  useEffect(() => {
    const tab = router.query.tab as string | undefined;
    if (!tab) return;
    if (tab === 'courts' || tab === 'bookings' || tab === 'club' || tab === 'clients' || tab === 'products') {
      setActiveTab(tab as any);
    }
  }, [router.query.tab]);

  const loadCourts = async () => {
    if (!slug || typeof slug !== 'string') return;
    try {
      const data = await ClubAdminService.getCourts(slug);
      setCourts(data);
    } catch (error: any) { showError('Error: ' + error.message); }
  };

  const loadSchedule = async () => {
    if (!slug || typeof slug !== 'string') return;
    try {
      setLoadingSchedule(true);
      const data = await ClubAdminService.getAdminSchedule(slug, scheduleDate);
      let mergedSlots = data;
      try {
        if (courts && courts.length > 0) {
          const timeSlots = typeof CLUB_TIME_SLOTS !== 'undefined' ? CLUB_TIME_SLOTS : [];
          const slotMap = new Map();
          (data || []).forEach((s: any) => {
            const key = `${s.slotTime}::${s.courtId}`;
            slotMap.set(key, s);
          });
          mergedSlots = [];
          for (const time of timeSlots) {
            for (const c of courts) {
              const key = `${time}::${c.id}`;
              if (slotMap.has(key)) {
                mergedSlots.push(slotMap.get(key));
              } else {
                mergedSlots.push({ slotTime: time, courtId: c.id, courtName: c.name, isAvailable: true });
              }
            }
          }
        }
      } catch (err) { mergedSlots = data; }
      setScheduleBookings(mergedSlots);
    } catch (error: any) { showError('Error: ' + error.message); } finally { setLoadingSchedule(false); }
  };

  useEffect(() => { if (authChecked && slug) { loadCourts(); } }, [authChecked, slug]);

  useEffect(() => {
    if (!authChecked || !slug) return;
    if (activeTab === 'bookings') { loadSchedule(); }
  }, [scheduleDate, authChecked, slug, activeTab]);

  const handleUpdateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!club || !slug || typeof slug !== 'string') { showError('No se pudo identificar el club'); return; }
    try {
      const updatedClub = await ClubAdminService.updateClubInfo(slug, clubForm);
      setClub(updatedClub);
      showInfo('✅ Información del club actualizada correctamente', 'Éxito');
    } catch (error: any) { showError('Error al actualizar el club: ' + error.message); }
  };

  const handleCreateCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || typeof slug !== 'string') return;
    try {
      await ClubAdminService.createCourt(slug, newName, newSport);
      showInfo('✅ Cancha creada', 'Listo');
      setNewName('');
      loadCourts();
    } catch (error: any) { showError('Error: ' + error.message); }
  };

  const handleSuspend = async (id: number) => {
    if (!slug || typeof slug !== 'string') return;
    showConfirm({
      title: 'Suspender cancha',
      message: '¿Querés suspender esta cancha?',
      confirmText: 'Suspender',
      onConfirm: async () => {
        try { await ClubAdminService.suspendCourt(slug, id); loadCourts(); } catch (error: any) { showError('Error: ' + error.message); }
      }
    });
  };

  const handleReactivate = async (id: number) => {
    if (!slug || typeof slug !== 'string') return;
    showConfirm({
      title: 'Reactivar cancha',
      message: '¿Querés reactivar esta cancha?',
      confirmText: 'Reactivar',
      isWarning: false,
      onConfirm: async () => {
        try { await ClubAdminService.reactivateCourt(slug, id); loadCourts(); } catch (error: any) { showError('Error: ' + error.message); }
      }
    });
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || typeof slug !== 'string') return;
    if (!manualBooking.courtId || !manualBooking.time) { showError('Faltan datos'); return; }

    const firstName = manualBooking.guestFirstName.trim();
    const lastName = manualBooking.guestLastName.trim();
    if (!firstName || !lastName) { showError('Falta nombre y apellido'); return; }

    try {
      let dateBase: Date;
      let skipNote = '';

      if (manualBooking.isFixed) {
        const base = new Date(manualBooking.startDateBase);
        base.setHours(12, 0, 0, 0);
        const nextDateInfo = getNextDateForDay(base, parseInt(manualBooking.dayOfWeek), manualBooking.time);
        dateBase = nextDateInfo.date;
        skipNote = nextDateInfo.skippedPast ? '⏭️ No se reservó para hoy porque el horario ya pasó.' : '';

        const todayStr = formatLocalDate(new Date());
        const dateStr = formatLocalDate(dateBase);
        if (!nextDateInfo.skippedPast && dateStr === todayStr) {
          try {
            const schedule = await ClubAdminService.getAdminSchedule(slug, dateStr);
            const courtId = Number(manualBooking.courtId);
            const hasConflict = schedule.some((slot: any) =>
              slot.courtId === courtId && slot.slotTime === manualBooking.time && !slot.isAvailable
            );
            if (hasConflict) {
              const nextWeek = new Date(dateBase);
              nextWeek.setDate(nextWeek.getDate() + 7);
              dateBase = nextWeek;
              skipNote = '⏭️ No se reservó para hoy porque ya hay un turno en ese horario.';
            }
          } catch (error) {}
        }
      } else {
        dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
      }

      const dateToSend = dateBase;
      const guestName = `${firstName} ${lastName}`.trim();

      const rawPhone = (manualBooking.guestPhone || '').replace(/\D/g, '');
      const phoneToSend = rawPhone ? `+549${rawPhone}` : '';

      console.log("📞 Teléfono formateado:", phoneToSend); // Para verificar

      if (manualBooking.isFixed) {
          // CASO 1: TURNO FIJO
          await ClubAdminService.createFixedBooking(slug, {
              courtId: Number(manualBooking.courtId),
              activityId: 1,
              startDateTime: dateToSend.toISOString(),
              guestName,
              
              // 👇 AHORA SÍ USAMOS LA VARIABLE CON EL +549
              guestPhone: phoneToSend 
          });

          const msg = `✅ Turno FIJO creado. Arranca: ${dateBase.toLocaleDateString()} a las ${manualBooking.time}. ${skipNote}`;
          showInfo(msg, 'Listo');

      } else {
          // CASO 2: TURNO NORMAL
          const guestIdentifier = `admin_${Date.now()}`;
          // (Ya no hace falta calcular rawPhone/phoneToSend acá porque lo hicimos arriba)

          await createBooking(
              Number(manualBooking.courtId),
              1,
              dateToSend,
              undefined,
              {
                  name: guestName,
                  phone: phoneToSend // Este ya funcionaba bien, ahora usa la variable de arriba
              },
              { asGuest: true, guestIdentifier }
          );
          showInfo('✅ Reserva creada. Cliente actualizado.', 'Listo');
      }

      loadSchedule();
    } catch (error: any) { showError('Error al reservar: ' + error.message); }
  };

  const handleCancelBooking = async (booking: any) => {
    if (!slug || typeof slug !== 'string') return;
    if (booking.fixedBookingId) {
      showConfirm({
        title: '🛑 Atención: Turno Fijo',
        message: (<div><p>Este turno pertenece a una serie repetitiva.</p><p className="font-bold mt-2">¿Deseas eliminar TODA la serie futura?</p></div>),
        confirmText: 'Sí, borrar TODA la serie', cancelText: 'No, ver otras opciones',
        onConfirm: async () => {
          try { await ClubAdminService.cancelFixedBooking(slug, booking.fixedBookingId); showInfo('✅ Serie eliminada.', 'Éxito'); loadSchedule(); } catch (error: any) { showError('Error: ' + error.message); }
        },
        onCancel: () => {
          setTimeout(() => {
            showConfirm({
              title: '¿Borrar solo hoy?',
              message: `¿Eliminar solo el turno de hoy (${booking.slotTime})?`,
              confirmText: 'Sí, borrar solo hoy', cancelText: 'Cancelar',
              onConfirm: async () => {
                try { await ClubAdminService.cancelBooking(slug, booking.id); showInfo('✅ Turno del día eliminado.', 'Listo'); loadSchedule(); } catch (error: any) { showError('Error: ' + error.message); }
              }
            });
          }, 200);
        },
        closeOnBackdrop: false, closeOnEscape: false
      });
    } else {
      showConfirm({
        title: 'Cancelar turno', message: '⚠️ ¿Seguro que deseas cancelar esta reserva simple?',
        confirmText: 'Sí, Cancelar', cancelText: 'Volver',
        onConfirm: async () => {
          try { await ClubAdminService.cancelBooking(slug, booking.id); showInfo('✅ Turno cancelado', 'Listo'); loadSchedule(); } catch (error: any) { showError('Error: ' + error.message); }
        }
      });
    }
  };

  const handleConfirmBooking = async (booking: any) => {
    if (!slug || typeof slug !== 'string') return;
    try { await ClubAdminService.confirmBooking(slug, booking.id); showInfo('✅ Turno confirmado', 'Listo'); loadSchedule(); } catch (error: any) { showError('Error: ' + error.message); }
  };

  if (!authChecked || !slug) return null;
  if (loadingClub) return (<PageShell title="Cargando..." subtitle="Verificando acceso"><div className="animate-pulse text-muted text-center">Cargando información del club...</div></PageShell>);
  if (!club) return (<PageShell title="Error" subtitle="Club no encontrado"><div className="text-center"><p className="text-muted mb-4">No se pudo cargar la información del club</p><button onClick={() => router.push('/')} className="btn btn-primary">Volver al inicio</button></div></PageShell>);

  return (
    <PageShell title={`Panel de ${club.name}`} subtitle="Administración del Club">
      <div className="min-h-[80vh] w-full">
        <div className="w-full">

          {/* PESTAÑA CLIENTES */}
          {activeTab === 'clients' && (
            <ClientsPage />
          )}

          {activeTab === 'products' && slug && (
          <ProductsPage params={{ slug: slug as string }} />
        )}

          {/* --- CONTENIDO DEL CLUB --- */}
          {activeTab === 'club' && (
            <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-4">
              <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><span>⚙️</span> CONFIGURACIÓN DEL CLUB</h2>
              <form onSubmit={handleUpdateClub} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Slug (URL)</label><input type="text" value={clubForm.slug} onChange={(e) => setClubForm({...clubForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" required /><p className="text-xs text-muted mt-1">Usado en la URL: /club/{clubForm.slug}</p></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre del Club</label><input type="text" value={clubForm.name} onChange={(e) => setClubForm({...clubForm, name: e.target.value})} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" required /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Dirección</label><input type="text" value={clubForm.address} onChange={(e) => setClubForm({...clubForm, address: e.target.value})} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" required /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Email</label><input type="email" value={clubForm.contactInfo} onChange={(e) => setClubForm({...clubForm, contactInfo: e.target.value})} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" required /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Teléfono</label><input type="text" value={clubForm.phone} onChange={(e) => setClubForm({...clubForm, phone: e.target.value})} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none" /></div>
                </div>
                <div className="flex justify-end"><button type="submit" className="btn btn-primary px-6 py-2">GUARDAR CAMBIOS</button></div>
              </form>
            </div>
          )}

          {/* --- CONTENIDO DE TURNOS --- */}
          {activeTab === 'bookings' && (
            <div>
              <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-4 transition-all relative overflow-hidden">
                <h2 className="text-lg font-bold text-text flex items-center gap-2">
                  <span>{manualBooking.isFixed ? '🔄' : '📅'}</span>{manualBooking.isFixed ? 'NUEVO TURNO FIJO' : 'NUEVA RESERVA SIMPLE'}
                </h2>

                <form onSubmit={handleCreateBooking} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 items-end mt-4">
                  <div className="grid grid-cols-2 gap-2 col-span-1 sm:col-span-2 lg:col-span-1">
                    <div><label className="block text-xs font-bold text-slate-500 mb-1">NOMBRE</label><input type="text" value={manualBooking.guestFirstName} onChange={(e) => setManualBooking({...manualBooking, guestFirstName: e.target.value})} className="w-full h-10 bg-surface border border-border rounded px-3 py-2 text-text" placeholder="Nombre" required /></div>
                    <div><label className="block text-xs font-bold text-slate-500 mb-1">APELLIDO</label><input type="text" value={manualBooking.guestLastName} onChange={(e) => setManualBooking({...manualBooking, guestLastName: e.target.value})} className="w-full h-10 bg-surface border border-border rounded px-3 py-2 text-text" placeholder="Apellido" required /></div>
                  </div>

                  <div className="col-span-1 sm:col-span-2 lg:col-span-1">
                    <label className="block text-xs font-bold text-slate-500 mb-1">TELÉFONO</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-slate-400 select-none text-sm pointer-events-none">+54 9</span>
                      <input type="text" value={manualBooking.guestPhone} onChange={(e) => setManualBooking({...manualBooking, guestPhone: e.target.value})} className="w-full h-10 bg-surface border border-border rounded px-3 pl-16 py-2 text-text" placeholder="351..." />
                    </div>
                  </div>

                  <div><label className="block text-xs font-bold text-slate-500 mb-1">CANCHA</label><select value={manualBooking.courtId} onChange={(e) => setManualBooking({...manualBooking, courtId: e.target.value})} className="w-full h-10 bg-surface border border-border rounded px-3 py-2 text-text" required><option value="">Seleccionar...</option>{courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>

                  {manualBooking.isFixed ? (
                    <div><label className="block text-xs font-bold text-slate-500 mb-1">DÍA</label><select value={manualBooking.dayOfWeek} onChange={(e) => setManualBooking({...manualBooking, dayOfWeek: e.target.value})} className="w-full h-10 bg-surface border border-border rounded px-3 py-2 text-white font-bold"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select></div>
                  ) : (
                    // 👇 CALENDARIO DATEPICKER (DARK) PARA CREAR TURNO
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">FECHA</label>
                      <DatePicker
                        selected={manualBooking.startDateBase ? (() => { const [y, m, d] = manualBooking.startDateBase.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                        onChange={(date: Date | null) => { if (date) setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(date) }); }}
                        minDate={new Date()}
                        dateFormat="dd/MM/yyyy"
                        locale={es}
                        className="date-picker-custom"
                        calendarClassName="date-picker-calendar"
                        popperPlacement="bottom-start"
                      />
                    </div>
                  )}

                  <div className="w-full"><label className="block text-xs font-bold text-slate-500 mb-1">HORA</label><select value={manualBooking.time} onChange={(e) => setManualBooking({...manualBooking, time: e.target.value})} className="w-full h-10 bg-surface border border-border rounded px-2 py-2 text-text cursor-pointer" required>{CLUB_TIME_SLOTS.map((time) => { const isPast = !manualBooking.isFixed && isPastTimeForDate(manualBooking.startDateBase, time); return (<option key={time} value={time} disabled={isPast}>{time} hs</option>); })}</select></div>

                  <button type="submit" className="btn btn-primary w-full h-10">AGENDAR</button>
                </form>
                <div className="mt-2 text-sm"><label className="flex items-center gap-2 cursor-pointer text-slate-300"><input type="checkbox" checked={manualBooking.isFixed} onChange={(e) => setManualBooking({...manualBooking, isFixed: e.target.checked})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" /><span className={manualBooking.isFixed ? 'font-bold' : ''}>Es Turno Fijo</span></label></div>
              </div>

              {/* GRILLA DE TURNOS */}
              <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-4 relative overflow-hidden">
                <div className="flex items-center justify-between mb-6"><h2 className="text-lg font-bold text-text">GRILLA DE TURNOS</h2></div>
                <div className="flex flex-wrap gap-4 mb-6 items-end">

                  {/* 👇 CALENDARIO DATEPICKER (DARK) PARA FILTRAR */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2">FECHA A VER</label>
                    <DatePicker
                      selected={scheduleDate ? (() => { const [y, m, d] = scheduleDate.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                      onChange={(date: Date | null) => { if (date) { setScheduleDate(formatLocalDate(date)); } }}
                      dateFormat="dd MMM yyyy"
                      locale={es}
                      className="date-picker-custom"
                      calendarClassName="date-picker-calendar"
                      popperPlacement="bottom-start"
                    />
                  </div>

                  <button onClick={loadSchedule} disabled={loadingSchedule} className="btn btn-primary px-6 py-2">{loadingSchedule ? '...' : 'CARGAR'}</button>
                </div>
                {scheduleBookings.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-border/60">
  <table className="w-full text-left">
    <thead>
      <tr className="bg-surface/60 text-muted text-xs uppercase border-b border-border/60">
        <th className="p-3">Hora</th>
        <th className="p-3">Cancha</th>
        <th className="p-3">Estado</th>
        <th className="p-3">Usuario</th>
        <th className="p-3">Contacto</th>
        <th className="p-4 text-right">Acciones</th>
      </tr>
    </thead>
    <tbody className="text-sm font-mono">
      {scheduleBookings.map((slot, i) => (
        <tr key={i} className="border-b border-border/60 hover:bg-surface-70/70">
          <td className="p-3 text-slate-300">{slot.slotTime}</td>
          <td className="p-3 text-white font-bold">{slot.courtName}</td>
          
          {/* 👇 AQUÍ ESTÁ EL CAMBIO PARA LOS TURNOS FIJOS */}
          <td className="p-3">
            {slot.isAvailable ? (
              <span className="badge badge-success">DISPONIBLE</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className={`badge ${slot.booking?.status === 'CONFIRMED' ? 'badge-danger' : 'badge-warning'}`}>
                  {slot.booking?.status === 'CONFIRMED' ? 'CONFIRMADO' : 'PENDIENTE'}
                </span>
                {slot.booking?.fixedBookingId && (
                  <span className="badge badge-info">
                    🔄 FIJO
                  </span>
                )}
              </div>
            )}
          </td>
          {/* 👆 FIN DEL CAMBIO */}

          <td className="p-3 text-slate-300">{slot.isAvailable ? '-' : (slot.booking?.user ? `${slot.booking.user.firstName} ${slot.booking.user.lastName}` : (slot.booking?.guestName || 'Invitado'))}</td>
          <td className="p-3 text-slate-400">{slot.isAvailable ? '-' : (slot.booking?.user?.phoneNumber || slot.booking?.guestPhone || '-')}</td>
          <td className="p-4 text-right">
  {!slot.isAvailable && slot.booking && (
    <div className="flex justify-end gap-2">
      
      {/* 👇 1. AGREGAMOS EL BOTÓN DE VER / CARRITO 👇 */}
      <button 
        onClick={() => setSelectedBookingForDetails(slot.booking)}
        className="text-xs btn bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 flex items-center gap-1 rounded shadow-sm transition-all"
        title="Ver consumos y detalles"
      >
        <span>🛒</span> Ver
      </button>

      {/* 👇 2. TUS BOTONES ORIGINALES (Confirmar y Cancelar) 👇 */}
      {slot.booking.status === 'PENDING' && (
        <button 
           onClick={() => handleConfirmBooking(slot.booking)} 
           className="text-xs btn btn-success px-3 py-1"
        >
           CONFIRMAR
        </button>
      )}
      
      <button 
         onClick={() => handleCancelBooking(slot.booking)} 
         className="text-xs btn btn-danger px-3 py-1"
      >
         CANCELAR
      </button>
    </div>
  )}
</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
                ) : (<div className="text-center py-12 border border-dashed border-border rounded-xl bg-surface-70"><p className="text-muted">Sin datos</p></div>)}
              </div>
            </div>
          )}

          {/* --- CONTENIDO DE CANCHAS --- */}
          {activeTab === 'courts' && (
            <div>
              <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-8 mb-4">
                <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><span>✚</span> NUEVA CANCHA</h2>
                <form onSubmit={handleCreateCourt} className="flex gap-4 items-end"><div className="flex-1"><label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre ID</label><input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text" placeholder="Ej: Cancha Central" /></div><button type="submit" className="btn btn-primary px-6 py-2">CREAR</button></form>
              </div>
              <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-8 overflow-hidden">
                <div className="flex justify-between items-center mb-6"><h2 className="text-lg font-bold text-text">ESTADO DE CANCHAS</h2><span className="px-3 py-1 bg-surface rounded-full text-xs font-mono text-emerald-300 border border-emerald-500/30">{courts.length} ACTIVAS</span></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border text-muted text-xs uppercase">
                        <th className="p-4">ID</th>
                        <th className="p-4">Nombre</th>
                        <th className="p-4">Estado</th>
                        <th className="p-4 text-right">Controles</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm font-medium">
                      {courts.map((c) => (
                        <tr key={c.id} className="border-b border-border/50 hover:bg-surface-70">
                          <td className="p-4 font-mono text-muted">#{c.id}</td>
                          <td className="p-4 text-text font-bold">{c.name}</td>
                          <td className="p-4">
                            {c.isUnderMaintenance ? (
                              <span className="badge badge-danger">● MANTENIMIENTO</span>
                            ) : (
                              <span className="badge badge-success">● OPERATIVO</span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <button onClick={() => c.isUnderMaintenance ? handleReactivate(c.id) : handleSuspend(c.id)} className={`text-xs btn px-3 py-1 ${c.isUnderMaintenance ? 'btn-success' : 'btn-danger'}`}>
                              {c.isUnderMaintenance ? 'REACTIVAR' : 'SUSPENDER'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
      {selectedBookingForDetails && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
           <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl relative">
              {/* Cabecera */}
              <div className="flex justify-between items-center p-6 border-b border-gray-800 bg-gray-900/95 sticky top-0 z-10">
                 <h3 className="text-xl font-bold text-white">📅 Reserva #{selectedBookingForDetails.id}</h3>
                 <button onClick={() => setSelectedBookingForDetails(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              
              <div className="p-6">
                 {/* Componente de Consumos */}
                 {slug && (
                    <BookingConsumption 
                       bookingId={selectedBookingForDetails.id} 
                       slug={slug as string} 
                       courtPrice={selectedBookingForDetails.price || 28000}
                    />
                 )}
              </div>
           </div>
        </div>
      )}
    </PageShell>
  );
}