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
          // Parsear la fecha YYYY-MM-DD y crear Date en midnight local (evita shift de zona)
          const [ry, rm, rd] = String(createResult.refreshDate).split('-').map(Number);
          setSelectedDate(new Date(ry, rm - 1, rd));
        }
        await (refresh as () => Promise<void>)?.();
        // limpiar selección después del refresh para que el botón vuelva a "Selecciona horario y cancha"
        setSelectedSlot(null);
        setSelectedCourt(null);
      } catch (_) {
        /* noop */
      }

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

  // Sincronizar disabledSlots desde lo que trae el backend: si una cancha NO aparece en availableCourts para un slot, marcarla como deshabilitada
  useEffect(() => {
    if (!selectedDate || !slotsWithCourts) return;
    const dateString = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(
      selectedDate.getDate()
    ).padStart(2, '0')}`;

    const newDisabled: Record<string, boolean> = {};
    slotsWithCourts.forEach((slot) => {
      // Para cada cancha activa, si no está dentro de availableCourts, marcarla deshabilitada
      const availableIds = new Set(slot.availableCourts.map((c) => c.id));
      const courtsToInspect = allCourts.length > 0 ? allCourts : slot.availableCourts;
      courtsToInspect.forEach((court) => {
        const key = `${dateString}-${slot.slotTime}-${court.id}`;
        if (!availableIds.has(court.id)) {
          newDisabled[key] = true;
        }
      });
    });

    // Merge sin borrar lo que pueda estar en disabledSlots por acciones del usuario
    setDisabledSlots((prev) => ({ ...newDisabled, ...prev }));
  }, [slotsWithCourts, allCourts, selectedDate]);

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 lg:p-8 bg-white/90 backdrop-blur-lg rounded-2xl shadow-2xl border-2 border-white/50">
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-block p-2 sm:p-3 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl mb-3 sm:mb-4 shadow-lg">
          <span className="text-3xl sm:text-4xl">🏓</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-gray-900 mb-2">Reservar Cancha</h2>
        <p className="text-sm sm:text-base text-gray-600 font-medium">Elige tu día y horario ideal</p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-700 mb-2 ml-1 flex items-center gap-2">
          <span>📅</span>
          <span>Fecha</span>
        </label>
        <input
          type="date"
          min={new Date().toISOString().split('T')[0]}
          className="w-full p-4 rounded-xl border-2 border-gray-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all outline-none text-lg font-medium text-gray-700 bg-white shadow-sm hover:shadow-md"
          onChange={handleDateChange}
          value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
        />
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-center mb-4">{error}</div>}

      {!loading && filteredSlotsWithCourts.length > 0 && (
        <div className="mb-8">
          <label className="block text-sm font-bold text-gray-700 mb-3 ml-1 flex items-center gap-2">
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
                <div key={slotWithCourt.slotTime} className="bg-white/50 backdrop-blur-sm p-4 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-lg text-gray-800">{slotWithCourt.slotTime}</span>
                    <span className="text-sm text-gray-600">
                      {availableCount} cancha{availableCount !== 1 ? 's' : ''} disponible{availableCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
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
                            alert('No se pudo verificar disponibilidad. Intenta nuevamente más tarde.');
                            return;
                          }
                          const data = await res.json();
                          const availableSlots: string[] = data.availableSlots || [];
                          if (!availableSlots.includes(slotWithCourt.slotTime)) {
                            setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                            alert('⚠️ Esta cancha ya no está disponible para ese horario.');
                            return;
                          }

                          setSelectedSlot(slotWithCourt.slotTime);
                          setSelectedCourt(court);
                        } catch (err: any) {
                          console.error('Error verificando disponibilidad:', err);
                          setDisabledSlots((prev) => ({ ...prev, [slotKey]: true }));
                          alert('Error al verificar disponibilidad. Intenta de nuevo.');
                        }
                      };

                      const baseClass = 'py-2 px-3 rounded-lg font-bold text-sm transition-all duration-200 transform';
                      const stateClass = isDisabled
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : selectedSlot === slotWithCourt.slotTime && selectedCourt?.id === court.id
                        ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/40 scale-105 ring-2 ring-orange-300 ring-offset-1'
                        : 'bg-gradient-to-br from-gray-50 to-gray-100 text-slate-700 hover:from-orange-50 hover:to-amber-50 hover:text-orange-700 border border-gray-200 hover:border-orange-300 hover:scale-105';
                      const finalClass = `${baseClass} ${stateClass}`;

                      return (
                        <button key={court.id} onClick={handleSelectCourt} disabled={isDisabled} className={finalClass}>
                          🏓 {court.name}
                          {!isBackendAvailable && <span className="ml-2 text-xs text-gray-500"> (Ocupada)</span>}
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
        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 mb-6">
          <p className="text-gray-500 italic">
            {(() => {
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
              if (selected < today) {
                return '😢 No se pueden reservar turnos en fechas pasadas.';
              } else if (selected.getTime() === today.getTime() && slotsWithCourts.length > 0) {
                return '😢 Los turnos disponibles ya pasaron.';
              } else {
                return '😢 No hay canchas disponibles.';
              }
            })()}
          </p>
        </div>
      )}

      <button
        disabled={!selectedSlot || !selectedCourt || isBooking}
        onClick={handleBooking}
        className={`
            w-full py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg text-white shadow-xl transition-all flex items-center justify-center gap-2
            ${!selectedSlot || !selectedCourt || isBooking ? 'bg-gray-300 cursor-not-allowed' : 'bg-gradient-to-r from-orange-600 via-orange-500 to-amber-600 hover:from-orange-700 hover:via-orange-600 hover:to-amber-700 hover:shadow-2xl hover:shadow-orange-500/50 transform hover:scale-[1.02]'}
        `}
      >
        {isBooking ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            <span>Procesando...</span>
          </>
        ) : selectedSlot && selectedCourt ? (
          <>
            <span>✅</span>
            <span>Reservar {selectedCourt.name} - {selectedSlot} hs</span>
          </>
        ) : (
          <>
            <span>👆</span>
            <span>Selecciona horario y cancha</span>
          </>
        )}
      </button>
    </div>
  );
}

