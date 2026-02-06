import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import DatePicker from 'react-datepicker';
import { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale/es';
import 'react-datepicker/dist/react-datepicker.css';
import { getCourts } from '../../services/CourtService';
import {
  getAdminSchedule,
  cancelBooking,
  confirmBooking as confirmBookingService,
  createBooking,
  createFixedBooking,
  cancelFixedBooking
} from '../../services/BookingService';
import AppModal from '../AppModal';

registerLocale('es', es);

const CLUB_TIME_SLOTS = [
  '08:00', '09:30', '11:00', '12:30',
  '14:00', '15:30', '17:30', '19:00',
  '20:30', '22:00'
];

const getNextDateForDay = (startDate: Date, targetDayIndex: number, timeStr: string) => {
  const resultDate = new Date(startDate);
  const currentDay = resultDate.getDay();
  let daysUntilTarget = targetDayIndex - currentDay;
  if (daysUntilTarget < 0) daysUntilTarget += 7;
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

const getTodayLocalDate = () => {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
};

const isPastTimeForDate = (dateStr: string, timeStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return false;
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  const slotDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return slotDate.getTime() < Date.now();
};

export default function AdminTabBookings() {
  const [courts, setCourts] = useState<any[]>([]);
  const [scheduleDate, setScheduleDate] = useState(() => getTodayLocalDate());
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [manualBooking, setManualBooking] = useState({
    guestFirstName: '', guestLastName: '', guestPhone: '', courtId: '', time: '19:00',
    isFixed: false, dayOfWeek: '1', startDateBase: getTodayLocalDate()
  });
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  const wrapAction = (action?: () => Promise<void> | void) => async () => { closeModal(); await action?.(); };
  const showConfirm = (options: {
    title: string; message: ReactNode; confirmText?: string; cancelText?: string; isWarning?: boolean;
    onConfirm: () => Promise<void> | void; onCancel?: () => Promise<void> | void; closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }) => setModalState({
    show: true, title: options.title, message: options.message,
    confirmText: options.confirmText ?? 'Aceptar', cancelText: options.cancelText ?? 'Cancelar',
    isWarning: options.isWarning ?? true, closeOnBackdrop: options.closeOnBackdrop, closeOnEscape: options.closeOnEscape,
    onConfirm: wrapAction(options.onConfirm), onCancel: options.onCancel ? wrapAction(options.onCancel) : undefined
  });

  const loadCourts = async () => { const data = await getCourts(); setCourts(data); };

  const loadSchedule = async () => {
    try {
      setLoadingSchedule(true);
      const data = await getAdminSchedule(scheduleDate);
      let mergedSlots = data;
      try {
        if (courts && courts.length > 0) {
          const slotMap = new Map();
          (data || []).forEach((s: any) => slotMap.set(`${s.slotTime}::${s.courtId}`, s));
          mergedSlots = [];
          for (const time of CLUB_TIME_SLOTS) {
            for (const c of courts) {
              const key = `${time}::${c.id}`;
              mergedSlots.push(slotMap.get(key) || { slotTime: time, courtId: c.id, courtName: c.name, isAvailable: true });
            }
          }
        }
      } catch (err) {
        console.warn('Error merging schedule with courts:', err);
      }
      setScheduleBookings(mergedSlots);
      setLastUpdate(new Date());
    } catch (error: any) {
      showError('Error: ' + error.message);
    } finally {
      setLoadingSchedule(false);
    }
  };

  useEffect(() => { loadCourts(); }, []);
  useEffect(() => { loadSchedule(); }, [scheduleDate, courts]);

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBooking.courtId || !manualBooking.time) { showError('Faltan datos'); return; }
    const firstName = manualBooking.guestFirstName.trim();
    const lastName = manualBooking.guestLastName.trim();
    if (!firstName || !lastName) { showError('Falta nombre y apellido'); return; }
    try {
      const rawPhone = (manualBooking.guestPhone || '').replace(/\D/g, '');
      const phoneToSend = rawPhone ? `+549${rawPhone}` : '';
      const guestName = `${firstName} ${lastName}`.trim();
      let dateBase: Date;
      let skipNote = '';
      if (manualBooking.isFixed) {
        const base = new Date(manualBooking.startDateBase);
        base.setHours(12, 0, 0, 0);
        const nextDateInfo = getNextDateForDay(base, parseInt(manualBooking.dayOfWeek), manualBooking.time);
        dateBase = nextDateInfo.date;
        skipNote = nextDateInfo.skippedPast ? '⏭️ No se reservó para hoy porque el horario ya pasó.' : '';
        const dateStr = formatLocalDate(dateBase);
        if (!nextDateInfo.skippedPast && dateStr === formatLocalDate(new Date())) {
          try {
            const schedule = await getAdminSchedule(dateStr);
            const courtId = Number(manualBooking.courtId);
            const hasConflict = Array.isArray(schedule) && schedule.some((slot: any) =>
              slot.courtId === courtId && slot.slotTime === manualBooking.time && !slot.isAvailable);
            if (hasConflict) {
              const nextWeek = new Date(dateBase);
              nextWeek.setDate(nextWeek.getDate() + 7);
              dateBase = nextWeek;
              skipNote = '⏭️ No se reservó para hoy porque ya hay un turno en ese horario.';
            }
          } catch { /* ignore */ }
        }
      } else {
        dateBase = new Date(`${manualBooking.startDateBase}T${manualBooking.time}:00`);
      }
      if (manualBooking.isFixed) {
        await createFixedBooking(undefined, Number(manualBooking.courtId), 1, dateBase, guestName, phoneToSend || undefined);
        const message = skipNote ? <div><p className="mb-2">{skipNote}</p><p>✅ Turno FIJO creado. Arranca el: {dateBase.toLocaleDateString()} a las {manualBooking.time}</p></div> : `✅ Turno FIJO creado. Arranca el: ${dateBase.toLocaleDateString()} a las ${manualBooking.time}`;
        showInfo(message, 'Listo');
      } else {
        await createBooking(Number(manualBooking.courtId), 1, dateBase, undefined, { name: guestName, phone: phoneToSend }, { asGuest: true, guestIdentifier: `admin_${Date.now()}` });
        showInfo('✅ Reserva simple creada', 'Listo');
      }
      loadSchedule();
      setManualBooking({ guestFirstName: '', guestLastName: '', guestPhone: '', courtId: '', time: '19:00', isFixed: false, dayOfWeek: '1', startDateBase: getTodayLocalDate() });
    } catch (error: any) {
      showError('Error al reservar: ' + error.message);
    }
  };

  const handleCancelBooking = async (booking: any) => {
    if (booking.fixedBookingId) {
      showConfirm({
        title: '🛑 Atención: Turno Fijo',
        message: <div><p>Este turno pertenece a una serie repetitiva.</p><p className="font-bold mt-2">¿Deseas eliminar TODA la serie futura?</p></div>,
        confirmText: 'Sí, borrar TODA la serie', cancelText: 'No, ver otras opciones',
        onConfirm: async () => { try { await cancelFixedBooking(booking.fixedBookingId); showInfo('✅ Serie completa eliminada.', 'Éxito'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
        onCancel: () => setTimeout(() => showConfirm({
          title: '¿Borrar solo hoy?',
          message: `¿Eliminar únicamente el turno de hoy (${booking.slotTime}) y mantener los futuros?`,
          confirmText: 'Sí, borrar solo hoy', cancelText: 'Cancelar',
          onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('✅ Turno del día eliminado.', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } },
          onCancel: () => {}
        }), 200),
        closeOnBackdrop: false, closeOnEscape: false
      });
    } else {
      showConfirm({
        title: 'Cancelar turno', message: '⚠️ ¿Seguro que deseas cancelar esta reserva simple?',
        confirmText: 'Sí, Cancelar', cancelText: 'Volver',
        onConfirm: async () => { try { await cancelBooking(booking.id); showInfo('✅ Turno cancelado', 'Listo'); loadSchedule(); } catch (e: any) { showError('Error: ' + e.message); } }
      });
    }
  };

  const handleConfirmBooking = async (booking: any) => {
    try {
      await confirmBookingService(booking.id);
      showInfo('✅ Turno confirmado', 'Listo');
      loadSchedule();
    } catch (error: any) {
      showError('Error: ' + error.message);
    }
  };

  return (
    <>
      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-6 transition-all relative z-20">
        <h2 className="text-lg font-bold text-text flex items-center gap-2">
          <span>{manualBooking.isFixed ? '🔄' : '📅'}</span>
          {manualBooking.isFixed ? 'NUEVO TURNO FIJO' : 'NUEVA RESERVA SIMPLE'}
          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full border border-border text-muted bg-surface">{manualBooking.isFixed ? 'SERIE' : 'SIMPLE'}</span>
        </h2>
        <form onSubmit={handleCreateBooking} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Nombre</label>
            <input type="text" value={manualBooking.guestFirstName} onChange={(e) => setManualBooking({ ...manualBooking, guestFirstName: e.target.value })} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" placeholder="Ingresa el nombre" required />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Apellido</label>
            <input type="text" value={manualBooking.guestLastName} onChange={(e) => setManualBooking({ ...manualBooking, guestLastName: e.target.value })} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" placeholder="Ingresa el apellido" required />
          </div>
          <div className="relative z-10">
            <label className="block text-sm font-semibold text-slate-300 mb-2">Fecha</label>
            {manualBooking.isFixed ? (
              <div className="h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base flex items-center"><span className="text-gray-400">Selecciona día de la semana abajo</span></div>
            ) : (
              <DatePicker
                selected={manualBooking.startDateBase ? (() => { const [y, m, d] = manualBooking.startDateBase.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                onChange={(date: Date | null) => {
                  if (!date) { setManualBooking({ ...manualBooking, startDateBase: '' }); return; }
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const sel = new Date(date); sel.setHours(0, 0, 0, 0);
                  if (sel < today) { alert('No puedes seleccionar una fecha pasada.'); return; }
                  setManualBooking({ ...manualBooking, startDateBase: formatLocalDate(sel) });
                }}
                dateFormat="yyyy-MM-dd" minDate={new Date()} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" placeholderText="Selecciona fecha" required
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Hora</label>
            <select value={manualBooking.time} onChange={(e) => setManualBooking({ ...manualBooking, time: e.target.value })} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
              <option value="" className="bg-gray-800">Selecciona hora</option>
              {CLUB_TIME_SLOTS.map(slot => (
                <option key={slot} value={slot} className="bg-gray-800" disabled={!!(manualBooking.startDateBase && isPastTimeForDate(manualBooking.startDateBase, slot))}>{slot}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Cancha</label>
            <select value={manualBooking.courtId} onChange={(e) => setManualBooking({ ...manualBooking, courtId: e.target.value })} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
              <option value="" className="bg-gray-800">Selecciona cancha</option>
              {courts.map(c => <option key={c.id} value={c.id} className="bg-gray-800">{c.name}</option>)}
            </select>
          </div>
          {manualBooking.isFixed && (
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-300 mb-2">Día de la semana</label>
              <select value={manualBooking.dayOfWeek} onChange={(e) => setManualBooking({ ...manualBooking, dayOfWeek: e.target.value })} className="w-full h-12 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                <option value="1" className="bg-gray-800">Lunes</option><option value="2" className="bg-gray-800">Martes</option><option value="3" className="bg-gray-800">Miércoles</option><option value="4" className="bg-gray-800">Jueves</option><option value="5" className="bg-gray-800">Viernes</option><option value="6" className="bg-gray-800">Sábado</option><option value="0" className="bg-gray-800">Domingo</option>
              </select>
            </div>
          )}
          <div className="md:col-span-2 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input type="checkbox" checked={manualBooking.isFixed} onChange={(e) => setManualBooking({ ...manualBooking, isFixed: e.target.checked })} className="w-4 h-4 rounded border-gray-600 text-emerald-500 focus:ring-emerald-500 focus:ring-2" />
              <span className="text-sm">¿Es un turno fijo? (se repite semanalmente)</span>
            </label>
            <button type="submit" className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-900">
              {manualBooking.isFixed ? '🔄 Crear Turno Fijo' : '📅 Crear Reserva'}
            </button>
          </div>
        </form>
        <div className="mt-6 p-4 bg-surface-80 border border-border rounded-lg">
          <h3 className="text-sm font-semibold text-text mb-2">💡 Cómo crear reservas:</h3>
          <ul className="text-sm text-muted space-y-1">
            <li>• <strong>Reserva Simple:</strong> Completa nombre, apellido, fecha, hora y cancha para una reserva única.</li>
            <li>• <strong>Turno Fijo:</strong> Marca la casilla &quot;Es un turno fijo&quot; y selecciona el día de la semana. Se creará una serie semanal automática.</li>
            <li>• <strong>Validaciones:</strong> No se permiten fechas pasadas ni horarios ya ocupados.</li>
          </ul>
        </div>
      </div>

      <div className="bg-surface-70 backdrop-blur-sm border border-border rounded-2xl p-8 mb-8 overflow-hidden relative z-10">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-text">HORARIOS DEL DÍA</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 relative z-20">
              <label className="text-sm text-muted">Fecha:</label>
              <DatePicker
                selected={scheduleDate ? (() => { const [y, m, d] = scheduleDate.split('-').map(Number); return new Date(y, m - 1, d); })() : new Date()}
                onChange={(date: Date | null) => date && setScheduleDate(formatLocalDate(date))}
                dateFormat="yyyy-MM-dd" className="bg-surface border border-border rounded-lg px-4 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition h-10"
              />
            </div>
            <button onClick={loadSchedule} disabled={loadingSchedule} className="btn btn-primary px-4 py-1 text-sm bg-blue-500/15 hover:bg-blue-500/25 border-blue-500/40 hover:border-blue-400/70 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.15)] transition disabled:opacity-50">
              {loadingSchedule ? '⏳' : '🔄'} ACTUALIZAR
            </button>
            {lastUpdate && <span className="text-xs text-muted">Última: {lastUpdate.toLocaleTimeString()}</span>}
          </div>
        </div>
        {loadingSchedule ? (
          <div className="animate-pulse space-y-4"><div className="h-12 bg-surface-50 rounded w-full"></div><div className="h-12 bg-surface-50 rounded w-full"></div><div className="h-12 bg-surface-50 rounded w-full"></div></div>
        ) : scheduleBookings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-muted text-xs uppercase tracking-wider">
                  <th className="p-4">Horario</th><th className="p-4">Cancha</th><th className="p-4">Estado</th><th className="p-4">Reservante</th><th className="p-5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium">
                {scheduleBookings.map((slot, index) => (
                  <tr key={index} className="border-b border-border/50 hover:bg-surface-70 transition-colors">
                    <td className="p-4 font-mono text-muted">{slot.slotTime}</td>
                    <td className="p-4 text-text font-bold">{slot.courtName}</td>
                    <td className="p-5">
                      {slot.booking ? (
                        slot.booking.status === 'CONFIRMED' ? (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span> CONFIRMADO</span>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-yellow-500/30 text-yellow-300 bg-yellow-500/10"><span className="h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.6)]"></span> PENDIENTE</span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border border-gray-500/30 text-gray-300 bg-gray-500/10"><span className="h-2 w-2 rounded-full bg-gray-400"></span> LIBRE</span>
                      )}
                    </td>
                    <td className="p-5 text-text">
                      {slot.booking ? (
                        <div>
                          <div className="font-bold">{slot.booking.userName || slot.booking.guestName}</div>
                          {(slot.booking.guestPhone || slot.booking.user?.phoneNumber) && <div className="text-xs text-emerald-400 mt-0.5 flex items-center gap-1">📞 {slot.booking.guestPhone || slot.booking.user?.phoneNumber}</div>}
                          {slot.booking.fixedBookingId && <div className="text-xs text-muted mt-1">🔄 Turno fijo #{slot.booking.fixedBookingId}</div>}
                        </div>
                      ) : <span className="text-muted">-</span>}
                    </td>
                    <td className="p-5 text-right">
                      {slot.booking && (
                        <div className="flex justify-end gap-2">
                          {slot.booking.status !== 'CONFIRMED' && (
                            <button onClick={() => handleConfirmBooking(slot.booking)} className="text-xs btn h-7 px-2.5 py-0 bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400/70 leading-none whitespace-nowrap" title="Confirmar turno">✓ CONFIRMAR</button>
                          )}
                          <button onClick={() => handleCancelBooking(slot.booking)} className={`text-xs btn h-7 px-2.5 py-0 bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20 hover:border-red-400/70 leading-none whitespace-nowrap ${slot.booking.fixedBookingId ? 'shadow-[0_0_10px_rgba(239,68,68,0.25)]' : ''}`} title={slot.booking.fixedBookingId ? 'Cancelar Turno Fijo' : 'Cancelar'}>✕ {slot.booking.fixedBookingId ? 'BAJA' : 'CANCELAR'}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 border border-dashed border-border rounded-xl bg-surface-70"><p className="text-muted">Sin datos cargados para esta fecha</p></div>
        )}
      </div>

      <AppModal show={modalState.show} onClose={closeModal} onCancel={modalState.onCancel} title={modalState.title} message={modalState.message} cancelText={modalState.cancelText} confirmText={modalState.confirmText} isWarning={modalState.isWarning} onConfirm={modalState.onConfirm} closeOnBackdrop={modalState.closeOnBackdrop} closeOnEscape={modalState.closeOnEscape} />
    </>
  );
}
