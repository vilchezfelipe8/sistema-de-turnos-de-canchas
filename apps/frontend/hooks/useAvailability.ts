import { useState, useEffect } from 'react';

interface Court {
  id: number;
  name: string;
}

interface SlotWithCourts {
  slotTime: string;
  availableCourts: Court[];
}

interface AvailabilityResponse {
  date: string;
  slotsWithCourts: SlotWithCourts[];
}

export function useAvailability(date: Date | null) {
  const [slotsWithCourts, setSlotsWithCourts] = useState<SlotWithCourts[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leemos la variable de entorno que YA VIMOS que funciona en tu captura
  const apiUrl = process.env.NEXT_PUBLIC_API_URL; 

  useEffect(() => {
    if (!date) return;

    const fetchSlots = async () => {
      setLoading(true);
      setError(null);
      setSlotsWithCourts([]);

      try {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;

        // Usamos el nuevo endpoint que devuelve slots con canchas disponibles
        const res = await fetch(`${apiUrl}/api/bookings/availability-with-courts?activityId=1&date=${dateString}`);
        if (!res.ok) throw new Error('Error al cargar turnos');

        const data: AvailabilityResponse = await res.json();
        setSlotsWithCourts(data.slotsWithCourts);

      } catch (err: any) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSlots();
  }, [date, apiUrl]);

  return { slotsWithCourts, loading, error };
}