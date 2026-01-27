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
import { 
    cancelBooking, 
    createBooking,      
    createFixedBooking, 
    cancelFixedBooking  
} from '../../../services/BookingService';
import { ClubService, Club } from '../../../services/ClubService';

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

const isPastSlot = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const slotDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return slotDate.getTime() < Date.now();
};

const getTodayLocalDate = () => formatLocalDate(new Date());

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
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [club, setClub] = useState<Club | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [clubForm, setClubForm] = useState({
    slug: '',
    name: '',
    address: '',
    contactInfo: '',
    phone: '',
    logoUrl: '',
    instagramUrl: '',
    facebookUrl: '',
    websiteUrl: '',
    description: ''
  });

  // Estado para pestañas (se sincroniza con query.tab para permitir cambios por sidebar sin navegación completa)
  const [activeTab, setActiveTab] = useState<'courts' | 'bookings' | 'club'>('courts');

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

  const [manualBooking, setManualBooking] = useState({
    guestFirstName: '',
    guestLastName: '',
    courtId: '',
    time: '19:00',
    isFixed: false,
    dayOfWeek: '1',
    startDateBase: formatLocalDate(new Date())
  });

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
      router.replace('/login');
      return;
    }
    if (!user || user.role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    setAuthChecked(true);
  }, [router]);

  // Cargar información del club desde el slug
  useEffect(() => {
    const loadClub = async () => {
      if (!slug || typeof slug !== 'string') {
        setLoadingClub(false);
        return;
      }

      try {
        setLoadingClub(true);
        const clubData = await ClubAdminService.getClubInfo(slug);
        setClub(clubData);
        setClubForm({
          slug: clubData.slug || '',
          name: clubData.name || '',
          address: clubData.address || '',
          contactInfo: clubData.contactInfo || '',
          phone: clubData.phone || '',
          logoUrl: clubData.logoUrl || '',
          instagramUrl: clubData.instagramUrl || '',
          facebookUrl: clubData.facebookUrl || '',
          websiteUrl: clubData.websiteUrl || '',
          description: clubData.description || ''
        });
      } catch (error: any) {
        showError('Error al cargar información del club: ' + error.message);
        // Si no tiene acceso, redirigir
        if (error.message.includes('acceso') || error.message.includes('403')) {
          router.replace('/');
        }
      } finally {
        setLoadingClub(false);
      }
    };

    if (authChecked && slug) {
      loadClub();
    }
  }, [authChecked, slug, router]);

  // Sincronizar activeTab con query.tab (permite que el sidebar haga shallow pushes)
  useEffect(() => {
    const tab = router.query.tab as string | undefined;
    if (!tab) return;
    if (tab === 'courts' || tab === 'bookings' || tab === 'club') {
      setActiveTab(tab);
    }
  }, [router.query.tab]);

  const loadCourts = async () => {
    if (!slug || typeof slug !== 'string') return;
    try {
      const data = await ClubAdminService.getCourts(slug);
      setCourts(data);
      // DEBUG: Mostrar canchas recibidas del endpoint admin/courts
      console.debug('ClubAdminService.getCourts ->', data?.length ?? 0, 'items', data);
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  const loadSchedule = async () => {
    if (!slug || typeof slug !== 'string') return;
    try {
      setLoadingSchedule(true);
      const data = await ClubAdminService.getAdminSchedule(slug, scheduleDate);
      // Si ya tenemos la lista de canchas, asegurarnos de que el schedule incluya
      // filas (slots) para TODAS las canchas en cada horario, incluso si están libres.
      let mergedSlots = data;
      try {
        if (courts && courts.length > 0) {
          // Usar los horarios válidos del archivo (si existe CLUB_TIME_SLOTS arriba)
          const timeSlots = typeof CLUB_TIME_SLOTS !== 'undefined' ? CLUB_TIME_SLOTS : [];

          // Construir mapa por (time, courtId)
          const slotMap = new Map();
          (data || []).forEach((s: any) => {
            const key = `${s.slotTime}::${s.courtId}`;
            slotMap.set(key, s);
          });

          // Generar lista completa
          mergedSlots = [];
          for (const time of timeSlots) {
            for (const c of courts) {
              const key = `${time}::${c.id}`;
              if (slotMap.has(key)) {
                mergedSlots.push(slotMap.get(key));
              } else {
                mergedSlots.push({
                  slotTime: time,
                  courtId: c.id,
                  courtName: c.name,
                  isAvailable: true
                });
              }
            }
          }
        }
      } catch (err) {
        // Si algo falla, caemos a usar el data original
        console.warn('Error merging schedule with courts:', err);
        mergedSlots = data;
      }

      setScheduleBookings(mergedSlots);
      setLastUpdate(new Date());
      // DEBUG: Mostrar schedule (merge) recibido para comparar con canchas
      console.debug('ClubAdminService.getAdminSchedule (merged) ->', mergedSlots?.length ?? 0, 'slots', mergedSlots);
    } catch (error: any) {
      showError('Error: ' + error.message);
    } finally {
      setLoadingSchedule(false);
    }
  };

  useEffect(() => {
    if (authChecked && slug) {
      loadCourts();
    }
  }, [authChecked, slug]);

  useEffect(() => {
    if (!authChecked || !slug) {
      return;
    }
    loadSchedule();
  }, [scheduleDate, authChecked, slug]);

  const handleUpdateClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!club || !slug || typeof slug !== 'string') {
      showError('No se pudo identificar el club');
      return;
    }

    try {
      const updatedClub = await ClubAdminService.updateClubInfo(slug, clubForm);
      setClub(updatedClub);
      showInfo('✅ Información del club actualizada correctamente', 'Éxito');
    } catch (error: any) {
      showError('Error al actualizar el club: ' + error.message);
    }
  };

  const handleCreateCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || typeof slug !== 'string') return;
    try {
      await ClubAdminService.createCourt(slug, newName, newSport);
      showInfo('✅ Cancha creada', 'Listo');
      setNewName('');
      loadCourts();
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  const handleSuspend = async (id: number) => {
    if (!slug || typeof slug !== 'string') return;
    showConfirm({
      title: 'Suspender cancha',
      message: '¿Querés suspender esta cancha?',
      confirmText: 'Suspender',
      onConfirm: async () => {
        try {
          await ClubAdminService.suspendCourt(slug, id);
          loadCourts();
        } catch (error: any) {
          showError('Error: ' + error.message);
        }
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
        try {
          await ClubAdminService.reactivateCourt(slug, id);
          loadCourts();
        } catch (error: any) {
          showError('Error: ' + error.message);
        }
      }
    });
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || typeof slug !== 'string') return;
    if (!manualBooking.courtId || !manualBooking.time) {
      showError('Faltan datos');
      return;
    }
    const firstName = manualBooking.guestFirstName.trim();
    const lastName = manualBooking.guestLastName.trim();
    if (!firstName || !lastName) {
      showError('Falta nombre y apellido');
      return;
    }

    try {
      let dateBase: Date;
      let skipNote = '';

      if (manualBooking.isFixed) {
        const base = new Date(manualBooking.startDateBase);
        base.setHours(12, 0, 0, 0);
        const nextDateInfo = getNextDateForDay(
          base,
          parseInt(manualBooking.dayOfWeek),
          manualBooking.time
        );
        dateBase = nextDateInfo.date;
        skipNote = nextDateInfo.skippedPast
          ? '⏭️ No se reservó para hoy porque el horario ya pasó.'
          : '';

        const todayStr = formatLocalDate(new Date());
        const dateStr = formatLocalDate(dateBase);
        if (!nextDateInfo.skippedPast && dateStr === todayStr) {
          try {
            const schedule = await ClubAdminService.getAdminSchedule(slug, dateStr);
            const courtId = Number(manualBooking.courtId);
            const hasConflict = schedule.some((slot: any) =>
              slot.courtId === courtId &&
              slot.slotTime === manualBooking.time &&
              !slot.isAvailable
            );
            if (hasConflict) {
              const nextWeek = new Date(dateBase);
              nextWeek.setDate(nextWeek.getDate() + 7);
              dateBase = nextWeek;
              skipNote = '⏭️ No se reservó para hoy porque ya hay un turno en ese horario.';
            }
          } catch (error) {
            // Si falla el chequeo, seguimos sin bloquear
          }
        }
      } else {
        dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
      }

      const dateToSend = dateBase;

      if (manualBooking.isFixed) {
        const guestName = `${manualBooking.guestFirstName.trim()} ${manualBooking.guestLastName.trim()}`.trim();
        await ClubAdminService.createFixedBooking(slug, {
          courtId: Number(manualBooking.courtId),
          activityId: 1,
          startDateTime: dateToSend.toISOString(),
          guestName
        });
        const startLabel = dateBase.toLocaleDateString();
        const baseMessage = `✅ Turno FIJO creado. Arranca el: ${startLabel} a las ${manualBooking.time}`;
        const message = skipNote ? (
          <div>
            <p className="mb-2">{skipNote}</p>
            <p>{baseMessage}</p>
          </div>
        ) : baseMessage;
        showInfo(message, 'Listo');
      } else {
        const guestName = `${manualBooking.guestFirstName.trim()} ${manualBooking.guestLastName.trim()}`.trim();
        const guestIdentifier = `admin_${Date.now()}`;
        await createBooking(
          Number(manualBooking.courtId),
          1,
          dateToSend,
          undefined,
          { name: guestName },
          { asGuest: true, guestIdentifier }
        );
        showInfo('✅ Reserva simple creada', 'Listo');
      }

      loadSchedule();
    } catch (error: any) {
      showError('Error al reservar: ' + error.message);
    }
  };

  const handleCancelBooking = async (booking: any) => {
    if (!slug || typeof slug !== 'string') return;
    
    if (booking.fixedBookingId) {
      showConfirm({
        title: '🛑 Atención: Turno Fijo',
        message: (
          <div>
            <p>Este turno pertenece a una serie repetitiva.</p>
            <p className="font-bold mt-2">¿Deseas eliminar TODA la serie futura?</p>
          </div>
        ),
        confirmText: 'Sí, borrar TODA la serie',
        cancelText: 'No, ver otras opciones',
        onConfirm: async () => {
          try {
            await ClubAdminService.cancelFixedBooking(slug, booking.fixedBookingId);
            showInfo('✅ Serie completa eliminada.', 'Éxito');
            loadSchedule();
          } catch (error: any) {
            showError('Error: ' + error.message);
          }
        },
        onCancel: () => {
          setTimeout(() => {
            showConfirm({
              title: '¿Borrar solo hoy?',
              message: `¿Entonces deseas eliminar únicamente el turno de hoy (${booking.slotTime}) y mantener los futuros?`,
              confirmText: 'Sí, borrar solo hoy',
              cancelText: 'Cancelar (No tocar nada)',
              onConfirm: async () => {
                try {
                  await ClubAdminService.cancelBooking(slug, booking.id);
                  showInfo('✅ Turno del día eliminado.', 'Listo');
                  loadSchedule();
                } catch (error: any) {
                  showError('Error: ' + error.message);
                }
              },
              onCancel: () => {}
            });
          }, 200);
        },
        closeOnBackdrop: false,
        closeOnEscape: false
      });
    } else {
      showConfirm({
        title: 'Cancelar turno',
        message: '⚠️ ¿Seguro que deseas cancelar esta reserva simple?',
        confirmText: 'Sí, Cancelar',
        cancelText: 'Volver',
        onConfirm: async () => {
          try {
            await ClubAdminService.cancelBooking(slug, booking.id);
            showInfo('✅ Turno cancelado', 'Listo');
            loadSchedule();
          } catch (error: any) {
            showError('Error: ' + error.message);
          }
        }
      });
    }
  };

  const handleConfirmBooking = async (booking: any) => {
    if (!slug || typeof slug !== 'string') return;
    try {
      await ClubAdminService.confirmBooking(slug, booking.id);
      showInfo('✅ Turno confirmado', 'Listo');
      loadSchedule();
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  if (!authChecked || !slug) {
    return null;
  }

  if (loadingClub) {
    return (
      <PageShell title="Cargando..." subtitle="Verificando acceso">
        <div className="animate-pulse text-muted text-center">Cargando información del club...</div>
      </PageShell>
    );
  }

  if (!club) {
    return (
      <PageShell title="Error" subtitle="Club no encontrado">
        <div className="text-center">
          <p className="text-muted mb-4">No se pudo cargar la información del club</p>
          <button onClick={() => router.push('/')} className="btn btn-primary">
            Volver al inicio
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={`Panel de ${club.name}`} subtitle="Administración del Club">
      <div className="min-h-[80vh] w-full">
        {/* Eliminé el panel central "Panel Admin" para usar el sidebar fijo a la izquierda. */}
        <div className="w-full">
        {/* --- CONTENIDO DEL CLUB --- */}
        {activeTab === 'club' && (
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-4">
          <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
            <span>⚙️</span> CONFIGURACIÓN DEL CLUB
          </h2>
          
          <form onSubmit={handleUpdateClub} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Slug (URL)</label>
                <input
                  type="text"
                  value={clubForm.slug}
                  onChange={(e) => setClubForm({...clubForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  placeholder="las-tejas"
                  required
                />
                <p className="text-xs text-muted mt-1">Usado en la URL: /club/{clubForm.slug || 'slug'}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre del Club</label>
                <input
                  type="text"
                  value={clubForm.name}
                  onChange={(e) => setClubForm({...clubForm, name: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Dirección</label>
                <input
                  type="text"
                  value={clubForm.address}
                  onChange={(e) => setClubForm({...clubForm, address: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Email de Contacto</label>
                <input
                  type="email"
                  value={clubForm.contactInfo}
                  onChange={(e) => setClubForm({...clubForm, contactInfo: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Teléfono</label>
                <input
                  type="text"
                  value={clubForm.phone}
                  onChange={(e) => setClubForm({...clubForm, phone: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  placeholder="+54 9 357 135 9791"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">URL del Logo</label>
                <input
                  type="url"
                  value={clubForm.logoUrl}
                  onChange={(e) => setClubForm({...clubForm, logoUrl: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  placeholder="https://ejemplo.com/logo.png"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Instagram</label>
                <input
                  type="url"
                  value={clubForm.instagramUrl}
                  onChange={(e) => setClubForm({...clubForm, instagramUrl: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  placeholder="https://instagram.com/club"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Facebook</label>
                <input
                  type="url"
                  value={clubForm.facebookUrl}
                  onChange={(e) => setClubForm({...clubForm, facebookUrl: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  placeholder="https://facebook.com/club"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Sitio Web</label>
                <input
                  type="url"
                  value={clubForm.websiteUrl}
                  onChange={(e) => setClubForm({...clubForm, websiteUrl: e.target.value})}
                  className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                  placeholder="https://club.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Descripción</label>
              <textarea
                value={clubForm.description}
                onChange={(e) => setClubForm({...clubForm, description: e.target.value})}
                className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none focus:border-emerald-500/50"
                rows={3}
                placeholder="Descripción del club..."
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="btn btn-primary px-6 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 hover:border-emerald-400/70 text-emerald-200 shadow-[0_0_18px_rgba(16,185,129,0.15)] transition"
              >
                GUARDAR CAMBIOS
              </button>
            </div>
          </form>
        </div>
        )}

        {/* --- CONTENIDO DE TURNOS --- */}
        {activeTab === 'bookings' && (
        <div>

        {/* --- FORMULARIO DE RESERVA MANUAL --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-4 transition-all relative overflow-hidden">
          <h2 className="text-lg font-bold text-text flex items-center gap-2">
            <span>{manualBooking.isFixed ? '🔄' : '📅'}</span>
            {manualBooking.isFixed ? 'NUEVO TURNO FIJO' : 'NUEVA RESERVA SIMPLE'}
            <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border border-border text-muted bg-surface">
              {manualBooking.isFixed ? 'SERIE' : 'SIMPLE'}
            </span>
          </h2>

          <form onSubmit={handleCreateBooking} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(200px,220px)_minmax(110px,130px)_minmax(0,1fr)] gap-x-6 gap-y-4 items-end">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">NOMBRE</label>
                <input
                  type="text"
                  value={manualBooking.guestFirstName}
                  onChange={(e) => setManualBooking({...manualBooking, guestFirstName: e.target.value})}
                  className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-text"
                  placeholder="Nombre"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">APELLIDO</label>
                <input
                  type="text"
                  value={manualBooking.guestLastName}
                  onChange={(e) => setManualBooking({...manualBooking, guestLastName: e.target.value})}
                  className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-text"
                  placeholder="Apellido"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">CANCHA</label>
              <select
                value={manualBooking.courtId}
                onChange={(e) => setManualBooking({...manualBooking, courtId: e.target.value})}
                className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-text"
                required
              >
                <option value="">Seleccionar...</option>
                {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {manualBooking.isFixed ? (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2">DÍA A REPETIR</label>
                <select
                  value={manualBooking.dayOfWeek}
                  onChange={(e) => setManualBooking({...manualBooking, dayOfWeek: e.target.value})}
                  className="w-full h-10 bg-surface border border-border rounded-lg px-3 py-2 text-white font-bold"
                >
                  <option value="1">Lunes</option>
                  <option value="2">Martes</option>
                  <option value="3">Miércoles</option>
                  <option value="4">Jueves</option>
                  <option value="5">Viernes</option>
                  <option value="6">Sábado</option>
                  <option value="0">Domingo</option>
                </select>
              </div>
            ) : (
              <div className="w-full">
                <label className="block text-xs font-bold text-slate-500 mb-2">FECHA DEL TURNO</label>
                <DatePicker
                  selected={manualBooking.startDateBase ? (() => {
                    const [year, month, day] = manualBooking.startDateBase.split('-').map(Number);
                    return new Date(year, month - 1, day);
                  })() : new Date()}
                  onChange={(date: Date | null) => {
                    if (!date) {
                      setManualBooking({ ...manualBooking, startDateBase: '' });
                      return;
                    }

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const selectedDateObj = new Date(date);
                    selectedDateObj.setHours(0, 0, 0, 0);

                    if (selectedDateObj < today) {
                      alert('No puedes seleccionar una fecha pasada. Por favor, elige una fecha de hoy en adelante.');
                      return;
                    }

                    setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(selectedDateObj) });
                  }}
                  minDate={new Date()}
                  dateFormat="dd MMM yyyy"
                  locale={es}
                  portalId="datepicker-portal"
                  popperPlacement="bottom-start"
                  className="date-picker-custom w-full h-10"
                  wrapperClassName="w-full"
                  calendarClassName="date-picker-calendar"
                  popperClassName="date-picker-popper"
                  placeholderText="Selecciona una fecha"
                  showPopperArrow={false}
                  required
                />
              </div>
            )}

            <div className="w-full">
              <label className="block text-xs font-bold text-slate-500 mb-2">HORA</label>
              <select
                value={manualBooking.time}
                onChange={(e) => setManualBooking({...manualBooking, time: e.target.value})}
                className="w-full h-10 bg-surface border border-border rounded-lg px-2 py-2 text-white cursor-pointer focus:outline-none focus:border-primary-500 appearance-none"
                required
              >
                {CLUB_TIME_SLOTS.map((time) => {
                  const isPast = !manualBooking.isFixed && isPastTimeForDate(manualBooking.startDateBase, time);
                  return (
                    <option
                      key={time}
                      value={time}
                      className="bg-slate-800 text-white py-2"
                      disabled={isPast}
                    >
                      {time} hs
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-slate-300">
                <input
                  type="checkbox"
                  checked={manualBooking.isFixed}
                  onChange={(e) => setManualBooking({...manualBooking, isFixed: e.target.checked})}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className={manualBooking.isFixed ? 'font-bold' : ''}>Es Fijo</span>
              </label>

              <button
                type="submit"
                className="btn btn-primary w-full py-2 bg-white/5 hover:bg-white/10 border-white/30 hover:border-white/60 text-text shadow-[0_0_16px_rgba(255,255,255,0.08)]"
              >
                AGENDAR
              </button>
            </div>
          </form>

          <p className="text-xs text-slate-500 mt-3 border-t border-slate-700/50 pt-2">
            {manualBooking.isFixed
              ? `ℹ️ Se crearán reservas todos los ${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][parseInt(manualBooking.dayOfWeek)]} a las ${manualBooking.time} por 6 meses.`
              : `ℹ️ Se reservará para el día seleccionado en este filtro (${manualBooking.startDateBase}).`
            }
          </p>
        </div>

        {/* --- GRILLA DE TURNOS --- */}
            <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-text">GRILLA DE TURNOS</h2>
          </div>

          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-2">FECHA A VER</label>
              <DatePicker
                selected={scheduleDate ? (() => {
                  const [year, month, day] = scheduleDate.split('-').map(Number);
                  return new Date(year, month - 1, day);
                })() : new Date()}
                onChange={(date: Date | null) => {
                  if (date) {
                    setScheduleDate(formatLocalDate(date));
                  }
                }}
                dateFormat="dd MMM yyyy"
                locale={es}
                portalId="datepicker-portal"
                className="date-picker-custom"
                wrapperClassName="w-full"
                calendarClassName="date-picker-calendar"
                popperClassName="date-picker-popper"
                placeholderText="Selecciona una fecha"
                showPopperArrow={false}
              />
            </div>
            <button
              onClick={loadSchedule}
              disabled={loadingSchedule}
              className="btn btn-primary relative min-w-[150px] px-6 py-2 bg-white/5 hover:bg-white/10 border-white/30 hover:border-white/60 shadow-[0_0_18px_rgba(255,255,255,0.08)] transition"
            >
              <span className={loadingSchedule ? 'opacity-0' : 'opacity-100'}>CARGAR DATOS</span>
              {loadingSchedule && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/80"></span>
                </span>
              )}
            </button>
          </div>

          {lastUpdate && <p className="text-xs text-slate-500 font-mono mb-4 text-right">Última actualización: {lastUpdate.toLocaleTimeString()}</p>}

          {scheduleBookings.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface/60 text-muted text-xs uppercase tracking-wider border-b border-border/60">
                    <th className="p-3">Hora</th>
                    <th className="p-3">Cancha</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Usuario</th>
                    <th className="p-3">Contacto</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-mono">
                  {scheduleBookings.map((slot, i) => (
                    <tr key={i} className="border-b border-border/60 hover:bg-surface-70/70 transition-colors">
                      <td className="p-3 text-slate-300">{slot.slotTime}</td>
                      <td className="p-3 text-white font-bold">{slot.courtName}</td>
                      <td className="p-3">
                        {slot.isAvailable ? (
                          isPastSlot(scheduleDate, slot.slotTime) ? (
                            <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-slate-500/30 text-slate-300 bg-slate-500/10">
                              <span className="h-2 w-2 rounded-full bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,0.6)]"></span>
                              NO JUGADO
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                              DISPONIBLE
                            </span>
                          )
                        ) : slot.booking?.status === 'CONFIRMED' ? (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-red-500/30 text-red-300 bg-red-500/10">
                            <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
                            CONFIRMADO
                          </span>
                        ) : slot.booking?.status === 'COMPLETED' ? (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-blue-500/30 text-blue-200 bg-blue-500/10">
                            <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span>
                            COMPLETADO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-yellow-500/30 text-yellow-200 bg-yellow-500/10">
                            <span className="h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"></span>
                            PENDIENTE
                          </span>
                        )}

                        {slot.booking?.fixedBookingId && (
                          <span className="ml-2 text-xs bg-blue-900/60 text-blue-200 px-2 py-0.5 rounded-full border border-blue-500/40" title="Turno Fijo">
                            🔄 FIJO
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-300">
                        {slot.isAvailable
                          ? '-'
                          : slot.booking?.user
                            ? `${slot.booking.user.firstName} ${slot.booking.user.lastName}`
                            : (slot.booking?.guestName || 'Invitado')}
                      </td>
                      <td className="p-3 text-slate-400">
                        {slot.isAvailable
                          ? '-'
                          : (slot.booking?.user?.phoneNumber ||
                            slot.booking?.guestPhone ||
                            slot.booking?.guestEmail ||
                            '-')}
                      </td>

                      <td className="p-3 text-right">
                        {!slot.isAvailable && slot.booking && (
                          <div className="flex items-center justify-end gap-2 flex-nowrap whitespace-nowrap">
                            {slot.booking.status === 'PENDING' && (
                              <button
                                onClick={() => handleConfirmBooking(slot.booking)}
                                className="text-xs btn h-7 px-2.5 py-0 bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/70 leading-none whitespace-nowrap"
                                title="Confirmar turno"
                              >
                                ✓ CONFIRMAR
                              </button>
                            )}
                            <button
                              onClick={() => handleCancelBooking(slot.booking)}
                              className={`text-xs btn h-7 px-2.5 py-0 bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20 hover:border-red-400/70 leading-none whitespace-nowrap ${slot.booking.fixedBookingId ? 'shadow-[0_0_10px_rgba(239,68,68,0.25)]' : ''}`}
                              title={slot.booking.fixedBookingId ? "Cancelar Turno Fijo" : "Cancelar"}
                            >
                              ✕ {slot.booking.fixedBookingId ? 'BAJA' : 'CANCELAR'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 border border-dashed border-border rounded-xl bg-surface-70">
              <p className="text-muted">Sin datos cargados para esta fecha</p>
            </div>
          )}
        </div>

        </div>
        )}

        {/* --- CONTENIDO DE CANCHAS --- */}
        {activeTab === 'courts' && (
        <div>

        {/* --- FORMULARIO DE CREACIÓN CANCHA --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mt-8 mb-4">
          <h2 className="text-lg font-bold text-text mb-4 flex items-center gap-2">
            <span>✚</span> NUEVA CANCHA
          </h2>
          <form onSubmit={handleCreateCourt} className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Nombre ID</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none"
                placeholder="Ej: Cancha Central"
              />
            </div>
            <div className="w-full sm:w-48">
              <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Tipo</label>
              <select
                value={newSport}
                onChange={(e) => setNewSport(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-2 text-text focus:outline-none"
              >
                <option value="Sintético">🎾 Sintético</option>
                <option value="Césped">🏓 Césped</option>
                <option value="Polvo de ladrillo">⚽ Polvo de ladrillo</option>
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

        {/* --- LISTADO DE CANCHAS --- */}
        <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-6 mb-8 overflow-hidden">
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
                  <th className="p-4 text-right">Controles</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium">
                {courts.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-surface-70 transition-colors group">
                    <td className="p-4 font-mono text-muted">#{c.id.toString().padStart(3, '0')}</td>
                    <td className="p-4 text-text font-bold">{c.name}</td>
                    <td className="p-4">
                      <span className="px-2 py-1 rounded text-xs text-muted border border-border">{c.surface || '-'}</span>
                    </td>
                    <td className="p-4">
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
                    <td className="p-4 text-right">
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

        </div>
        )}

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
    </PageShell>
  );
}
