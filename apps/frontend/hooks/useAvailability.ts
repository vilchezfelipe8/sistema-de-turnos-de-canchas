import { useState, useEffect } from 'react';

interface AvailabilityResponse {
  date: string;
  availableSlots: string[];
}

export function useAvailability(courtId: number, date: Date | null) {
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leemos la variable de entorno que YA VIMOS que funciona en tu captura
  const apiUrl = process.env.NEXT_PUBLIC_API_URL; 

  useEffect(() => {
    if (!date || !courtId) return;

    const fetchSlots = async () => {
      setLoading(true);
      setError(null);
      setSlots([]);

      try {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;

        // Usamos el endpoint limpio que arreglamos hoy
        const res = await fetch(`${apiUrl}/api/bookings/availability?courtId=${courtId}&activityId=1&date=${dateString}`);
        if (!res.ok) throw new Error('Error al cargar turnos');

        const data: AvailabilityResponse = await res.json();
        setSlots(data.availableSlots);

      } catch (err: any) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSlots();
  }, [courtId, date, apiUrl]);

  return { slots, loading, error };
}