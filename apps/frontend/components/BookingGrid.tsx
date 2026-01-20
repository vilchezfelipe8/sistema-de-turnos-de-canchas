"use client";

import { useState, useEffect, useRef } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';
import { useRouter } from 'next/router'; // Importar router por si necesitas redireccionar
import AppModal from './AppModal';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function BookingGrid() {
  const formatLocalDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const formatDateTime = (date: Date) =>
    date.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  const maxDate = new Date();
  maxDate.setMonth(maxDate.getMonth() + 1);
  const maxDateStr = formatLocalDate(maxDate);
  // const router = useRouter(); // Descomentar si usas next router
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedCourt, setSelectedCourt] = useState<{ id: number; name: string } | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Estado para el botón visual
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestPhoneFocused, setGuestPhoneFocused] = useState(false);
  const [guestError, setGuestError] = useState('');
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [modalState, setModalState] = useState<{
    show: boolean;
    title?: string;
    message?: string;
    cancelText?: string;
    confirmText?: string;
    isWarning?: boolean;
  }>({ show: false });

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, show: false }));
  };

  const showInfo = (message: string, title = 'Información') => {
    setModalState({
      show: true,
      title,
      message,
      cancelText: '',
      confirmText: 'OK'
    });
  };

  const showError = (message: string) => {
    setModalState({
      show: true,
      title: 'Error',
      message,
      isWarning: true,
      cancelText: '',
      confirmText: 'Aceptar'
    });
  };

  const { slotsWithCourts, loading, error, refresh } = useAvailability(selectedDate);
  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
  const STORAGE_PREFIX = 'disabledSlots:';
  const [allCourts, setAllCourts] = useState<Array<{ id: number; name: string }>>([]);
  const getTrimmedGuestInfo = () => {
    const trimmedPhone = guestPhone.replace(/\D/g, '');
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    return {
      name: fullName,
      email: guestEmail.trim(),
      phone: trimmedPhone ? `+549${trimmedPhone}` : ''
    };
  };

  const isEmailValid = (email: string) => {
    if (!email) return true;
    return /^\S+@\S+\.\S+$/.test(email);
  };

  const isPhoneValid = (phone: string) => {
    if (!phone) return true;
    if (!phone.startsWith('+549')) return false;
    const digits = phone.replace(/\D/g, '');
    if (!digits.startsWith('549')) return false;
    const nationalDigits = digits.slice(3);
    if (nationalDigits.length !== 10) return false;
    return /^\+549\d+$/.test(phone);
  };

  const formatPhoneDigits = (digits: string) => {
    const clean = digits.slice(0, 10);
    const part1 = clean.slice(0, 3);
    const part2 = clean.slice(3, 6);
    const part3 = clean.slice(6, 10);
    return [part1, part2, part3].filter(Boolean).join(' ');
  };

  const isGuestInfoValid = () => {
    const { email, phone } = getTrimmedGuestInfo();
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    if (!firstName || !lastName) return false;
    if (!phone) return false;
    return isEmailValid(email) && isPhoneValid(phone);
  };

  // --- Verificar Autenticación al cargar ---
  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
  }, []);

  // --- LÓGICA DE FILTRADO (Sin cambios) ---
  const filteredSlotsWithCourts = (() => {
    if (!selectedDate) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());

    if (selected < today) return [];
    if (selected.getTime() === today.getTime()) {
      return slotsWithCourts.filter((slotWithCourt) => {
        const [hours, minutes] = slotWithCourt.slotTime.split(':').map(Number);
        const slotTime = new Date();
        slotTime.setHours(hours, minutes, 0, 0);
        return slotTime > now;
      });
    }
    return slotsWithCourts;
  })();

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    setSelectedDate(new Date(y, m - 1, d));
    setSelectedSlot(null);
    setSelectedCourt(null);
  };

  const performBooking = async (guestInfo?: { name: string; email?: string; phone?: string }) => {
    // No requerimos token: BookingService se encargará de enviar guestIdentifier si no hay token
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    try {
      setIsBooking(true);
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const day = selectedDate.getDate();
      const bookingDateTime = new Date(year, month, day, hours, minutes, 0, 0);

      const createResult = await createBooking(
        selectedCourt.id,
        1,
        bookingDateTime,
        undefined,
        !isAuthenticated ? guestInfo : undefined
      );

      // Guardar bloqueo temporal localmente (Optimistic UI)
      const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
        selectedDate.getDate()
      ).padStart(2, '0')}`;
      const slotKey = `${dateString}-${selectedSlot}-${selectedCourt.id}`;
      setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));

      try {
        if (createResult && createResult.refresh && createResult.refreshDate) {
          const [ry, rm, rd] = String(createResult.refreshDate).split('-').map(Number);
          setSelectedDate(new Date(ry, rm - 1, rd));
        }
        await (refresh as () => Promise<void>)?.();
        setSelectedSlot(null);
        setSelectedCourt(null);
        if (!isAuthenticated) {
          setGuestFirstName('');
          setGuestLastName('');
          setGuestEmail('');
          setGuestPhone('');
        }
      } catch (_) { /* noop */ }

      showInfo('✅ ¡Reserva Confirmada! Te esperamos en la cancha ' + selectedCourt.name + '.', 'Listo');
    } catch (error: any) {
      showError('❌ Ups: ' + error.message);
    } finally {
      setIsBooking(false);
    }
  };

  const handleGuestConfirm = () => {
    const info = getTrimmedGuestInfo();
    const firstName = guestFirstName.trim();
    const lastName = guestLastName.trim();
    if (!firstName || !lastName) {
      setGuestError('❗ Ingresá tu nombre y apellido para reservar como invitado.');
      return;
    }
    if (info.email && !isEmailValid(info.email)) {
      setGuestError('❗ Ingresá un email con formato válido.');
      return;
    }
    if (info.phone && !isPhoneValid(info.phone)) {
      setGuestError('❗ Ingresá un teléfono con formato válido.');
      return;
    }
    if (!info.phone) {
      setGuestError('❗ Ingresá un teléfono para poder contactarte.');
      return;
    }
    setGuestError('');
    setGuestModalOpen(false);
    performBooking(info);
  };

  const handleGuestKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (isBooking || !isGuestInfoValid()) return;
    handleGuestConfirm();
  };

  const handleBooking = () => {
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    if (!isAuthenticated) {
      setGuestError('');
      setGuestModalOpen(true);
      return;
    }
    performBooking();
  };

  // --- Cargar disabledSlots de localStorage ---
  useEffect(() => {
    if (!selectedDate) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;
    const key = `${STORAGE_PREFIX}${dateString}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        setDisabledSlots((prev) => ({ ...prev, ...parsed }));
      }
    } catch (err) {
      console.error('Error loading disabled slots from localStorage', err);
    }
  }, [selectedDate]);

  // --- Guardar disabledSlots en localStorage ---
  useEffect(() => {
    if (!selectedDate) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;
    const key = `${STORAGE_PREFIX}${dateString}`;
    try {
      const objForDate = Object.fromEntries(Object.entries(disabledSlots).filter(([k]) => k.startsWith(`${dateString}-`)));
      localStorage.setItem(key, JSON.stringify(objForDate));
    } catch (err) {
      console.error('Error saving disabled slots to localStorage', err);
    }
  }, [disabledSlots, selectedDate]);

  const selectedTimes = (() => {
    if (!selectedDate || !selectedSlot) return null;
    const [hours, minutes] = selectedSlot.split(':').map(Number);
    const start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), hours, minutes, 0, 0);
    const end = new Date(start.getTime() + 90 * 60000);
    return {
      startLabel: formatDateTime(start),
      endLabel: formatDateTime(end)
    };
  })();

  useEffect(() => {
    if (!selectedSlot || !selectedCourt) return;
    confirmButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedSlot, selectedCourt]);

  // --- Cargar Canchas ---
  useEffect(() => {
    const fetchCourts = async () => {
      try {
        const res = await fetch(`${API_URL}/api/courts`);
        if (!res.ok) return;
        const data = await res.json();
        setAllCourts(data);
      } catch (err) {
        console.error('Error fetching courts:', err);
      }
    };
    fetchCourts();
  }, []);

  // --- CORRECCIÓN MEMORIA ZOMBIE (Sincronizar Backend con Frontend) ---
  useEffect(() => {
    if (!selectedDate || !slotsWithCourts) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;

    setDisabledSlots((prev) => {
      const nextState = { ...prev }; // Copiamos el estado actual

      slotsWithCourts.forEach((slot) => {
        const availableIds = new Set(slot.availableCourts.map((c) => c.id));
        const courtsToInspect = allCourts.length > 0 ? allCourts : slot.availableCourts;

        courtsToInspect.forEach((court) => {
          const key = `${dateString}-${slot.slotTime}-${court.id}`;

          if (!availableIds.has(court.id)) {
            // El backend dice que NO está disponible -> Lo bloqueamos
            nextState[key] = true;
          } else {
            // 🔥 SI EL BACKEND DICE QUE ESTÁ LIBRE, BORRAMOS EL BLOQUEO LOCAL
            delete nextState[key]; 
          }
        });
      });

      return nextState;
    });
  }, [slotsWithCourts, allCourts, selectedDate]);

  // --- RENDERIZADO VISUAL ---
  return (
    <div className="w-full max-w-4xl mx-auto bg-surface-70 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-border shadow-soft relative overflow-hidden">
    
      <div className="text-center mb-8">
        <h2 className="text-3xl font-black text-text mb-2 tracking-tight">Reservar Cancha</h2>
        <p className="text-muted font-medium">Elige tu día y horario ideal</p>
      </div>

        <div className="mb-8">
        <label className="block text-sm font-bold text-slate-300 mb-2 ml-1 flex items-center gap-2">
          <span>📅</span>
          <span>Fecha</span>
        </label>
        <input
          type="date"
          min={formatLocalDate(new Date())}
          max={maxDateStr}
          onMouseDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).showPicker?.();
          }}
          className="date-input w-full p-4 pr-12 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none transition-all font-medium shadow-inner"
          onChange={handleDateChange}
          value={selectedDate ? formatLocalDate(selectedDate) : ''}
          style={{ colorScheme: 'dark' }} 
        />
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'rgba(255,255,255,0.12)' }}></div>
        </div>
      )}

      {error && (
        <div className="bg-surface-70 text-muted p-4 rounded-xl border border-border text-center mb-6 flex items-center justify-center gap-2">
           <span>⚠️</span> {error}
        </div>
      )}

      {!loading && filteredSlotsWithCourts.length > 0 && (
        <div className="mb-10">
          <label className="block text-sm font-bold text-slate-300 mb-4 ml-1 flex items-center gap-2">
            <span>⏰</span>
            <span>Horarios Disponibles</span>
          </label>

          <div className="space-y-4">
          {filteredSlotsWithCourts.map((slotWithCourt) => {
              const dateString = selectedDate
                ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
                : '';
              const availableCount = slotWithCourt.availableCourts.reduce((acc, ac) => {
                const key = `${dateString}-${slotWithCourt.slotTime}-${ac.id}`;
                if (disabledSlots[key]) return acc;
                return acc + 1;
              }, 0);

              return (
                <div key={slotWithCourt.slotTime} className="bg-surface-70 p-4 rounded-2xl border border-border hover:border-border transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-bold text-xl text-white tracking-tight">{slotWithCourt.slotTime}</span>
                    <span className="text-xs font-bold text-muted uppercase tracking-wider bg-surface px-2 py-1 rounded">
                      {availableCount} {availableCount !== 1 ? 'DISPONIBLES' : 'DISPONIBLE'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(allCourts.length > 0 ? allCourts : slotWithCourt.availableCourts).map((court) => {
                      const slotKey = `${dateString}-${slotWithCourt.slotTime}-${court.id}`;
                      const isLocallyDisabled = !!disabledSlots[slotKey];
                      const isBackendAvailable = slotWithCourt.availableCourts.some((ac) => ac.id === court.id);
                      const isDisabled = isLocallyDisabled || !isBackendAvailable;

                      const handleSelectCourt = async () => {
                        if (!selectedDate) return;
                        if (!isBackendAvailable) return;
                        try {
                          // Doble check de disponibilidad
                          const res = await fetch(`${API_URL}/api/bookings/availability?courtId=${court.id}&date=${dateString}&activityId=1`);
                          if (!res.ok) {
                            setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                            showError('No se pudo verificar disponibilidad.');
                            return;
                          }
                          const data = await res.json();
                          const availableSlots: string[] = data.availableSlots || [];
                          if (!availableSlots.includes(slotWithCourt.slotTime)) {
                            setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                            showError('⚠️ Cancha ya no disponible.');
                            return;
                          }
                          setSelectedSlot(slotWithCourt.slotTime);
                          setSelectedCourt(court);
                        } catch (err: any) {
                          setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                          showError('Error verificando disponibilidad.');
                        }
                      };

                      // Estilos
                      const isSelected = selectedSlot === slotWithCourt.slotTime && selectedCourt?.id === court.id;
                      let btnClass = 'py-3 px-4 rounded-xl font-bold text-sm transition-all duration-300 flex items-center justify-center gap-2 border ';
                      
                      if (isDisabled) {
                        btnClass += 'btn-disabled';
                      } else if (isSelected) {
                        btnClass += 'btn btn-selected';
                      } else {
                        btnClass += 'btn';
                      }

                      return (
                        <button key={court.id} onClick={handleSelectCourt} disabled={isDisabled} className={btnClass}>
                          <span>🏓</span> {court.name}
                          {!isBackendAvailable && <span className="text-[10px] ml-1 opacity-50">(X)</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && filteredSlotsWithCourts.length === 0 && selectedDate && (
        <div className="text-center py-12 bg-surface-70 rounded-2xl border border-dashed border-border mb-8">
          <p className="text-muted font-medium">
            {(() => {
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
              if (selected < today) return '⏳ No se puede viajar al pasado...';
              else if (selected.getTime() === today.getTime() && slotsWithCourts.length > 0) return '🌙 Ya no quedan turnos por hoy.';
              else return '🚫 No hay canchas disponibles para esta fecha.';
            })()}
          </p>
        </div>
      )}

      {/* BOTÓN PRINCIPAL CON LÓGICA DE LOGIN VISUAL */}
      <button
        ref={confirmButtonRef}
        onClick={handleBooking}
        disabled={isBooking || !selectedSlot || !selectedCourt}
        className={`${(isBooking || !selectedSlot || !selectedCourt) ? 'btn btn-disabled w-full' : 'btn btn-primary w-full'}`}
      >
        {isBooking ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-900"></div>
            <span>Procesando...</span>
          </>
        ) : (isBooking || !selectedSlot || !selectedCourt) ? (
            <>
              <span className="opacity-50">👆</span>
              <span className="opacity-50">Selecciona Turno</span>
            </>
        ) : !isAuthenticated ? (
            <>
                <span>⚡</span>
                <span>CONFIRMAR RESERVA</span>
            </>
        ) : selectedSlot && selectedCourt ? (
          <>
            <span>⚡</span>
            <span>CONFIRMAR RESERVA</span>
          </>
        ) : (
          <>
            <span className="opacity-50">👆</span>
            <span className="opacity-50">Selecciona Turno</span>
          </>
        )}
      </button>
      <AppModal
        show={modalState.show}
        onClose={closeModal}
        title={modalState.title}
        message={modalState.message}
        cancelText={modalState.cancelText}
        confirmText={modalState.confirmText}
        isWarning={modalState.isWarning}
        closeOnBackdrop
        closeOnEscape
      />
      <AppModal
        show={guestModalOpen}
        onClose={() => setGuestModalOpen(false)}
        title=""
        message={(
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-text">Datos de reserva</h4>
            {selectedTimes && (
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface p-3 text-sm text-muted">
                <div className="flex items-center justify-between">
                  <span>Inicia:</span>
                  <span className="text-text font-semibold">{selectedTimes.startLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Termina:</span>
                  <span className="text-text font-semibold">{selectedTimes.endLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Precio:</span>
                  <span className="text-text font-semibold">$28.000</span>
                </div>
              </div>
            )}
            <h4 className="text-sm font-semibold text-text pt-2">Datos de contacto</h4>
            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <input
                    id="guest-first-name"
                    type="text"
                    placeholder=" "
                    value={guestFirstName}
                    onChange={(e) => setGuestFirstName(e.target.value)}
                  onKeyDown={handleGuestKeyDown}
                    className="peer w-full p-3 pt-5 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors font-medium shadow-inner"
                  />
                  <label
                    htmlFor="guest-first-name"
                    className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                  >
                    Nombre
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="guest-last-name"
                    type="text"
                    placeholder=" "
                    value={guestLastName}
                    onChange={(e) => setGuestLastName(e.target.value)}
                  onKeyDown={handleGuestKeyDown}
                    className="peer w-full p-3 pt-5 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors font-medium shadow-inner"
                  />
                  <label
                    htmlFor="guest-last-name"
                    className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                  >
                    Apellido
                  </label>
                </div>
              </div>
              <div className="relative flex items-center rounded-xl border border-border bg-surface focus-within:border-white focus-within:!border-white transition-colors">
                <span
                  className={`px-3 text-muted font-medium whitespace-nowrap min-w-[3.25rem] text-center transition-all duration-150 leading-none ${guestPhone.length || guestPhoneFocused ? 'mt-2' : ''}`}
                >
                  +54&nbsp;9
                </span>
                <input
                  id="guest-phone"
                  type="tel"
                  placeholder=" "
                  value={formatPhoneDigits(guestPhone)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setGuestPhone(digits);
                  }}
                  onFocus={() => setGuestPhoneFocused(true)}
                  onBlur={() => setGuestPhoneFocused(false)}
                  onKeyDown={handleGuestKeyDown}
                  maxLength={12}
                  className="peer w-full p-3 pt-5 rounded-xl bg-transparent text-text placeholder:text-muted focus:outline-none transition-colors font-medium border-0 focus:border-0 leading-tight"
                />
                  <label
                  htmlFor="guest-phone"
                  className="absolute left-16 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                >
                  Teléfono
                </label>
              </div>
            </div>
            {guestError && (
              <p className="text-xs text-red-400">{guestError}</p>
            )}
          </div>
        )}
        cancelText="Cancelar"
        confirmText="Confirmar reserva"
        onConfirm={handleGuestConfirm}
        confirmDisabled={!isGuestInfoValid() || isBooking}
        closeOnBackdrop
        closeOnEscape
      />
    </div>
  );
}