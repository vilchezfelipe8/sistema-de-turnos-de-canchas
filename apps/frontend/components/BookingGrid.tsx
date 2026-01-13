"use client";

import { useState, useEffect } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function BookingGrid() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedCourt, setSelectedCourt] = useState<{ id: number; name: string } | null>(null);
  const [isBooking, setIsBooking] = useState(false);

  const { slotsWithCourts, loading, error, refresh } = useAvailability(selectedDate);
  const [disabledSlots, setDisabledSlots] = useState<Record<string, boolean>>({});
  const STORAGE_PREFIX = 'disabledSlots:';
  const [allCourts, setAllCourts] = useState<Array<{ id: number; name: string }>>([]);

  // --- LÓGICA (Sin cambios) ---
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
    if (!selectedDate || !selectedSlot || !selectedCourt) return;
    try {
      setIsBooking(true);
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const day = selectedDate.getDate();
      const bookingDateTime = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

      const createResult = await createBooking(selectedCourt.id, 1, bookingDateTime);

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
      } catch (_) { /* noop */ }

      alert('✅ ¡Reserva Confirmada! Te esperamos en la cancha ' + selectedCourt.name + '.');
    } catch (error: any) {
      alert('❌ Ups: ' + error.message);
    } finally {
      setIsBooking(false);
    }
  };

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

  useEffect(() => {
    if (!selectedDate || !slotsWithCourts) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;

    const newDisabled: Record<string, boolean> = {};
    slotsWithCourts.forEach((slot) => {
      const availableIds = new Set(slot.availableCourts.map((c) => c.id));
      const courtsToInspect = allCourts.length > 0 ? allCourts : slot.availableCourts;
      courtsToInspect.forEach((court) => {
        const key = `${dateString}-${slot.slotTime}-${court.id}`;
        if (!availableIds.has(court.id)) {
          newDisabled[key] = true;
        }
      });
    });

    setDisabledSlots((prev) => ({ ...newDisabled, ...prev }));
  }, [slotsWithCourts, allCourts, selectedDate]);

  // --- RENDERIZADO VISUAL (Totalmente renovado) ---
  return (
    <div className="w-full max-w-4xl mx-auto bg-slate-900/60 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden">
      
      {/* Glow Effect Decorativo */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-1 bg-gradient-to-r from-transparent via-lime-500/20 to-transparent blur-md"></div>

      <div className="text-center mb-8">
        <div className="inline-block p-4 bg-slate-800 rounded-2xl mb-4 shadow-lg border border-slate-700">
          <span className="text-4xl">🎾</span>
        </div>
        <h2 className="text-3xl font-black text-white mb-2 tracking-tight">Reservar Cancha</h2>
        <p className="text-slate-400 font-medium">Elige tu día y horario ideal</p>
      </div>

      <div className="mb-8">
        <label className="block text-sm font-bold text-slate-300 mb-2 ml-1 flex items-center gap-2">
          <span>📅</span>
          <span>Fecha</span>
        </label>
        <input
          type="date"
          min={new Date().toISOString().split('T')[0]}
          className="w-full p-4 rounded-xl border border-slate-700 bg-slate-950/50 text-white placeholder-slate-500 focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500 transition-all font-medium shadow-inner"
          onChange={handleDateChange}
          value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
          style={{ colorScheme: 'dark' }} // Truco para que el calendario nativo sea oscuro
        />
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-lime-500 shadow-[0_0_15px_rgba(132,204,22,0.5)]"></div>
        </div>
      )}

      {error && (
        <div className="bg-red-950/30 text-red-400 p-4 rounded-xl border border-red-500/30 text-center mb-6 flex items-center justify-center gap-2">
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
                <div key={slotWithCourt.slotTime} className="bg-slate-950/30 p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-bold text-xl text-white tracking-tight">{slotWithCourt.slotTime}</span>
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider bg-slate-900 px-2 py-1 rounded">
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

                      // --- ESTILOS DE BOTONES DE CANCHA ---
                      const isSelected = selectedSlot === slotWithCourt.slotTime && selectedCourt?.id === court.id;
                      
                      let btnClass = 'py-3 px-4 rounded-xl font-bold text-sm transition-all duration-300 flex items-center justify-center gap-2 border ';
                      
                      if (isDisabled) {
                        btnClass += 'bg-slate-900/40 text-slate-700 border-transparent cursor-not-allowed opacity-50';
                      } else if (isSelected) {
                        btnClass += 'bg-lime-500 text-slate-950 border-lime-400 shadow-[0_0_15px_rgba(132,204,22,0.4)] scale-[1.02]';
                      } else {
                        btnClass += 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-lime-500/50 hover:bg-slate-800 hover:scale-[1.02]';
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
        <div className="text-center py-12 bg-slate-950/30 rounded-2xl border border-dashed border-slate-800 mb-8">
          <p className="text-slate-500 font-medium">
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

      <button
        disabled={!selectedSlot || !selectedCourt || isBooking}
        onClick={handleBooking}
        className={`
            w-full py-4 rounded-xl font-black text-lg shadow-lg transition-all flex items-center justify-center gap-3 uppercase tracking-wide
            ${!selectedSlot || !selectedCourt || isBooking 
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700' 
                : 'bg-lime-500 text-slate-950 hover:bg-lime-400 hover:shadow-[0_0_25px_rgba(132,204,22,0.4)] transform hover:scale-[1.01] border border-lime-400'}
        `}
      >
        {isBooking ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-900"></div>
            <span>Procesando...</span>
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
    </div>
  );
}