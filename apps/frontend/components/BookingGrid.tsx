"use client";

import { useState } from 'react';
import { useAvailability } from '../hooks/useAvailability';
import { createBooking } from '../services/BookingService';

export default function BookingGrid() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  
  const { slots, loading, error } = useAvailability(1, selectedDate);

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
      const bookingDateTime = new Date(selectedDate);
      const [hours, minutes] = selectedSlot.split(':').map(Number);
      bookingDateTime.setHours(hours, minutes, 0, 0);

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
    <div className="max-w-lg mx-auto mt-10 p-8 bg-white rounded-2xl shadow-xl border border-gray-100">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-extrabold text-slate-800 mb-2">Reservar Cancha 🎾</h2>
        <p className="text-gray-500">Elige tu día y horario ideal</p>
      </div>

      {/* SELECTOR DE FECHA */}
      <div className="mb-6">
        <label className="block text-sm font-bold text-gray-700 mb-2 ml-1">Fecha</label>
        <input 
          type="date" 
          className="w-full p-4 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all outline-none text-lg font-medium text-gray-700"
          onChange={handleDateChange} 
          value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''} 
        />
      </div>

      {/* ESTADOS DE CARGA / ERROR */}
      {loading && (
        <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}
      
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-center mb-4">
            {error}
        </div>
      )}

      {/* GRILLA DE HORARIOS */}
      {!loading && slots.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-8">
          {slots.map((slot) => (
            <button 
              key={slot} 
              onClick={() => setSelectedSlot(slot)} 
              className={`
                py-3 px-2 rounded-xl font-bold text-sm transition-all duration-200 transform
                ${selectedSlot === slot 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 scale-105 ring-2 ring-blue-600 ring-offset-2' 
                    : 'bg-gray-50 text-slate-600 hover:bg-blue-50 hover:text-blue-600 border border-gray-100 hover:border-blue-200'}
              `}
            >
              {slot}
            </button>
          ))}
        </div>
      )}

      {!loading && slots.length === 0 && selectedDate && (
        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-300 mb-6">
            <p className="text-gray-500 italic">😢 No hay canchas disponibles.</p>
        </div>
      )}

      {/* BOTÓN CONFIRMAR */}
      <button 
        disabled={!selectedSlot || isBooking}
        onClick={handleBooking} 
        className={`
            w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg transition-all
            ${!selectedSlot || isBooking 
                ? 'bg-gray-300 cursor-not-allowed' 
                : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 hover:shadow-blue-500/25 transform hover:-translate-y-0.5'}
        `}
      >
        {isBooking ? 'Procesando...' : (selectedSlot ? `Confirmar ${selectedSlot} hs` : 'Selecciona un horario')}
      </button>
    </div>
  );
}