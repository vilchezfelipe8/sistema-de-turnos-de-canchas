"use client";

import { useState, useEffect } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';
import AppModal from './AppModal';
import { useRouter } from 'next/router'; // Importar router por si necesitas redireccionar

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function BookingGrid() {
  // const router = useRouter(); // Descomentar si usas next router
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedCourt, setSelectedCourt] = useState<{ id: number; name: string } | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Estado para el botón visual
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false);

  const { slotsWithCourts, loading, error, refresh } = useAvailability(selectedDate);
  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
  const STORAGE_PREFIX = 'disabledSlots:';
  const [allCourts, setAllCourts] = useState<Array<{ id: number; name: string }>>([]);

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

  const handleBooking = async () => {
    // No requerimos token: BookingService se encargará de enviar guestIdentifier si no hay token
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    try {
      const trimmedName = guestName.trim();
      const trimmedEmail = guestEmail.trim();
      const trimmedPhone = guestPhone.trim();

      if (!isAuthenticated) {
        if (!trimmedName) {
          alert('❗ Ingresá tu nombre para reservar como invitado.');
          return;
        }
        if (!trimmedEmail && !trimmedPhone) {
          alert('❗ Ingresá un email o teléfono para poder contactarte.');
          return;
        }
      }

      setIsBooking(true);
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const day = selectedDate.getDate();
      const bookingDateTime = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

      const createResult = await createBooking(
        selectedCourt.id,
        1,
        bookingDateTime,
        undefined,
        !isAuthenticated ? { name: trimmedName, email: trimmedEmail, phone: trimmedPhone } : undefined
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
          setGuestName('');
          setGuestEmail('');
          setGuestPhone('');
          setIsGuestModalOpen(false);
        }
      } catch (_) { /* noop */ }

      alert('✅ ¡Reserva Confirmada! Te esperamos en la cancha ' + selectedCourt.name + '.');
    } catch (error: any) {
      alert('❌ Ups: ' + error.message);
    } finally {
      setIsBooking(false);
    }
  };

  const handlePrimaryAction = () => {
    if (isBooking || !selectedSlot || !selectedCourt) return;
    if (!isAuthenticated) {
      setIsGuestModalOpen(true);
      return;
    }
    void handleBooking();
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
      
      {/* Glow Effect Decorativo */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-1" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)' }}></div>

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
          min={new Date().toISOString().split('T')[0]}
          className="w-full p-4 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all font-medium shadow-inner"
          onChange={handleDateChange}
          value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
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
                            alert('No se pudo verificar disponibilidad.');
                            return;
                          }
                          const data = await res.json();
                          const availableSlots: string[] = data.availableSlots || [];
                          if (!availableSlots.includes(slotWithCourt.slotTime)) {
                            setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                            alert('⚠️ Cancha ya no disponible.');
                            return;
                          }
                          setSelectedSlot(slotWithCourt.slotTime);
                          setSelectedCourt(court);
                        } catch (err: any) {
                          setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                          alert('Error verificando disponibilidad.');
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
        onClick={handlePrimaryAction}
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
                <span>🤝</span>
                <span>Reservar como Invitado</span>
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
        show={!isAuthenticated && isGuestModalOpen}
        onClose={() => setIsGuestModalOpen(false)}
        title="Datos de contacto"
        message={(
          <div>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              Dejanos un nombre y al menos un medio para contactarte.
            </p>
            <div className="space-y-3 mt-3">
              <input
                type="text"
                placeholder="Nombre y apellido"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="w-full p-3 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all font-medium shadow-inner"
              />
              <input
                type="tel"
                placeholder="Teléfono (opcional)"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                className="w-full p-3 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all font-medium shadow-inner"
              />
              <input
                type="email"
                placeholder="Email (opcional)"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                className="w-full p-3 rounded-xl border border-border bg-surface text-text placeholder:text-muted focus:outline-none focus:border-border focus:ring-1 focus:ring-border transition-all font-medium shadow-inner"
              />
            </div>
            <p className="text-xs text-muted mt-2">Pedimos al menos un email o teléfono para poder contactarte.</p>
          </div>
        )}
        cancelText="Cancelar"
        confirmText={isBooking ? 'Procesando...' : 'Confirmar reserva'}
        onConfirm={() => void handleBooking()}
        confirmDisabled={!guestName.trim() || (!guestEmail.trim() && !guestPhone.trim()) || isBooking}
      />
    </div>
  );
}