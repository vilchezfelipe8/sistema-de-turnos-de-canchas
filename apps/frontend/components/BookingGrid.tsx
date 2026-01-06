"use client";

import { useState } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';

export default function BookingGrid() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  
  const { slots, loading, error } = useAvailability(1, selectedDate);

  // Filtrar slots del pasado si es hoy o fechas anteriores
  const filteredSlots = (() => {
    if (!selectedDate) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    
    // Si la fecha es anterior a hoy, no mostrar slots
    if (selected < today) return [];
    
    // Si es hoy, filtrar slots que ya pasaron
    if (selected.getTime() === today.getTime()) {
      return slots.filter(slot => {
        const [hours, minutes] = slot.split(':').map(Number);
        const slotTime = new Date();
        slotTime.setHours(hours, minutes, 0, 0);
        return slotTime > now;
      });
    }
    
    // Si es futuro, mostrar todos
    return slots;
  })();

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    setSelectedDate(new Date(y, m - 1, d));
    setSelectedSlot(null);
  };

  const handleBooking = async () => {
    if (!selectedDate || !selectedSlot) return;
    try {
      setIsBooking(true);
      // El backend trabaja con fechas en UTC interpretando las horas directamente como UTC
      // Los horarios disponibles (08:00, 22:00, etc.) se interpretan como UTC en el backend
      // Por lo tanto, cuando el usuario selecciona 22:00, debemos guardar 22:00 UTC
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth();
      const day = selectedDate.getDate();
      
      // Crear fecha directamente en UTC con la hora seleccionada
      const bookingDateTime = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

      await createBooking(1, 1, bookingDateTime);

      alert("✅ ¡Reserva Confirmada! Te esperamos en la cancha.");
      window.location.reload(); 

    } catch (error: any) {
      alert("❌ Ups: " + error.message);
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 lg:p-8 bg-white/90 backdrop-blur-lg rounded-2xl shadow-2xl border-2 border-white/50">
      <div className="text-center mb-6 sm:mb-8">
        <div className="inline-block p-2 sm:p-3 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl mb-3 sm:mb-4 shadow-lg">
          <span className="text-3xl sm:text-4xl">🏓</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-gray-900 mb-2">
          Reservar Cancha
        </h2>
        <p className="text-sm sm:text-base text-gray-600 font-medium">Elige tu día y horario ideal</p>
      </div>

      {/* SELECTOR DE FECHA */}
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

      {/* ESTADOS DE CARGA / ERROR */}
      {loading && (
        <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
        </div>
      )}
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-center mb-4">
            {error}
        </div>
      )}

      {/* GRILLA DE HORARIOS */}
      {!loading && filteredSlots.length > 0 && (
        <div className="mb-8">
          <label className="block text-sm font-bold text-gray-700 mb-3 ml-1 flex items-center gap-2">
            <span>⏰</span>
            <span>Horarios Disponibles</span>
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 gap-2 sm:gap-3">
            {filteredSlots.map((slot) => (
              <button 
                key={slot} 
                onClick={() => setSelectedSlot(slot)} 
                className={`
                  py-2.5 sm:py-3 px-2 rounded-xl font-bold text-xs sm:text-sm transition-all duration-200 transform
                  ${selectedSlot === slot 
                      ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/40 scale-105 ring-2 sm:ring-4 ring-orange-300 ring-offset-1 sm:ring-offset-2' 
                      : 'bg-gradient-to-br from-gray-50 to-gray-100 text-slate-700 hover:from-orange-50 hover:to-amber-50 hover:text-orange-700 border-2 border-gray-200 hover:border-orange-300 hover:scale-105'}
                `}
              >
                {slot}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && filteredSlots.length === 0 && selectedDate && (
        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 mb-6">
            <p className="text-gray-500 italic">
              {(() => {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const selected = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
                if (selected < today) {
                  return "😢 No se pueden reservar turnos en fechas pasadas.";
                } else if (selected.getTime() === today.getTime() && slots.length > 0) {
                  return "😢 Los turnos disponibles ya pasaron.";
                } else {
                  return "😢 No hay canchas disponibles.";
                }
              })()}
            </p>
        </div>
      )}

      {/* BOTÓN CONFIRMAR */}
      <button 
        disabled={!selectedSlot || isBooking}
        onClick={handleBooking} 
        className={`
            w-full py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg text-white shadow-xl transition-all flex items-center justify-center gap-2
            ${!selectedSlot || isBooking 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-gradient-to-r from-orange-600 via-orange-500 to-amber-600 hover:from-orange-700 hover:via-orange-600 hover:to-amber-700 hover:shadow-2xl hover:shadow-orange-500/50 transform hover:scale-[1.02]'}
        `}
      >
        {isBooking ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            <span>Procesando...</span>
          </>
        ) : (
          <>
            {selectedSlot ? (
              <>
                <span>✅</span>
                <span>Confirmar {selectedSlot} hs</span>
              </>
            ) : (
              <>
                <span>👆</span>
                <span>Selecciona un horario</span>
              </>
            )}
          </>
        )}
      </button>
    </div>
  );
}